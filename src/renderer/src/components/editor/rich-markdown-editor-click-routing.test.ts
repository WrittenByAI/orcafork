// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { createIsolatedMarkdownExtensionForTests } from './isolated-markdown-extension-for-tests'
import { handleRichMarkdownEditorClick } from './rich-markdown-editor-click-routing'
import type { DiffComment } from '../../../../shared/diff-comment-types'
import type { HttpLinkSourceOwner } from '@/lib/http-link-routing'

const openHttpLinkMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/http-link-routing', () => ({
  openHttpLink: openHttpLinkMock
}))

beforeEach(() => {
  openHttpLinkMock.mockReset()
})

// Why: the preview deliberately routes differently; this pins the editor side so a
// future "make them consistent" change cannot land silently.
function clickExternalLinkWithShift(sourceOwner: HttpLinkSourceOwner, isMac = true): boolean {
  const href = 'https://example.com/docs'
  const view = {
    state: {
      doc: {
        nodeAt: () => null,
        resolve: () => ({
          marks: () => [{ type: { name: 'link' }, attrs: { href } }]
        })
      }
    }
  } as unknown as EditorView

  return handleRichMarkdownEditorClick({
    activateMarkdownLink: vi.fn(),
    editorRef: { current: {} } as unknown as MutableRefObject<unknown>,
    event: { metaKey: isMac, ctrlKey: !isMac, shiftKey: true } as MouseEvent,
    filePath: '/repo/docs/README.md',
    isMac,
    htmlSuperscriptLinkContext: {
      getSnapshot: () => ({ sourceOwner })
    },
    markdownCommentsRef: { current: [] },
    markdownSourceLineOffsetRef: { current: 0 },
    onOpenDocLinkRef: { current: undefined },
    pos: 1,
    rootRef: { current: null },
    scrollRichMarkdownReviewNoteCardIntoView: vi.fn(),
    settings: {} as never,
    view,
    worktreeId: 'wt-1',
    worktreeRoot: '/repo'
  } as never)
}

describe('rich markdown editor Shift+modifier click on external links', () => {
  // Why: intentionally NOT the preview's behavior — this path hands the link to the
  // client OS, so it must keep forcing the system browser even when inverting is on.
  it('forces the system browser rather than following the invert setting', () => {
    expect(clickExternalLinkWithShift({ kind: 'local' })).toBe(true)
    expect(openHttpLinkMock).toHaveBeenCalledWith('https://example.com/docs', {
      forceSystemBrowser: true,
      sourceOwner: { kind: 'local' }
    })
  })

  // Why: AGENTS.md — Shift+Ctrl is the chord off macOS, and modKey reads a
  // different event field there.
  it('uses the Ctrl chord off macOS', () => {
    expect(clickExternalLinkWithShift({ kind: 'local' }, false)).toBe(true)
    expect(openHttpLinkMock).toHaveBeenCalledWith('https://example.com/docs', {
      forceSystemBrowser: true,
      sourceOwner: { kind: 'local' }
    })
  })

  it('forwards a non-local source owner untouched', () => {
    const sourceOwner = { kind: 'ssh', connectionId: 'conn-1' } as HttpLinkSourceOwner

    expect(clickExternalLinkWithShift(sourceOwner)).toBe(true)
    expect(openHttpLinkMock).toHaveBeenCalledWith(
      'https://example.com/docs',
      expect.objectContaining({ forceSystemBrowser: true, sourceOwner })
    )
  })
})

// Why: a mermaid fence renders as just its diagram, so a click on it lands on the
// fence position rather than inside the note range hidden in its source.
describe('collapsed mermaid fence note routing', () => {
  function findCodeBlockPos(editor: Editor): number {
    let found = -1
    editor.state.doc.forEach((node, offset) => {
      if (found === -1 && node.type.name === 'codeBlock') {
        found = offset
      }
    })
    return found
  }

  function clickFence(
    markdown: string,
    comment: DiffComment
  ): { scrolled: ReturnType<typeof vi.fn>; pos: number } {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, createIsolatedMarkdownExtensionForTests()],
      content: markdown,
      contentType: 'markdown'
    })
    const pos = findCodeBlockPos(editor)
    const scrolled = vi.fn()
    handleRichMarkdownEditorClick({
      activateMarkdownLink: vi.fn(),
      editorRef: { current: editor } as unknown as MutableRefObject<unknown>,
      event: { metaKey: false, ctrlKey: false, shiftKey: false } as MouseEvent,
      filePath: '/repo/docs/README.md',
      isMac: true,
      htmlSuperscriptLinkContext: { getSnapshot: () => ({ sourceOwner: undefined }) },
      markdownCommentsRef: { current: [comment] },
      markdownSourceLineOffsetRef: { current: 0 },
      onOpenDocLinkRef: { current: undefined },
      pos,
      rootRef: { current: null },
      scrollRichMarkdownReviewNoteCardIntoView: scrolled,
      settings: {} as never,
      view: { state: { doc: { nodeAt: () => null } } } as unknown as EditorView,
      worktreeId: 'wt-1',
      worktreeRoot: '/repo'
    } as never)
    return { scrolled, pos }
  }

  const fenceComment = {
    id: 'note-1',
    lineNumber: 4,
    selectedText: 'flowchart TD\n  A --> B'
  } as DiffComment

  it('focuses the review note when the diagram itself is clicked', () => {
    const { scrolled } = clickFence(
      '# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nTail.\n',
      fenceComment
    )

    expect(scrolled).toHaveBeenCalledWith('note-1')
  })

  it('leaves other code fences on the exact-position lookup', () => {
    const { scrolled } = clickFence(
      '# Title\n\n```ts\nflowchart TD\n  A --> B\n```\n\nTail.\n',
      fenceComment
    )

    expect(scrolled).not.toHaveBeenCalled()
  })
})
