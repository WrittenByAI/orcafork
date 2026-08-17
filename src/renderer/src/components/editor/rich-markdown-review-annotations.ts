import type { Dispatch, SetStateAction } from 'react'
import type { Editor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import type { DiffComment } from '../../../../shared/diff-comment-types'
import type { RichMarkdownAnnotationHighlightRange } from './rich-markdown-annotation-highlight'
import {
  getRichMarkdownLineRangeFromBlocks,
  getRichMarkdownRangeStart
} from './rich-markdown-range-bounds'
import type { RichMarkdownReviewNotePosition } from './rich-markdown-review-note-layout'
import { findRichMarkdownSelectedTextRanges } from './rich-markdown-review-text-ranges'
import { getRichMarkdownSelectionVisibleText } from './rich-markdown-visible-text-map'
import { countRichMarkdownReviewMarkdownLines } from './rich-markdown-review-line-count'
import {
  getRichMarkdownAnnotationAnchor,
  getRichMarkdownAnnotationSelectionRect,
  getRichMarkdownRenderedRectAtPos
} from './rich-markdown-annotation-anchor-geometry'
export { countRichMarkdownReviewMarkdownLines } from './rich-markdown-review-line-count'

export type RichMarkdownCommentBlock = {
  key: string
  startLine: number
  endLine: number
  from: number
  to: number
}

export type RichMarkdownComposerState = {
  lineNumber: number
  startLine?: number
}

export type RichMarkdownAnnotationTarget = RichMarkdownComposerState & {
  from: number
  to: number
  selectedText: string
  top: number
  left?: number
  buttonTop: number
  buttonLeft: number
}

function serializeRichMarkdownJson(editor: Editor, content: JSONContent[]): string {
  return (editor.markdown?.serialize({ type: 'doc', content }) ?? '').trimEnd()
}

export function buildRichMarkdownCommentBlocks(editor: Editor): RichMarkdownCommentBlock[] {
  const jsonContent = editor.getJSON().content ?? []
  const blocks: RichMarkdownCommentBlock[] = []
  let nextLine = 1
  let previousNodeJson: JSONContent | null = null
  let previousNodeLineCount = 0

  editor.state.doc.forEach((node, nodeOffset, index) => {
    const nodeJson = jsonContent[index]
    if (!nodeJson) {
      return
    }
    const nodeMarkdown = serializeRichMarkdownJson(editor, [nodeJson])
    const nodeLineCount = countRichMarkdownReviewMarkdownLines(nodeMarkdown)
    if (previousNodeJson) {
      const pairMarkdown = serializeRichMarkdownJson(editor, [previousNodeJson, nodeJson])
      const separatorLineCount = Math.max(
        0,
        countRichMarkdownReviewMarkdownLines(pairMarkdown) - previousNodeLineCount - nodeLineCount
      )
      nextLine += separatorLineCount
    }
    const startLine = nextLine
    const endLine = Math.max(startLine, startLine + nodeLineCount - 1)
    const from = nodeOffset + 1
    blocks.push({
      key: `${index}:${startLine}-${endLine}`,
      startLine,
      endLine,
      from,
      to: from + Math.max(0, node.nodeSize - 1)
    })
    nextLine = endLine + 1
    previousNodeJson = nodeJson
    previousNodeLineCount = nodeLineCount
  })

  if (blocks.length === 0) {
    blocks.push({ key: 'empty:1-1', startLine: 1, endLine: 1, from: 1, to: 1 })
  }

  return blocks
}

export function clampRichMarkdownAnnotationTarget(
  editor: Editor,
  target: RichMarkdownAnnotationTarget
): RichMarkdownAnnotationTarget | null {
  const maxPos = Math.max(1, editor.state.doc.content.size)
  const from = Math.max(1, Math.min(target.from, maxPos))
  const to = Math.max(1, Math.min(target.to, maxPos))
  const clampedFrom = Math.min(from, to)
  const clampedTo = Math.max(from, to)
  if (clampedFrom === clampedTo) {
    return null
  }
  return { ...target, from: clampedFrom, to: clampedTo }
}

export function clearRichMarkdownNotePositions(
  setNotePositions: Dispatch<SetStateAction<RichMarkdownReviewNotePosition[]>>
): void {
  setNotePositions((current) => (current.length === 0 ? current : []))
}

export function getRichMarkdownAnnotationHighlightRanges(
  editor: Editor,
  comments: readonly DiffComment[],
  markdownSourceLineOffset: number
): RichMarkdownAnnotationHighlightRange[] {
  if (comments.length === 0) {
    return []
  }
  // Why once: block resolution re-serializes the doc; per comment it was O(n*doc).
  const blocks = buildRichMarkdownCommentBlocks(editor)
  return comments.flatMap((comment) =>
    getRichMarkdownAnnotationHighlightRangesForComment(
      editor,
      comment,
      markdownSourceLineOffset,
      blocks
    )
  )
}

export function getRichMarkdownAnnotationHighlightRangesForComment(
  editor: Editor,
  comment: DiffComment,
  markdownSourceLineOffset: number,
  // Why optional: callers looping over comments pass one shared build.
  prebuiltBlocks?: RichMarkdownCommentBlock[]
): RichMarkdownAnnotationHighlightRange[] {
  const blocks = prebuiltBlocks ?? buildRichMarkdownCommentBlocks(editor)
  const selectedText = comment.selectedText?.trim()
  if (!selectedText) {
    return []
  }
  const bodyLineNumber = Math.max(1, comment.lineNumber - markdownSourceLineOffset)
  const block = blocks.find(
    (candidate) => candidate.startLine <= bodyLineNumber && bodyLineNumber <= candidate.endLine
  )
  if (block) {
    const blockRanges = findRichMarkdownSelectedTextRanges({
      editor,
      selectedText,
      from: block.from,
      to: block.to
    })
    if (blockRanges.length > 0) {
      return blockRanges
    }
  }
  return findRichMarkdownSelectedTextRanges({ editor, selectedText })
}

export function getRichMarkdownCommentAtPos(
  editor: Editor,
  comments: readonly DiffComment[],
  markdownSourceLineOffset: number,
  pos: number
): DiffComment | null {
  if (comments.length === 0) {
    return null
  }
  const blocks = buildRichMarkdownCommentBlocks(editor)
  return (
    comments.find((comment) =>
      getRichMarkdownAnnotationHighlightRangesForComment(
        editor,
        comment,
        markdownSourceLineOffset,
        blocks
      ).some((range) => range.from <= pos && pos <= range.to)
    ) ?? null
  )
}

/**
 * Why: a note anchored inside a collapsed mermaid fence resolves to a
 * `display: none` subtree, where coordsAtPos reports a degenerate box near the
 * viewport origin — which would pin the note card to the top of the document
 * instead of beside its diagram.
 */
function getRichMarkdownAnchorTopInViewport(editor: Editor, pos: number): number {
  const coordsTop = editor.view.coordsAtPos(pos).top
  const renderedRect = getRichMarkdownRenderedRectAtPos(editor, pos, editor.view.dom)
  if (!renderedRect || (coordsTop >= renderedRect.top && coordsTop <= renderedRect.bottom)) {
    return coordsTop
  }
  return renderedRect.top
}

export function getRichMarkdownCommentAnchorTop(
  editor: Editor,
  comment: DiffComment,
  block: RichMarkdownCommentBlock,
  containerRect: DOMRect,
  containerScrollTop: number,
  markdownSourceLineOffset: number
): number | null {
  try {
    const ranges = getRichMarkdownAnnotationHighlightRangesForComment(
      editor,
      comment,
      markdownSourceLineOffset
    )
    // Why: range notes should sort by the start of the selected text. Anchoring
    // to the end puts overlapping ranges with the same final line in creation
    // order, so a 43-45 card can render above a 41-45 card.
    const anchorPos = Math.max(
      1,
      Math.min(getRichMarkdownRangeStart(ranges) ?? block.from, editor.state.doc.content.size)
    )
    return (
      getRichMarkdownAnchorTopInViewport(editor, anchorPos) - containerRect.top + containerScrollTop
    )
  } catch {
    return null
  }
}

/**
 * Why strict overlap for ranges: a NodeSelection — how a collapsed mermaid
 * diagram gets selected — starts at the node's own position, which is also the
 * previous block's end. An inclusive test would file the note against that
 * block too, and the resulting line range would no longer match the one a hand
 * selection of the same source produces.
 */
export function getRichMarkdownSelectionLineRange(editor: Editor): RichMarkdownComposerState {
  const blocks = buildRichMarkdownCommentBlocks(editor)
  const { from, to, empty } = editor.state.selection
  const selectedBlocks = empty
    ? blocks.filter((block) => block.from <= from && from <= block.to)
    : blocks.filter((block) => from < block.to && to > block.from)
  const targetBlocks = selectedBlocks.length > 0 ? selectedBlocks : [blocks[0]!]
  return getRichMarkdownLineRangeFromBlocks(targetBlocks) ?? { lineNumber: 1 }
}

export function hasRichMarkdownCommentForRange(
  comments: readonly DiffComment[],
  target: Pick<RichMarkdownAnnotationTarget, 'lineNumber' | 'selectedText' | 'startLine'>,
  markdownSourceLineOffset: number
): boolean {
  const startLine = (target.startLine ?? target.lineNumber) + markdownSourceLineOffset
  const endLine = target.lineNumber + markdownSourceLineOffset
  const selectedText = target.selectedText.trim()
  return comments.some((comment) => {
    const commentStartLine = comment.startLine ?? comment.lineNumber
    return (
      commentStartLine === startLine &&
      comment.lineNumber === endLine &&
      (comment.selectedText?.trim() ?? '') === selectedText
    )
  })
}

export function getRichMarkdownAnnotationTarget(
  editor: Editor,
  root: HTMLElement
): RichMarkdownAnnotationTarget | null {
  if (editor.state.selection.empty) {
    return null
  }
  const rect = getRichMarkdownAnnotationSelectionRect(editor, root)
  if (!rect) {
    return null
  }
  const selectedText = getRichMarkdownSelectionVisibleText(editor.state)
  if (!selectedText) {
    return null
  }
  return {
    ...getRichMarkdownSelectionLineRange(editor),
    from: editor.state.selection.from,
    to: editor.state.selection.to,
    selectedText,
    ...getRichMarkdownAnnotationAnchor(rect, root.getBoundingClientRect())
  }
}
