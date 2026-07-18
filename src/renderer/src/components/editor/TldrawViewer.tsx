import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tldraw, getSnapshot, loadSnapshot, type Editor, type TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useAppStore } from '@/store'
import { resolveDocumentTheme } from '@/lib/document-theme'
import { translate } from '@/i18n/i18n'
import { installEditorSaveShortcut } from './editor-shortcuts'
import { registerPendingEditorFlush } from './editor-pending-flush'
import { TldrawSelectionOverlay } from './TldrawSelectionOverlay'
import { TldrawViewerContext, type TldrawViewerContextValue } from './tldraw-viewer-context'

// Why: tldraw's default asset URLs point at tldraw's CDN, which is unreachable
// (and inappropriate) for a production file:// Electron build. This resolves
// icons/fonts/embed-icons to the copies Vite already bundled with the app —
// see @tldraw/assets/imports.vite. Computed once at module scope (not with
// useMemo) both because it never changes and because tldraw requires
// `assetUrls` to be referentially stable across renders.
//
// The identity formatter is load-bearing: Vite emits these URLs as absolute
// file:// URLs (via `new URL(..., import.meta.url)`), but tldraw's default
// formatAssetUrl only recognizes http(s):// as absolute and would prefix
// file:// URLs with the page base, producing broken `file:///file:///...`
// URLs (no icons/fonts in the packaged app).
const assetUrls = getAssetUrlsByImport((url) => url)

// Why: tldraw requires `components` to be referentially stable too (see the
// TldrawBaseProps doc comment) — a module-scope constant is the simplest way
// to guarantee that across every mounted TldrawViewer instance.
const TLDRAW_COMPONENTS: TLComponents = {
  InFrontOfTheCanvas: TldrawSelectionOverlay
}

const SERIALIZE_DEBOUNCE_MS = 500

export type TldrawViewerProps = {
  content: string
  fileId: string
  filePath: string
  worktreeId: string
  relativePath: string
  onContentChange: (content: string) => void
  onDirtyStateHint: (dirty: boolean) => void
  onSave: (content: string) => Promise<void>
}

export default function TldrawViewer({
  content,
  fileId,
  filePath,
  worktreeId,
  relativePath,
  onContentChange,
  onDirtyStateHint,
  onSave
}: TldrawViewerProps): React.JSX.Element {
  const [loadError, setLoadError] = useState(false)
  const settings = useAppStore((s) => s.settings)
  const isDark = resolveDocumentTheme(settings?.theme ?? 'system')

  const editorRef = useRef<Editor | null>(null)
  // Why: the last string we either loaded from or handed back to
  // onContentChange, so a store-change event that nets out to the same
  // document (e.g. select-then-deselect never touches document scope, but
  // belt-and-suspenders) never triggers a redundant write.
  const lastSerializedRef = useRef<string | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef(content)
  const isDarkRef = useRef(isDark)
  // Why: mirrors IpynbViewer/RichMarkdownEditor — callbacks are kept in refs,
  // assigned fresh on every render, so the stable (empty-dep) callbacks below
  // always call the latest prop instead of one captured once at mount time
  // when the store listener/save shortcut were installed.
  const onContentChangeRef = useRef(onContentChange)
  const onDirtyStateHintRef = useRef(onDirtyStateHint)
  const onSaveRef = useRef(onSave)
  contentRef.current = content
  isDarkRef.current = isDark
  onContentChangeRef.current = onContentChange
  onDirtyStateHintRef.current = onDirtyStateHint
  onSaveRef.current = onSave

  const serializeCurrent = useCallback((): string => {
    const editor = editorRef.current
    if (!editor) {
      return lastSerializedRef.current ?? contentRef.current
    }
    return JSON.stringify(getSnapshot(editor.store))
  }, [])

  const commitSerialization = useCallback((serialized: string): void => {
    if (serialized === lastSerializedRef.current) {
      return
    }
    lastSerializedRef.current = serialized
    onContentChangeRef.current(serialized)
  }, [])

  const clearPendingTimer = useCallback((): void => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [])

  // Why: exposed to both the Cmd/Ctrl+S shortcut and the pending-editor-flush
  // registry (autosave/tab-switch machinery outside this component) so a
  // debounced-but-not-yet-committed edit is never silently lost. Returns the
  // freshly committed string so callers that need it immediately (save) don't
  // have to wait for the next render's `content` prop to catch up.
  const flushPendingSerialization = useCallback((): string => {
    clearPendingTimer()
    const serialized = serializeCurrent()
    commitSerialization(serialized)
    return serialized
  }, [clearPendingTimer, serializeCurrent, commitSerialization])

  const scheduleSerialization = useCallback((): void => {
    onDirtyStateHintRef.current(true)
    clearPendingTimer()
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      commitSerialization(serializeCurrent())
    }, SERIALIZE_DEBOUNCE_MS)
  }, [clearPendingTimer, serializeCurrent, commitSerialization])

  const handleSaveShortcut = useCallback((): void => {
    const latest = flushPendingSerialization()
    void onSaveRef.current(latest)
  }, [flushPendingSerialization])

  useEffect(() => {
    return registerPendingEditorFlush(fileId, flushPendingSerialization)
  }, [fileId, flushPendingSerialization])

  useEffect(() => {
    // Why: flush-on-unmount so a pending debounced edit made just before the
    // tab closes (or the file switches) is not silently discarded.
    return () => {
      flushPendingSerialization()
    }
  }, [flushPendingSerialization])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    editor.user.updateUserPreferences({ colorScheme: isDark ? 'dark' : 'light' })
  }, [isDark])

  const handleMount = useCallback(
    (editor: Editor): (() => void) => {
      editorRef.current = editor
      const trimmed = contentRef.current.trim()
      if (trimmed.length > 0) {
        try {
          loadSnapshot(editor.store, JSON.parse(trimmed))
        } catch {
          setLoadError(true)
          editorRef.current = null
          return () => {}
        }
      }
      // Why: registering the listener only after the initial load completes
      // means it never observes that load's own history entries — store.listen
      // flushes pending history before attaching (see @tldraw/store's
      // Store.listen), so this ordering is what keeps opening a file from
      // marking the tab dirty.
      lastSerializedRef.current = JSON.stringify(getSnapshot(editor.store))
      editor.user.updateUserPreferences({ colorScheme: isDarkRef.current ? 'dark' : 'light' })
      const unlisten = editor.store.listen(scheduleSerialization, {
        scope: 'document',
        source: 'user'
      })
      const removeSaveShortcut = installEditorSaveShortcut(
        editor.getContainer(),
        handleSaveShortcut
      )
      return () => {
        unlisten()
        removeSaveShortcut()
      }
    },
    [scheduleSerialization, handleSaveShortcut]
  )

  const contextValue: TldrawViewerContextValue = useMemo(
    () => ({ worktreeId, relativePath, filePath }),
    [worktreeId, relativePath, filePath]
  )

  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-editor-surface p-6 text-center text-sm text-muted-foreground">
        {translate(
          'auto.components.editor.TldrawViewer.83f281100a',
          'Could not parse .tldr file — switch to Source view'
        )}
      </div>
    )
  }

  return (
    <TldrawViewerContext.Provider value={contextValue}>
      <div className="relative h-full w-full">
        <Tldraw assetUrls={assetUrls} components={TLDRAW_COMPONENTS} onMount={handleMount} />
      </div>
    </TldrawViewerContext.Provider>
  )
}
