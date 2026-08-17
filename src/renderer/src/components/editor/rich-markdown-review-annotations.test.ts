// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import type { DiffComment } from '../../../../shared/diff-comment-types'
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { createIsolatedMarkdownExtensionForTests } from './isolated-markdown-extension-for-tests'
import {
  countRichMarkdownReviewMarkdownLines,
  getRichMarkdownAnnotationHighlightRanges,
  getRichMarkdownCommentAnchorTop,
  getRichMarkdownCommentAtPos,
  getRichMarkdownSelectionLineRange,
  type RichMarkdownComposerState
} from './rich-markdown-review-annotations'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('countRichMarkdownReviewMarkdownLines', () => {
  it('counts LF, CRLF, and CR line endings exactly', () => {
    expect(countRichMarkdownReviewMarkdownLines('')).toBe(1)
    expect(countRichMarkdownReviewMarkdownLines('one')).toBe(1)
    expect(countRichMarkdownReviewMarkdownLines('one\ntwo')).toBe(2)
    expect(countRichMarkdownReviewMarkdownLines('one\r\ntwo\r\nthree')).toBe(3)
    expect(countRichMarkdownReviewMarkdownLines('one\rtwo')).toBe(2)
  })

  it('counts large pasted markdown blocks without splitting into line arrays', () => {
    const split = vi.spyOn(String.prototype, 'split')
    const text = 'line\r\n'.repeat(100_000)

    expect(countRichMarkdownReviewMarkdownLines(text)).toBe(100_001)

    expect(split).not.toHaveBeenCalled()
  })
})

// Why count serializes: resolving a comment's block re-serializes the document,
// so doing it per comment made these O(comments x document). A call count is
// deterministic where a wall-clock threshold would be flaky.
describe('rich markdown annotation block reuse', () => {
  function makeEditor(nodeCount: number): { editor: Editor; serializeCalls: () => number } {
    let serializeCalls = 0
    const content = Array.from({ length: nodeCount }, (_value, index) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `paragraph ${index}` }]
    }))
    const doc = {
      forEach(callback: (node: unknown, offset: number, index: number) => void): void {
        content.forEach((node, index) => callback(node, index * 10, index))
      },
      // The text-range search walks the doc to locate the selected text; these
      // fixtures never match, so it only needs to be traversable.
      nodesBetween(): void {},
      content: { size: nodeCount * 10 }
    }
    const editor = {
      getJSON: () => ({ content }),
      state: { doc },
      markdown: {
        serialize: (value: { content?: unknown[] }) => {
          serializeCalls += 1
          return (value.content ?? []).map((_node, index) => `line ${index}`).join('\n')
        }
      }
    } as unknown as Editor
    return { editor, serializeCalls: () => serializeCalls }
  }

  function makeComments(count: number): DiffComment[] {
    return Array.from(
      { length: count },
      (_value, index) => ({ lineNumber: index + 1, selectedText: 'nothing-matches' }) as DiffComment
    )
  }

  // One block build over NODE_COUNT nodes: each node serialized alone, plus each
  // adjacent pair. Pinned absolutely so "both arms build twice" can't pass as equal.
  const NODE_COUNT = 12
  const ONE_BUILD_SERIALIZE_CALLS = NODE_COUNT + (NODE_COUNT - 1)

  it('serializes the document once regardless of comment count', () => {
    const single = makeEditor(NODE_COUNT)
    getRichMarkdownAnnotationHighlightRanges(single.editor, makeComments(1), 0)

    const many = makeEditor(NODE_COUNT)
    getRichMarkdownAnnotationHighlightRanges(many.editor, makeComments(8), 0)

    expect(single.serializeCalls()).toBe(ONE_BUILD_SERIALIZE_CALLS)
    expect(many.serializeCalls()).toBe(ONE_BUILD_SERIALIZE_CALLS)
  })

  it('serializes the document once when locating the comment at a position', () => {
    const single = makeEditor(NODE_COUNT)
    getRichMarkdownCommentAtPos(single.editor, makeComments(1), 0, 5)

    const many = makeEditor(NODE_COUNT)
    getRichMarkdownCommentAtPos(many.editor, makeComments(8), 0, 5)

    expect(single.serializeCalls()).toBe(ONE_BUILD_SERIALIZE_CALLS)
    expect(many.serializeCalls()).toBe(ONE_BUILD_SERIALIZE_CALLS)
  })

  it('does no work at all with no comments', () => {
    const none = makeEditor(12)
    expect(getRichMarkdownAnnotationHighlightRanges(none.editor, [], 0)).toEqual([])
    expect(getRichMarkdownCommentAtPos(none.editor, [], 0, 5)).toBeNull()
    expect(none.serializeCalls()).toBe(0)
  })
})

