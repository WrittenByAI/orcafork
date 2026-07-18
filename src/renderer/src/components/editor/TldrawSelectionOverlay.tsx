import { useState } from 'react'
import { CircleDot, Plus, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor, useValue } from 'tldraw'
import { DiffCommentPopover } from '../diff-comments/DiffCommentPopover'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { summarizeSelection } from './tldraw-canvas-notes'
import { TldrawIssueDialog } from './TldrawIssueDialog'
import { useTldrawViewerContext } from './tldraw-viewer-context'

// Why: rendered as tldraw's `InFrontOfTheCanvas` slot component, which tldraw
// instantiates with no props (see @tldraw/editor's TLEditorComponents —
// `InFrontOfTheCanvas?: ComponentType | null`). Everything this component
// needs — the live Editor instance and the Orca file identifiers — comes from
// useEditor() and useTldrawViewerContext() respectively, not props.
//
// "Add note" opens the shared DiffCommentPopover (see
// RichMarkdownAnnotationOverlay.tsx for the sibling pattern on markdown) and
// calls addDiffComment({ source: 'canvas', ... }) with a shape summary from
// summarizeSelection(editor). "Create issue" opens TldrawIssueDialog, which
// captures a screenshot of the current selection at open time.

type SelectionToolbarBounds = {
  top: number
  left: number
  width: number
}

// Why: captured from `bounds` at the moment "Add note" is clicked, along with
// the shape summary — both need to survive the selection changing (or
// clearing entirely) while the popover is still open for the user to type a
// note.
type CanvasNotePopoverState = {
  top: number
  left: number
  summary: string
}

const TOOLBAR_VERTICAL_GAP = 8

function useSelectionToolbarBounds(): SelectionToolbarBounds | null {
  const editor = useEditor()
  return useValue(
    'tldraw selection overlay bounds',
    () => {
      if (editor.getSelectedShapeIds().length === 0) {
        return null
      }
      const selectionBounds = editor.getSelectionRotatedScreenBounds()
      if (!selectionBounds) {
        return null
      }
      const viewportBounds = editor.getViewportScreenBounds()
      return {
        top: selectionBounds.y - viewportBounds.y,
        left: selectionBounds.x - viewportBounds.x,
        width: selectionBounds.w
      }
    },
    [editor]
  )
}

function ToolbarButton({
  label,
  icon: Icon,
  onClick
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
      aria-label={label}
      title={label}
      // Why: without this, tldraw's canvas pointer handling treats the press
      // as the start of a canvas interaction (e.g. deselecting shapes) before
      // the click ever fires.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
    </button>
  )
}

export function TldrawSelectionOverlay(): React.JSX.Element | null {
  const editor = useEditor()
  const { worktreeId, relativePath } = useTldrawViewerContext()
  const addDiffComment = useAppStore((s) => s.addDiffComment)
  const bounds = useSelectionToolbarBounds()
  const [notePopover, setNotePopover] = useState<CanvasNotePopoverState | null>(null)
  const [issueDialogOpen, setIssueDialogOpen] = useState(false)

  // Why: the dialog must stay mounted while open even if the selection clears
  // (clicking inside the portal-rendered dialog can deselect the shapes).
  if (!bounds && !notePopover && !issueDialogOpen) {
    return null
  }

  const handleAddNote = (): void => {
    if (!bounds) {
      return
    }
    // Why: capture position + summary now — both must survive the selection
    // changing or clearing while the popover stays open for the user to type.
    setNotePopover({ top: bounds.top, left: bounds.left, summary: summarizeSelection(editor) })
  }

  const handleCreateIssue = (): void => {
    setIssueDialogOpen(true)
  }

  const handleCancelNote = (): void => {
    setNotePopover(null)
  }

  const handleSubmitNote = async (body: string): Promise<void> => {
    if (!notePopover || !worktreeId) {
      return
    }
    const result = await addDiffComment({
      worktreeId,
      filePath: relativePath,
      source: 'canvas',
      lineNumber: 0,
      selectedText: notePopover.summary,
      body,
      side: 'modified'
    })
    if (result) {
      setNotePopover(null)
      toast.success(
        translate(
          'auto.components.editor.TldrawSelectionOverlay.2527661029',
          'Note added — send it from the notes rail or header menu.'
        )
      )
    } else {
      console.error('Failed to add canvas note — draft preserved')
    }
  }

  return (
    <>
      {bounds && !notePopover && (
        <div
          className="pointer-events-none absolute z-20"
          style={{
            top: bounds.top,
            left: bounds.left + bounds.width / 2,
            transform: `translate(-50%, calc(-100% - ${TOOLBAR_VERTICAL_GAP}px))`
          }}
        >
          <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-border bg-background p-1 shadow-md">
            {worktreeId && (
              <ToolbarButton
                label={translate(
                  'auto.components.editor.TldrawSelectionOverlay.794fe9e3f0',
                  'Add note'
                )}
                icon={Plus}
                onClick={handleAddNote}
              />
            )}
            {worktreeId && (
              <ToolbarButton
                label={translate(
                  'auto.components.editor.TldrawSelectionOverlay.399114e333',
                  'Create issue'
                )}
                icon={CircleDot}
                onClick={handleCreateIssue}
              />
            )}
          </div>
        </div>
      )}
      {issueDialogOpen && (
        <TldrawIssueDialog
          editor={editor}
          worktreeId={worktreeId}
          relativePath={relativePath}
          open={issueDialogOpen}
          onOpenChange={setIssueDialogOpen}
        />
      )}
      {notePopover && (
        // Why: pointer-events-auto + inset-0 re-enables clicks inside tldraw's
        // `.tl-canvas__in-front` layer (which is pointer-events:none so empty
        // canvas area keeps panning/selecting through it — see
        // useSelectionToolbarBounds's sibling toolbar for the same pattern)
        // and gives the popover's own clamp-to-viewport logic
        // (resolveDiffCommentPopoverTop) an accurately-sized offset parent.
        // DiffCommentPopover itself stops propagation on its own root, so
        // clicks on the popover never reach the canvas underneath.
        <div className="pointer-events-auto absolute inset-0 z-30">
          <DiffCommentPopover
            key="tldraw-canvas-note"
            lineNumber={0}
            top={notePopover.top}
            left={notePopover.left}
            title={translate(
              'auto.components.editor.TldrawSelectionOverlay.195675b721',
              'Note on selected shapes'
            )}
            onCancel={handleCancelNote}
            onSubmit={handleSubmitNote}
          />
        </div>
      )}
    </>
  )
}
