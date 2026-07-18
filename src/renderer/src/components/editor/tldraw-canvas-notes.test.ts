import { describe, expect, it } from 'vitest'
import type { TLShape } from 'tldraw'
import { summarizeSelection, type CanvasNoteSummaryEditor } from './tldraw-canvas-notes'

// Why: `summarizeSelection` only reads `shape.type` and `shape.props` (via
// tldraw-canvas-notes.ts's own dependency-free TLRichText walker — see that
// file's doc comment for why it doesn't call tldraw's own
// `renderPlaintextFromRichText`), so a fake shape only needs those two
// fields to exercise every branch.
function fakeShape(type: string, props: Record<string, unknown> = {}): TLShape {
  return {
    id: `shape:${type}-${Math.random().toString(36).slice(2)}`,
    typeName: 'shape',
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    parentId: 'page:page',
    isLocked: false,
    opacity: 1,
    meta: {},
    props
  } as unknown as TLShape
}

function richTextDoc(text: string): unknown {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }]
  }
}

function fakeEditor(shapes: TLShape[] | (() => TLShape[])): CanvasNoteSummaryEditor {
  return {
    getSelectedShapes: typeof shapes === 'function' ? shapes : () => shapes
  }
}

describe('summarizeSelection', () => {
  it('returns empty string when nothing is selected', () => {
    expect(summarizeSelection(fakeEditor([]))).toBe('')
  })

  it('returns empty string when getSelectedShapes throws', () => {
    const editor = fakeEditor(() => {
      throw new Error('editor disposed')
    })
    expect(summarizeSelection(editor)).toBe('')
  })

  it('groups shapes by type with counts and up to 3 text excerpts, matching the spec example', () => {
    const shapes = [
      fakeShape('geo', { richText: richTextDoc('Login') }),
      fakeShape('geo', { richText: richTextDoc('DB') }),
      fakeShape('arrow', {})
    ]
    expect(summarizeSelection(fakeEditor(shapes))).toBe('3 shapes: 2 geo ("Login", "DB"), 1 arrow')
  })

  it('reads a plain string props.text without touching richText', () => {
    const shapes = [fakeShape('custom', { text: 'Plain label' })]
    expect(summarizeSelection(fakeEditor(shapes))).toBe('1 shapes: 1 custom ("Plain label")')
  })

  it('falls back to a generic "shape" group label when type is missing', () => {
    const shapes = [fakeShape('', {})]
    expect(summarizeSelection(fakeEditor(shapes))).toBe('1 shapes: 1 shape')
  })

  it('truncates a single excerpt at ~30 characters', () => {
    const longText = 'a'.repeat(40)
    const shapes = [fakeShape('geo', { richText: richTextDoc(longText) })]
    const summary = summarizeSelection(fakeEditor(shapes))
    expect(summary).toBe(`1 shapes: 1 geo ("${'a'.repeat(29)}…")`)
  })

  it('caps excerpts at 3 total even when more shapes have text', () => {
    const shapes = ['A', 'B', 'C', 'D', 'E'].map((letter) =>
      fakeShape('geo', { richText: richTextDoc(letter) })
    )
    expect(summarizeSelection(fakeEditor(shapes))).toBe('5 shapes: 5 geo ("A", "B", "C")')
  })

  it('treats richText missing a content array as empty, without crashing', () => {
    const shapes = [
      // Malformed/agent-generated .tldr content: no `content` field at all.
      fakeShape('geo', { richText: { type: 'doc' } }),
      fakeShape('geo', { richText: richTextDoc('DB') })
    ]
    expect(summarizeSelection(fakeEditor(shapes))).toBe('2 shapes: 2 geo ("DB")')
  })

  it('skips a shape whose props throw on access, without crashing the whole summary', () => {
    const throwingShape = new Proxy(fakeShape('geo', {}), {
      get(target, prop, receiver) {
        if (prop === 'props') {
          throw new Error('boom')
        }
        return Reflect.get(target, prop, receiver)
      }
    })
    const shapes = [throwingShape, fakeShape('geo', { richText: richTextDoc('DB') })]
    expect(summarizeSelection(fakeEditor(shapes))).toBe('2 shapes: 2 geo ("DB")')
  })

  it('caps the total summary length around 200 characters', () => {
    const shapes = Array.from({ length: 12 }, (_, i) =>
      fakeShape(`shape-type-${i}`, { richText: richTextDoc(`excerpt number ${i} is long`) })
    )
    const summary = summarizeSelection(fakeEditor(shapes))
    expect(summary.length).toBeLessThanOrEqual(200)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('does not count an empty richText shape as having an excerpt', () => {
    const shapes = [fakeShape('geo', { richText: richTextDoc('') })]
    expect(summarizeSelection(fakeEditor(shapes))).toBe('1 shapes: 1 geo')
  })
})