// Why: a note taken on a collapsed mermaid fence anchors into a display:none
// content hole, where coordsAtPos reports a box at the viewport origin.
describe('getRichMarkdownCommentAnchorTop', () => {
  function makeRect(top: number, height: number): DOMRect {
    return {
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({})
    } as DOMRect
  }

  function makeAnchorEditor(coordsTop: number): { editor: Editor; wrapper: HTMLElement } {
    const viewDom = document.createElement('div')
    const wrapper = document.createElement('div')
    const hiddenSource = document.createElement('pre')
    wrapper.append(hiddenSource)
    viewDom.append(wrapper)
    document.body.append(viewDom)
    hiddenSource.getBoundingClientRect = () => makeRect(0, 0)
    wrapper.getBoundingClientRect = () => makeRect(300, 180)

    const doc = {
      forEach: () => {},
      nodesBetween: () => {},
      content: { size: 40 }
    }
    const editor = {
      getJSON: () => ({ content: [] }),
      state: { doc },
      markdown: { serialize: () => 'line' },
      view: {
        dom: viewDom,
        coordsAtPos: () => ({ top: coordsTop, bottom: coordsTop, left: 0, right: 0 }),
        nodeDOM: () => hiddenSource,
        domAtPos: () => ({ node: hiddenSource, offset: 0 })
      }
    } as unknown as Editor
    return { editor, wrapper }
  }

  const block = { key: '0:1-3', startLine: 1, endLine: 3, from: 5, to: 20 }
  const comment = { lineNumber: 1, selectedText: 'flowchart TD' } as DiffComment

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('anchors to the rendered fence when the caret position is not laid out', () => {
    const { editor } = makeAnchorEditor(0)

    expect(getRichMarkdownCommentAnchorTop(editor, comment, block, makeRect(100, 500), 20, 0)).toBe(
      220
    )
  })

  it('keeps the exact caret position when it is inside the rendered box', () => {
    const { editor } = makeAnchorEditor(340)

    expect(getRichMarkdownCommentAnchorTop(editor, comment, block, makeRect(100, 500), 20, 0)).toBe(
      260
    )
  })
})

// Why: a collapsed mermaid diagram is selected as a node, while its expanded
// source is selected as text. Both must file the note against the same lines, or
// the add-note button reappears on a diagram that already carries a note.
describe('getRichMarkdownSelectionLineRange', () => {
  const markdown = '# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nTail.\n'

  function fenceRange(select: (doc: ProseMirrorNode) => Selection): RichMarkdownComposerState {
    const editor = new TiptapEditor({
      element: null,
      extensions: [StarterKit, createIsolatedMarkdownExtensionForTests()],
      content: markdown,
      contentType: 'markdown'
    })
    editor.view.dispatch(editor.state.tr.setSelection(select(editor.state.doc)))
    return getRichMarkdownSelectionLineRange(editor as unknown as Editor)
  }

  it('files a node-selected fence against the fence lines only', () => {
    const nodeRange = fenceRange((doc) => NodeSelection.create(doc, 7))
    const textRange = fenceRange((doc) => TextSelection.create(doc, 8, 30))

    expect(nodeRange).toEqual({ startLine: 3, lineNumber: 6 })
    expect(nodeRange).toEqual(textRange)
  })
})
