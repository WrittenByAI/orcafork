import type { Editor } from '@tiptap/react'

const RICH_MARKDOWN_ANNOTATION_BUTTON_SIZE_PX = 24
const RICH_MARKDOWN_ANNOTATION_EDGE_PADDING_PX = 8
const RICH_MARKDOWN_ANNOTATION_SELECTION_GAP_PX = 8
const RICH_MARKDOWN_ANNOTATION_MIN_LEFT_PX = 56
const RICH_MARKDOWN_ANNOTATION_RIGHT_OFFSET_PX = 42
const RICH_MARKDOWN_ANNOTATION_POPOVER_WIDTH_PX = 420
const RICH_MARKDOWN_ANNOTATION_POPOVER_RIGHT_OFFSET_PX = 24
const RICH_MARKDOWN_ANNOTATION_POPOVER_MIN_HEIGHT_PX = 220

export type RichMarkdownAnnotationAnchor = {
  top: number
  left: number
  buttonTop: number
  buttonLeft: number
}

function getCurrentRichMarkdownSelectionRect(root: HTMLElement): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) {
    return null
  }
  const rect = range.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) {
    return rect
  }
  return Array.from(range.getClientRects()).find((candidate) => candidate.width > 0) ?? null
}

function getRenderedAncestorRect(node: Node | null, bound: HTMLElement): DOMRect | null {
  let element = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  while (element && element !== bound && bound.contains(element)) {
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 || rect.height > 0) {
      return rect
    }
    element = element.parentElement
  }
  return null
}

/**
 * Why: a document position inside a collapsed mermaid fence sits in a
 * `display: none` content hole, so its own box is empty. Climb to the nearest
 * rendered ancestor — the fence's wrapper — and measure that instead.
 */
export function getRichMarkdownRenderedRectAtPos(
  editor: Editor,
  pos: number,
  bound: HTMLElement
): DOMRect | null {
  let node: Node | null = null
  try {
    node = editor.view.nodeDOM(pos) ?? editor.view.domAtPos(pos).node
  } catch {
    return null
  }
  return getRenderedAncestorRect(node, bound)
}

export function getRichMarkdownAnnotationSelectionRect(
  editor: Editor,
  root: HTMLElement
): DOMRect | null {
  return (
    getCurrentRichMarkdownSelectionRect(root) ??
    getRichMarkdownRenderedRectAtPos(editor, editor.state.selection.from, root)
  )
}

export function getRichMarkdownAnnotationButtonTop(
  selectionBottomInRoot: number,
  rootHeight: number
): number {
  const preferredTop = selectionBottomInRoot + RICH_MARKDOWN_ANNOTATION_SELECTION_GAP_PX
  const maxTop = Math.max(
    RICH_MARKDOWN_ANNOTATION_EDGE_PADDING_PX,
    rootHeight - RICH_MARKDOWN_ANNOTATION_BUTTON_SIZE_PX - RICH_MARKDOWN_ANNOTATION_EDGE_PADDING_PX
  )
  return Math.max(RICH_MARKDOWN_ANNOTATION_EDGE_PADDING_PX, Math.min(preferredTop, maxTop))
}

export function getRichMarkdownAnnotationButtonLeft(rootWidth: number): number {
  const preferredLeft = Math.max(
    RICH_MARKDOWN_ANNOTATION_MIN_LEFT_PX,
    rootWidth - RICH_MARKDOWN_ANNOTATION_RIGHT_OFFSET_PX
  )
  const maxLeft = Math.max(
    RICH_MARKDOWN_ANNOTATION_EDGE_PADDING_PX,
    rootWidth - RICH_MARKDOWN_ANNOTATION_BUTTON_SIZE_PX - RICH_MARKDOWN_ANNOTATION_EDGE_PADDING_PX
  )
  return Math.min(preferredLeft, maxLeft)
}

export function getRichMarkdownAnnotationAnchor(
  selectionRect: DOMRect,
  rootRect: DOMRect
): RichMarkdownAnnotationAnchor {
  // Why: long selections can extend below the visible editor shell; keep the
  // add-note affordance reachable instead of anchoring to hidden selection area.
  const buttonTop = getRichMarkdownAnnotationButtonTop(
    selectionRect.bottom - rootRect.top,
    rootRect.height
  )
  return {
    top: Math.max(
      RICH_MARKDOWN_ANNOTATION_EDGE_PADDING_PX,
      Math.min(
        buttonTop + RICH_MARKDOWN_ANNOTATION_BUTTON_SIZE_PX + 6,
        rootRect.height - RICH_MARKDOWN_ANNOTATION_POPOVER_MIN_HEIGHT_PX
      )
    ),
    left: Math.max(
      RICH_MARKDOWN_ANNOTATION_MIN_LEFT_PX,
      rootRect.width -
        RICH_MARKDOWN_ANNOTATION_POPOVER_WIDTH_PX -
        RICH_MARKDOWN_ANNOTATION_POPOVER_RIGHT_OFFSET_PX
    ),
    buttonTop,
    buttonLeft: getRichMarkdownAnnotationButtonLeft(rootRect.width)
  }
}
