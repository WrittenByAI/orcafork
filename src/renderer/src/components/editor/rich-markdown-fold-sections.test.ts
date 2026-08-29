import { describe, expect, it } from 'vitest'
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { createIsolatedMarkdownExtensionForTests } from './isolated-markdown-extension-for-tests'
import {
  collectRichMarkdownFoldSections,
  findRichMarkdownFoldAnchorAt,
  findRichMarkdownFoldsToReveal,
  isRichMarkdownFoldSectionCovering
} from './rich-markdown-fold-sections'

function docOf(markdown: string): ProseMirrorNode {
  return new TiptapEditor({
    element: null,
    extensions: [StarterKit, createIsolatedMarkdownExtensionForTests()],
    content: markdown,
    contentType: 'markdown'
  }).state.doc
}

function outline(markdown: string): { kind: string; anchor: string; body: string[] }[] {
  const doc = docOf(markdown)
  return collectRichMarkdownFoldSections(doc).map((section) => ({
    kind: section.kind,
    anchor: doc.nodeAt(section.anchorFrom)?.firstChild?.textContent ?? '',
    body: section.bodyNodes.map((node) => doc.nodeAt(node.from)?.textContent ?? '')
  }))
}

describe('collectRichMarkdownFoldSections', () => {
  it('gives a heading every sibling up to the next same-or-higher heading', () => {
    expect(outline('# One\n\nalpha\n\n## Two\n\nbeta\n\n# Three\n\ngamma')).toEqual([
      { kind: 'heading', anchor: 'One', body: ['alpha', 'Two', 'beta'] },
      { kind: 'heading', anchor: 'Two', body: ['beta'] },
      { kind: 'heading', anchor: 'Three', body: ['gamma'] }
    ])
  })

  it('leaves a heading with nothing under it unfoldable', () => {
    expect(outline('# Only')).toEqual([{ kind: 'heading', anchor: 'Only', body: [] }])
  })

  it('gives a list item its nested children and leaves flat items alone', () => {
    expect(outline('- parent\n  - child\n  - other child\n- sibling')).toEqual([
      { kind: 'list-item', anchor: 'parent', body: ['childother child'] },
      { kind: 'list-item', anchor: 'child', body: [] },
      { kind: 'list-item', anchor: 'other child', body: [] },
      { kind: 'list-item', anchor: 'sibling', body: [] }
    ])
  })

  it('scopes a nested heading to its own container', () => {
    expect(outline('# One\n\n> ## Quoted\n>\n> beta\n\ngamma')).toEqual([
      { kind: 'heading', anchor: 'One', body: ['Quotedbeta', 'gamma'] },
      { kind: 'heading', anchor: 'Quoted', body: ['beta'] }
    ])
  })
})

describe('findRichMarkdownFoldAnchorAt', () => {
  it('resolves a toggle position back to its own heading or list item', () => {
    const doc = docOf('# One\n\n- parent\n  - child')
    const sections = collectRichMarkdownFoldSections(doc)

    for (const section of sections) {
      expect(findRichMarkdownFoldAnchorAt(doc, section.toggleFrom)).toBe(section.anchorFrom)
      expect(findRichMarkdownFoldAnchorAt(doc, section.textEnd)).toBe(section.anchorFrom)
    }
  })
})

describe('findRichMarkdownFoldsToReveal', () => {
  it('reveals only the fold whose hidden body holds the selection', () => {
    const doc = docOf('# One\n\nalpha\n\n# Two\n\nbeta')
    const sections = collectRichMarkdownFoldSections(doc)
    const collapsed = sections.map((section) => section.anchorFrom)
    const betaFrom = sections[1].bodyNodes[0].from

    expect(doc.nodeAt(betaFrom)?.textContent).toBe('beta')
    expect(findRichMarkdownFoldsToReveal(sections, collapsed, betaFrom + 1, betaFrom + 1)).toEqual([
      sections[1].anchorFrom
    ])
  })

  it('keeps a fold closed while the caret sits on its own text', () => {
    const doc = docOf('# One\n\nalpha')
    const [section] = collectRichMarkdownFoldSections(doc)

    expect(isRichMarkdownFoldSectionCovering(section, section.textEnd, section.textEnd)).toBe(false)
  })
})
