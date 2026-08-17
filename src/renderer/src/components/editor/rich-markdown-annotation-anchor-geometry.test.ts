// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import {
  getRichMarkdownAnnotationAnchor,
  getRichMarkdownAnnotationButtonLeft,
  getRichMarkdownAnnotationButtonTop,
  getRichMarkdownAnnotationSelectionRect
} from './rich-markdown-annotation-anchor-geometry'

function makeRect(box: { top: number; left: number; width: number; height: number }): DOMRect {
  return {
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => box
  } as DOMRect
}

function makeRoot(): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  return root
}

function makeEditor(selectionFrom: number, nodeDom: Node | null): Editor {
  return {
    state: { selection: { from: selectionFrom } },
    view: {
      nodeDOM: (pos: number) => (pos === selectionFrom ? nodeDom : null),
      domAtPos: () => ({ node: nodeDom ?? document.body, offset: 0 })
    }
  } as unknown as Editor
}

function stubZeroRect(element: HTMLElement): void {
  element.getBoundingClientRect = () => makeRect({ top: 0, left: 0, width: 0, height: 0 })
}

function stubSelection(range: Partial<Range> | null): void {
  vi.spyOn(window, 'getSelection').mockReturnValue(
    range === null
      ? null
      : ({
          isCollapsed: false,
          rangeCount: 1,
          getRangeAt: () => range as Range
        } as unknown as Selection)
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('getRichMarkdownAnnotationButtonTop', () => {
  it('keeps the add-note button below short visible selections', () => {
    expect(getRichMarkdownAnnotationButtonTop(120, 500)).toBe(128)
  })

  it('clamps the add-note button inside the visible editor shell for long selections', () => {
    expect(getRichMarkdownAnnotationButtonTop(760, 500)).toBe(468)
  })
})

describe('getRichMarkdownAnnotationButtonLeft', () => {
  it('keeps the add-note button near the right edge when there is room', () => {
    expect(getRichMarkdownAnnotationButtonLeft(700)).toBe(658)
  })

  it('clamps the add-note button inside narrow editor shells', () => {
    expect(getRichMarkdownAnnotationButtonLeft(72)).toBe(40)
  })
})

describe('getRichMarkdownAnnotationSelectionRect', () => {
  it('measures the DOM selection when it has rendered rects', () => {
    const root = makeRoot()
    const paragraph = document.createElement('p')
    root.append(paragraph)
    const selectionRect = makeRect({ top: 40, left: 10, width: 200, height: 18 })
    stubSelection({
      commonAncestorContainer: paragraph,
      getBoundingClientRect: () => selectionRect,
      getClientRects: () => [] as unknown as DOMRectList
    })

    expect(getRichMarkdownAnnotationSelectionRect(makeEditor(1, null), root)).toBe(selectionRect)
  })

  // Why: a collapsed mermaid fence keeps its source in a display:none content
  // hole, so the node selection's DOM range measures as zero-sized.
  it('falls back to the selected node box when the DOM selection has no rects', () => {
    const root = makeRoot()
    const diagram = document.createElement('div')
    root.append(diagram)
    const nodeRect = makeRect({ top: 80, left: 24, width: 320, height: 140 })
    diagram.getBoundingClientRect = () => nodeRect
    stubSelection(null)

    expect(getRichMarkdownAnnotationSelectionRect(makeEditor(12, diagram), root)).toBe(nodeRect)
  })

  // Why: the collapsed fence's <pre> is display:none, so its own box is empty
  // while the wrapper that renders the diagram is not.
  it('climbs to the nearest rendered ancestor of an unrendered selected node', () => {
    const root = makeRoot()
    const wrapper = document.createElement('div')
    const hiddenSource = document.createElement('pre')
    wrapper.append(hiddenSource)
    root.append(wrapper)
    const wrapperRect = makeRect({ top: 64, left: 16, width: 400, height: 180 })
    stubZeroRect(hiddenSource)
    wrapper.getBoundingClientRect = () => wrapperRect
    stubSelection(null)

    expect(getRichMarkdownAnnotationSelectionRect(makeEditor(9, hiddenSource), root)).toBe(
      wrapperRect
    )
  })

  it('ignores a selected node rendered outside the editor root', () => {
    const root = makeRoot()
    const detached = document.createElement('div')
    document.body.append(detached)
    detached.getBoundingClientRect = () => makeRect({ top: 0, left: 0, width: 100, height: 20 })

    stubSelection(null)

    expect(getRichMarkdownAnnotationSelectionRect(makeEditor(12, detached), root)).toBeNull()
  })

  it('reports no anchor when neither the selection nor the node has a box', () => {
    const root = makeRoot()
    stubSelection(null)

    expect(getRichMarkdownAnnotationSelectionRect(makeEditor(12, null), root)).toBeNull()
  })
})

describe('getRichMarkdownAnnotationAnchor', () => {
  it('places the popover under the add-note button and inside the shell', () => {
    const anchor = getRichMarkdownAnnotationAnchor(
      makeRect({ top: 100, left: 20, width: 300, height: 40 }),
      makeRect({ top: 60, left: 0, width: 700, height: 500 })
    )

    expect(anchor).toEqual({ top: 118, left: 256, buttonTop: 88, buttonLeft: 658 })
  })
})
