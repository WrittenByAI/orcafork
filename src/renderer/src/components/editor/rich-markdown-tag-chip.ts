import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findRichMarkdownTagChips } from './rich-markdown-tag-chip-matches'

export const RICH_MARKDOWN_TAG_CHIP_CLASS = 'rich-markdown-tag-chip'

export const richMarkdownTagChipPluginKey = new PluginKey<DecorationSet>('richMarkdownTagChip')

type TextRange = {
  from: number
  to: number
}

function collectTagChipDecorations(doc: ProseMirrorNode, from: number, to: number): Decoration[] {
  const decorations: Decoration[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    // Why: code fences and inline code carry literal text, where a leading #
    // is source, not a tag.
    if (node.type.spec.code) {
      return false
    }
    if (!node.isText || !node.text) {
      return true
    }
    if (node.marks.some((mark) => mark.type.name === 'code' || mark.type.name === 'link')) {
      return true
    }
    for (const match of findRichMarkdownTagChips(node.text)) {
      decorations.push(
        Decoration.inline(pos + match.from, pos + match.to, {
          class: RICH_MARKDOWN_TAG_CHIP_CLASS,
          nodeName: 'span'
        })
      )
    }
    return true
  })
  return decorations
}

// Why: a full-document rescan on every keystroke costs a 300KB regex pass, so
// only the text blocks the transaction actually touched are re-matched. The
// one-position padding catches joins, where the changed range is empty and the
// tag forms across the seam ("#ta" + "g").
function changedTextblockRanges(tr: Transaction): TextRange[] {
  const blocks: TextRange[] = []
  const seen = new Set<number>()
  tr.steps.forEach((step, index) => {
    const remainder = tr.mapping.slice(index + 1)
    step.getMap().forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      const from = Math.max(0, remainder.map(newFrom, -1) - 1)
      const to = Math.min(tr.doc.content.size, remainder.map(newTo, 1) + 1)
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) {
          return true
        }
        if (!seen.has(pos)) {
          seen.add(pos)
          blocks.push({ from: pos, to: pos + node.nodeSize })
        }
        return false
      })
    })
  })
  return blocks
}

function createRichMarkdownTagChipPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: richMarkdownTagChipPluginKey,
    state: {
      init: (_config, state) =>
        DecorationSet.create(
          state.doc,
          collectTagChipDecorations(state.doc, 0, state.doc.content.size)
        ),
      apply: (tr, decorations) => {
        if (!tr.docChanged) {
          return decorations
        }
        let next = decorations.map(tr.mapping, tr.doc)
        for (const block of changedTextblockRanges(tr)) {
          next = next.remove(next.find(block.from, block.to))
          next = next.add(tr.doc, collectTagChipDecorations(tr.doc, block.from, block.to))
        }
        return next
      }
    },
    props: {
      decorations(state) {
        return richMarkdownTagChipPluginKey.getState(state) ?? DecorationSet.empty
      }
    }
  })
}

export function createRichMarkdownTagChipExtension(): Extension {
  return Extension.create({
    name: 'richMarkdownTagChip',
    addProseMirrorPlugins() {
      return [createRichMarkdownTagChipPlugin()]
    }
  })
}
