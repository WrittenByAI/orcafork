import type { Editor, TLShape } from 'tldraw'

// Why: canvas notes (DiffComment source: 'canvas') carry a `selectedText`
// summary instead of a line's source text, since there is no line number on a
// tldraw canvas. This gives the AI prompt (and the notes rail UI) a
// human-readable description of what was selected, e.g.
// `3 shapes: 2 geo ("Login", "DB"), 1 arrow`.
//
// Deliberately dependency-free at runtime: tldraw does ship a
// `renderPlaintextFromRichText(editor, richText)` helper, but importing any
// *runtime* binding from the `tldraw` package pulls in its rich-text module,
// which imports `@tiptap/extension-highlight` — and the version of
// `@tiptap/core` resolved in this repo's node_modules does not provide the
// `getStyleProperty` export that package expects. That makes `tldraw` an
// unimportable-as-a-value module under this project's Vitest/Node ESM
// resolution today (confirmed: even `import('tldraw')` alone throws
// `SyntaxError: The requested module '@tiptap/core' does not provide an
// export named 'getStyleProperty'`), even though Vite's bundler is lenient
// enough for the real app to load it fine. `Editor`/`TLShape` above are
// `import type` only — erased at compile time — so this module has zero
// runtime dependency on tldraw and stays unit-testable. Plain text is
// extracted by walking the TLRichText JSON doc directly (schema documented
// in @tldraw/tlschema's richTextValidator: `{ type, content: [...] }`, text
// leaves are `{ type: 'text', text: string }`).

// Why: `summarizeSelection` only calls this one Editor method — a narrow
// Pick keeps the unit test's fake editor honest about that surface (see
// tldraw-canvas-notes.test.ts).
export type CanvasNoteSummaryEditor = Pick<Editor, 'getSelectedShapes'>

const MAX_EXCERPTS = 3
const MAX_EXCERPT_LENGTH = 30
const MAX_SUMMARY_LENGTH = 200
const MAX_RICH_TEXT_DEPTH = 32
const ELLIPSIS = '…'

type ShapeGroup = {
  type: string
  count: number
  excerpts: string[]
}

/** Builds a short, human-readable summary of the shapes currently selected on
 *  the canvas, for use as a DiffComment's `selectedText`. Returns '' when
 *  nothing is selected or the editor can't be read — callers should treat
 *  that as "no summary available", not an error. */
export function summarizeSelection(editor: CanvasNoteSummaryEditor): string {
  let shapes: TLShape[]
  try {
    shapes = editor.getSelectedShapes()
  } catch {
    return ''
  }
  if (!Array.isArray(shapes) || shapes.length === 0) {
    return ''
  }

  const groups: ShapeGroup[] = []
  const groupIndexByType = new Map<string, number>()
  let excerptBudget = MAX_EXCERPTS

  for (const shape of shapes) {
    const type = shapeType(shape)
    let groupIndex = groupIndexByType.get(type)
    if (groupIndex === undefined) {
      groupIndex = groups.length
      groupIndexByType.set(type, groupIndex)
      groups.push({ type, count: 0, excerpts: [] })
    }
    const group = groups[groupIndex]
    group.count += 1

    if (excerptBudget <= 0) {
      continue
    }
    const excerpt = extractShapeExcerpt(shape)
    if (excerpt) {
      group.excerpts.push(truncate(excerpt, MAX_EXCERPT_LENGTH))
      excerptBudget -= 1
    }
  }

  const groupSummaries = groups.map(({ type, count, excerpts }) => {
    const label = `${count} ${type}`
    return excerpts.length === 0
      ? label
      : `${label} (${excerpts.map((excerpt) => `"${excerpt}"`).join(', ')})`
  })

  const summary = `${shapes.length} shapes: ${groupSummaries.join(', ')}`
  return truncate(summary, MAX_SUMMARY_LENGTH)
}

// Why: defensive against a shape record that isn't a plain object (e.g. a
// proxy that throws on property access) — never let one bad shape break the
// whole summary.
function shapeType(shape: TLShape): string {
  try {
    const type = (shape as { type?: unknown })?.type
    return typeof type === 'string' && type.length > 0 ? type : 'shape'
  } catch {
    return 'shape'
  }
}

// Why: .tldr content can be hand-authored or agent-generated, so a shape's
// `props` may be missing or `richText` may not match the TLRichText schema.
// None of that should ever break the "Add note" flow — it should just fall
// back to no excerpt for that shape.
function extractShapeExcerpt(shape: TLShape): string {
  try {
    const props = (shape as { props?: unknown })?.props as Record<string, unknown> | undefined
    if (!props) {
      return ''
    }
    const rawText = props.text
    if (typeof rawText === 'string' && rawText.trim().length > 0) {
      return rawText.trim()
    }
    const richText = props.richText
    if (richText && typeof richText === 'object') {
      return extractPlainTextFromRichText(richText).trim()
    }
  } catch {
    return ''
  }
  return ''
}

// Why: a small hand-rolled walk instead of tldraw's own renderer — see the
// module doc comment above for why we can't import that helper here. Depth
// is capped defensively; .tldr JSON can't contain real cycles, but this
// keeps a pathological/agent-generated doc from ever recursing unbounded.
function extractPlainTextFromRichText(node: unknown, depth = 0): string {
  if (depth > MAX_RICH_TEXT_DEPTH || !node || typeof node !== 'object') {
    return ''
  }
  const { type, text, content } = node as { type?: unknown; text?: unknown; content?: unknown }
  if (type === 'text' && typeof text === 'string') {
    return text
  }
  if (!Array.isArray(content)) {
    return ''
  }
  const parts: string[] = []
  for (const child of content) {
    const part = extractPlainTextFromRichText(child, depth + 1)
    if (part) {
      parts.push(part)
    }
  }
  return parts.join(' ')
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  if (max <= ELLIPSIS.length) {
    return ELLIPSIS.slice(0, max)
  }
  return `${text.slice(0, max - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`
}
