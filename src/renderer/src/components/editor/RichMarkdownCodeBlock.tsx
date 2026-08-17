import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import type { NodeViewProps } from '@tiptap/react'
import { richMarkdownAnnotationHighlightPluginKey } from './rich-markdown-annotation-highlight'
import { Copy, Check } from 'lucide-react'
import { useAppStore } from '@/store'
import MermaidBlock from './MermaidBlock'
import { RICH_MARKDOWN_CODE_BLOCK_LANGUAGES } from './rich-markdown-code-block-languages'
import { translate } from '@/i18n/i18n'

export function RichMarkdownCodeBlock({
  editor,
  getPos,
  node,
  updateAttributes
}: NodeViewProps): React.JSX.Element {
  useTranslation()
  const language = (node.attrs.language as string) || ''
  const [copied, setCopied] = useState(false)
  const copiedResetTimerRef = useRef<number | null>(null)
  // Why: clipboard IPC can resolve after the node view unmounts; avoid
  // starting a reset timer that will outlive the component.
  const isMountedRef = useRef(false)
  const settings = useAppStore((s) => s.settings)
  const isDark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const isMermaid = language === 'mermaid'
  const mermaidSource = node.textContent.trim()
  const hasMermaidDiagram = isMermaid && mermaidSource.length > 0
  // Why optimistic: mermaid renders asynchronously, so starting at `false`
  // would flash the source on every mount before collapsing it again.
  const [isMermaidRendered, setIsMermaidRendered] = useState(true)
  const [isEditingMermaidSource, setIsEditingMermaidSource] = useState(false)
  const [isBlockSelected, setIsBlockSelected] = useState(false)
  const [annotationState, setAnnotationState] = useState<'none' | 'noted' | 'active'>('none')
  // Why ref: position math needs the current node without resubscribing the
  // selection listener on every keystroke.
  const nodeRef = useRef(node)
  nodeRef.current = node
  const isMermaidSourceCollapsed = hasMermaidDiagram && isMermaidRendered && !isEditingMermaidSource

  // Why sticky: only a caret landing inside the fence means "edit this source",
  // and only a selection that leaves the fence entirely means "done". A range
  // selection covering the block — the diagram click, a cross-block drag, a
  // drag inside the open source — must not toggle it, or the block would resize
  // mid-gesture and the source would pop open behind the review-note composer.
  useEffect(() => {
    if (!hasMermaidDiagram) {
      setIsEditingMermaidSource(false)
      setIsBlockSelected(false)
      return
    }
    const sync = (): void => {
      const pos = getPos()
      if (pos === undefined) {
        return
      }
      const blockEnd = pos + nodeRef.current.nodeSize
      const { from, to, empty } = editor.state.selection
      const touchesBlock = from < blockEnd && to > pos
      setIsEditingMermaidSource((isEditing) => {
        if (empty) {
          return from > pos && from < blockEnd
        }
        return touchesBlock ? isEditing : false
      })
      setIsBlockSelected(!empty && from <= pos + 1 && to >= blockEnd - 1)
      // Why: the note highlight is an inline decoration over the hidden source,
      // so the collapsed diagram has to carry the "has a review note" state and
      // the attention pulse itself.
      const highlights = richMarkdownAnnotationHighlightPluginKey.getState(editor.state)
      const coversBlock = (range: { from: number; to: number }): boolean =>
        range.from < blockEnd && range.to > pos
      const activeRange = highlights?.activeRange
      setAnnotationState(
        activeRange && coversBlock(activeRange)
          ? 'active'
          : highlights?.noteRanges.some(coversBlock)
            ? 'noted'
            : 'none'
      )
    }
    sync()
    // Why transaction: note highlights arrive as metadata-only transactions,
    // which fire neither `update` nor `selectionUpdate`.
    editor.on('transaction', sync)
    return () => {
      editor.off('transaction', sync)
    }
  }, [editor, getPos, hasMermaidDiagram])

  // Why NodeSelection and not a text range over the source: the source is
  // display:none, and a text selection inside it cannot survive the round trip
  // through the browser's own selection — the annotation target reads back empty.
  const handleDiagramMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) {
        return
      }
      const pos = getPos()
      if (pos === undefined) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const { state } = editor.view
      editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
      editor.view.focus()
      // Why dispatch the click by hand: preventDefault above stops ProseMirror's
      // own click sequence, so the routing that focuses an existing review note
      // never runs. Feed it a position inside the fence, where the note lives.
      editor.view.someProp('handleClick', (handleClick) =>
        handleClick(editor.view, pos + 1, event.nativeEvent)
      )
    },
    [editor, getPos]
  )

  // Why: with the source collapsed, a double-click is the way back into editing.
  const handleDiagramDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const pos = getPos()
      if (pos === undefined) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      editor.commands.setTextSelection(pos + nodeRef.current.nodeSize - 1)
      editor.view.focus()
    },
    [editor, getPos]
  )

  const clearCopiedResetTimer = useCallback((): void => {
    if (copiedResetTimerRef.current !== null) {
      window.clearTimeout(copiedResetTimerRef.current)
      copiedResetTimerRef.current = null
    }
  }, [])

  const setCopyButtonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      isMountedRef.current = node !== null
      if (node === null) {
        clearCopiedResetTimer()
      }
    },
    [clearCopiedResetTimer]
  )

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateAttributes({ language: e.target.value })
    },
    [updateAttributes]
  )

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const text = node.textContent
      void window.api.ui
        .writeClipboardText(text)
        .then(() => {
          if (!isMountedRef.current) {
            return
          }
          clearCopiedResetTimer()
          setCopied(true)
          copiedResetTimerRef.current = window.setTimeout(() => {
            copiedResetTimerRef.current = null
            setCopied(false)
          }, 1500)
        })
        .catch(() => {
          // Silently swallow clipboard write failures (e.g. permission denied).
        })
    },
    [clearCopiedResetTimer, node]
  )

  return (
    <NodeViewWrapper
      className={[
        'rich-markdown-code-block-wrapper',
        isMermaidSourceCollapsed ? 'is-mermaid-source-collapsed' : '',
        isMermaidSourceCollapsed && isBlockSelected ? 'is-mermaid-selected' : '',
        isMermaidSourceCollapsed && annotationState !== 'none' ? 'is-mermaid-annotated' : '',
        isMermaidSourceCollapsed && annotationState === 'active'
          ? 'is-mermaid-annotation-active'
          : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <select
        className="rich-markdown-code-block-lang"
        contentEditable={false}
        value={language}
        onChange={onChange}
      >
        {RICH_MARKDOWN_CODE_BLOCK_LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
        {/* If the document has a language not in our list, show it as-is */}
        {language && !RICH_MARKDOWN_CODE_BLOCK_LANGUAGES.some((l) => l.value === language) ? (
          <option value={language}>{language}</option>
        ) : null}
      </select>
      <button
        ref={setCopyButtonRef}
        type="button"
        className="code-block-copy-btn"
        contentEditable={false}
        onClick={handleCopy}
        aria-label={translate(
          'auto.components.editor.RichMarkdownCodeBlock.c72beafc0f',
          'Copy code'
        )}
        title={translate('auto.components.editor.RichMarkdownCodeBlock.c72beafc0f', 'Copy code')}
      >
        {copied ? (
          <>
            <Check size={14} />
            <span className="code-block-copy-label">
              {translate('auto.components.editor.RichMarkdownCodeBlock.232d9ed853', 'Copied')}
            </span>
          </>
        ) : (
          <Copy size={14} />
        )}
      </button>
      <NodeViewContent<'pre'> as="pre" />
      {/* Why: a valid mermaid fence collapses to just its rendered SVG — the
          source is still the editable code block, hidden by CSS until the caret
          enters it (or the diagram fails to render). The preview goes through
          MermaidBlock's sanitized SVG path, so it must opt out of Mermaid HTML
          labels just like markdown preview to keep labels visible. */}
      {hasMermaidDiagram && (
        <div
          contentEditable={false}
          className="mermaid-preview"
          onMouseDown={handleDiagramMouseDown}
          onDoubleClick={handleDiagramDoubleClick}
          title={
            isMermaidSourceCollapsed
              ? translate(
                  'auto.components.editor.RichMarkdownCodeBlock.219961c2ed',
                  'Double-click to edit the diagram source'
                )
              : undefined
          }
        >
          <MermaidBlock
            content={mermaidSource}
            isDark={isDark}
            htmlLabels={false}
            onRenderStateChange={setIsMermaidRendered}
          />
        </div>
      )}
    </NodeViewWrapper>
  )
}
