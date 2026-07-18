import type { DiffComment, DiffCommentSource } from '../../../shared/types'

export function getDiffCommentSource(comment: Pick<DiffComment, 'source'>): DiffCommentSource {
  if (comment.source === 'markdown') {
    return 'markdown'
  }
  if (comment.source === 'canvas') {
    return 'canvas'
  }
  return 'diff'
}

export function isDiffComment(comment: Pick<DiffComment, 'source'>): boolean {
  return getDiffCommentSource(comment) === 'diff'
}

export function isMarkdownComment(comment: Pick<DiffComment, 'source'>): boolean {
  return getDiffCommentSource(comment) === 'markdown'
}

export function isCanvasComment(comment: Pick<DiffComment, 'source'>): boolean {
  return getDiffCommentSource(comment) === 'canvas'
}

export function getDiffCommentLineLabel(
  comment: Pick<DiffComment, 'lineNumber' | 'source' | 'startLine'>,
  compact = false
): string {
  // Why: canvas notes are file-scoped tldraw selections, not text lines —
  // showing "Line 0" would be meaningless, so surface a source-specific
  // label instead.
  if (isCanvasComment(comment)) {
    return 'Canvas'
  }
  if (comment.startLine !== undefined && comment.startLine !== comment.lineNumber) {
    return compact
      ? `L${comment.startLine}-L${comment.lineNumber}`
      : `Lines ${comment.startLine}-${comment.lineNumber}`
  }
  return compact ? `L${comment.lineNumber}` : `Line ${comment.lineNumber}`
}
