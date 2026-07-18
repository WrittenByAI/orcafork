import type { DiffComment } from './types'

function isMarkdownComment(comment: Pick<DiffComment, 'source'>): boolean {
  return comment.source === 'markdown'
}

function isCanvasComment(comment: Pick<DiffComment, 'source'>): boolean {
  return comment.source === 'canvas'
}

// Why: the pasted format is the contract between review notes and whichever
// agent consumes them. Keep it deterministic and quote-safe across clients.
export function formatDiffComment(c: DiffComment): string {
  const escaped = c.body
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
  // Why: canvas notes are scoped to a tldraw shape selection, not a text
  // line/range — there is no Line:/Lines:/Scope: concept for them. Their
  // shape summary (selectedText) stands in for the location line instead.
  if (isCanvasComment(c)) {
    return [
      `File: ${c.filePath}`,
      'Source: canvas',
      `Shapes: ${c.selectedText ?? ''}`,
      `User comment: "${escaped}"`
    ].join('\n')
  }
  const locationLabel =
    c.lineNumber === 0
      ? 'Scope: file'
      : c.startLine !== undefined && c.startLine !== c.lineNumber
        ? `Lines: ${c.startLine}-${c.lineNumber}`
        : `Line: ${c.lineNumber}`
  if (!isMarkdownComment(c)) {
    return [`File: ${c.filePath}`, locationLabel, `User comment: "${escaped}"`].join('\n')
  }
  return [
    `File: ${c.filePath}`,
    'Source: markdown',
    locationLabel,
    `User comment: "${escaped}"`
  ].join('\n')
}

export function formatDiffComments(comments: readonly DiffComment[]): string {
  return comments.map(formatDiffComment).join('\n\n')
}
