import { createContext, useContext } from 'react'

// Why: TldrawSelectionOverlay renders as tldraw's `InFrontOfTheCanvas` slot,
// which tldraw instantiates with no props of its own (ComponentType | null —
// see @tldraw/editor's TLEditorComponents). This context is how it reaches the
// Orca identifiers (worktree/file) it needs to file a canvas annotation or
// open an issue dialog, without TldrawViewer having to thread them through a
// prop tldraw itself does not forward.
export type TldrawViewerContextValue = {
  worktreeId: string
  relativePath: string
  filePath: string
}

const DEFAULT_TLDRAW_VIEWER_CONTEXT: TldrawViewerContextValue = {
  worktreeId: '',
  relativePath: '',
  filePath: ''
}

export const TldrawViewerContext = createContext<TldrawViewerContextValue>(
  DEFAULT_TLDRAW_VIEWER_CONTEXT
)

export function useTldrawViewerContext(): TldrawViewerContextValue {
  return useContext(TldrawViewerContext)
}
