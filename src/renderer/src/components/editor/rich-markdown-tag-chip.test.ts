// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Editor as TiptapEditor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Code } from '@tiptap/extension-code'
import Link from '@tiptap/extension-link'
import { createIsolatedMarkdownExtensionForTests } from './isolated-markdown-extension-for-tests'
import {
  createRichMarkdownTagChipExtension,
  richMarkdownTagChipPluginKey,
  RICH_MARKDOWN_TAG_CHIP_CLASS
} from './rich-markdown-tag-chip'

function makeEditor(markdown: string): TiptapEditor {
  return new TiptapEditor({
    // Why: TipTap only wires ProseMirror plugins once a view exists, so plugin
    // state stays empty with the element: null harness other editor tests use.
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ link: false, code: false }),
      Code,
      Link.configure({ openOnClick: false, autolink: true }),
      createIsolatedMarkdownExtensionForTests(),
      createRichMarkdownTagChipExtension()
    ],
    content: markdown,
    contentType: 'markdown'
  })
}

function chipTexts(editor: TiptapEditor): string[] {
  const decorations = richMarkdownTagChipPluginKey.getState(editor.state)
  return (decorations?.find() ?? []).map((decoration) =>
    editor.state.doc.textBetween(decoration.from, decoration.to)
  )
}

describe('rich markdown tag chips', () => {
  it('decorates tags in prose and headings', () => {
    const editor = makeEditor('# Notes #project\n\nping #alpha/beta today')

    expect(chipTexts(editor)).toEqual(['#project', '#alpha/beta'])
    expect(
      [...editor.view.dom.querySelectorAll(`.${RICH_MARKDOWN_TAG_CHIP_CLASS}`)].map(
        (chip) => chip.textContent
      )
    ).toEqual(['#project', '#alpha/beta'])
  })

  it('leaves code fences, inline code, and links alone', () => {
    const editor = makeEditor('```sh\n#alpha\n```\n\n`#beta` and [#gamma](https://x.test)')

    expect(chipTexts(editor)).toEqual([])
  })

  it('never rewrites the markdown it decorates', () => {
    const editor = makeEditor('ping #alpha today')

    expect(editor.getMarkdown().trim()).toBe('ping #alpha today')
  })

  it('picks up a tag typed after load', () => {
    const editor = makeEditor('plain line')
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' #alpha')

    expect(chipTexts(editor)).toEqual(['#alpha'])
  })

  it('drops the chip when the tag is broken up', () => {
    const editor = makeEditor('ping #alpha today')
    const tagStart = editor.state.doc.textBetween(0, editor.state.doc.content.size).indexOf('#') + 1

    editor.commands.deleteRange({ from: tagStart, to: tagStart + 1 })

    expect(chipTexts(editor)).toEqual([])
  })

  it('re-matches a tag formed by joining two blocks', () => {
    const editor = makeEditor('ping #al\n\npha today')
    const joinPos = editor.state.doc.child(0).nodeSize

    editor.commands.deleteRange({ from: joinPos - 1, to: joinPos + 1 })

    expect(chipTexts(editor)).toEqual(['#alpha'])
  })
})
