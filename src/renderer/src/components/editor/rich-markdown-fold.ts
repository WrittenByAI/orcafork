import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { translate } from '@/i18n/i18n'
import {
  collectRichMarkdownFoldSections,
  findRichMarkdownFoldAnchorAt,
  findRichMarkdownFoldSection,
  findRichMarkdownFoldsToReveal,
  isRichMarkdownFoldSectionCovering,
  type RichMarkdownFoldAnchorKind,
  type RichMarkdownFoldSection
} from './rich-markdown-fold-sections'

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'

export const richMarkdownFoldPluginKey = new PluginKey<RichMarkdownFoldState>('richMarkdownFold')

type RichMarkdownFoldState = {
  collapsed: number[]
  decorations: DecorationSet
}

type RichMarkdownFoldMeta = { toggle: number }

function foldLabel(collapsed: boolean): string {
  return collapsed
    ? translate('auto.components.editor.rich.markdown.fold.3a57237001', 'Expand section')
    : translate('auto.components.editor.rich.markdown.fold.95af69a9f0', 'Collapse section')
}

function createFoldButton(
  view: EditorView,
  getPos: () => number | undefined,
  kind: RichMarkdownFoldAnchorKind,
  className: string,
  collapsed: boolean
): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.contentEditable = 'false'
  button.tabIndex = -1
  button.dataset.collapsed = collapsed ? 'true' : 'false'
  button.dataset.foldAnchor = kind
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
  button.setAttribute('aria-label', foldLabel(collapsed))
  if (className === 'rich-markdown-fold-toggle') {
    button.innerHTML = CHEVRON_SVG
  } else {
    // Why: three separate dots, not '…' — the ellipsis glyph cannot be spaced.
    button.textContent = '...'
  }
  // Why: mousedown, not click — ProseMirror sets the selection on mousedown, and
  // preventDefault here keeps the caret where it was instead of jumping into the block.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    // Why: resolve the owner from the live document rather than a captured
    // position — ProseMirror reuses this DOM across edits that move the block.
    const widgetPos = getPos()
    const anchorFrom =
      widgetPos === undefined ? null : findRichMarkdownFoldAnchorAt(view.state.doc, widgetPos)
    if (anchorFrom !== null) {
      toggleRichMarkdownFold(view, anchorFrom)
    }
  })
  // Why: the toggle already ran on mousedown; keep the click out of the editor's
  // click routing so it cannot re-target links or review notes.
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  return button
}

function createFoldDecorations(doc: ProseMirrorNode, collapsed: number[]): DecorationSet {
  return buildFoldDecorations(doc, collectRichMarkdownFoldSections(doc), collapsed)
}

function buildFoldDecorations(
  doc: ProseMirrorNode,
  sections: RichMarkdownFoldSection[],
  collapsed: number[]
): DecorationSet {
  const decorations: Decoration[] = []
  for (const section of sections) {
    if (section.bodyNodes.length === 0) {
      continue
    }
    const isCollapsed = collapsed.includes(section.anchorFrom)
    decorations.push(
      Decoration.widget(
        section.toggleFrom,
        (view, getPos) =>
          createFoldButton(view, getPos, section.kind, 'rich-markdown-fold-toggle', isCollapsed),
        { side: -1, key: `fold-toggle-${isCollapsed}`, ignoreSelection: true }
      )
    )
    if (!isCollapsed) {
      continue
    }
    // Why: a real button, not a ::after glyph — the dots are the affordance most
    // readers click to open a collapsed block.
    decorations.push(
      Decoration.widget(
        section.textEnd,
        (view, getPos) =>
          createFoldButton(view, getPos, section.kind, 'rich-markdown-fold-ellipsis', true),
        { side: 1, key: 'fold-ellipsis', ignoreSelection: true }
      )
    )
    decorations.push(
      Decoration.node(section.anchorFrom, section.anchorTo, {
        class: 'rich-markdown-fold-collapsed'
      })
    )
    for (const body of section.bodyNodes) {
      decorations.push(Decoration.node(body.from, body.to, { class: 'rich-markdown-folded' }))
    }
  }
  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, decorations)
}

function foldSectionAt(state: EditorState, anchorFrom: number): RichMarkdownFoldSection | null {
  return findRichMarkdownFoldSection(collectRichMarkdownFoldSections(state.doc), anchorFrom)
}

/**
 * Collapses or reveals the content a heading or list item owns. Nothing in the
 * document changes — only which blocks the view draws.
 */
export function toggleRichMarkdownFold(view: EditorView, anchorFrom: number): void {
  const { state } = view
  const section = foldSectionAt(state, anchorFrom)
  if (!section) {
    return
  }
  const tr = state.tr.setMeta(richMarkdownFoldPluginKey, {
    toggle: anchorFrom
  } satisfies RichMarkdownFoldMeta)
  const wasCollapsed =
    richMarkdownFoldPluginKey.getState(state)?.collapsed.includes(anchorFrom) ?? false
  // Why: a caret inside the section would be hidden by its own fold, so park it
  // at the end of the visible text before the body disappears.
  if (
    !wasCollapsed &&
    isRichMarkdownFoldSectionCovering(section, state.selection.from, state.selection.to)
  ) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(section.textEnd), -1))
  }
  // Why no view.focus(): the caret may be off-screen (mousedown was prevented, so
  // it never moved), and focusing would scroll the document to it.
  view.dispatch(tr)
}

function createRichMarkdownFoldPlugin(): Plugin<RichMarkdownFoldState> {
  return new Plugin<RichMarkdownFoldState>({
    key: richMarkdownFoldPluginKey,
    state: {
      init: (_config, state) => ({
        collapsed: [],
        decorations: createFoldDecorations(state.doc, [])
      }),
      apply: (tr, pluginState) => {
        const meta = tr.getMeta(richMarkdownFoldPluginKey) as RichMarkdownFoldMeta | undefined
        let collapsed = tr.docChanged
          ? pluginState.collapsed
              .map((pos) => tr.mapping.mapResult(pos, 1))
              .filter((result) => !result.deleted)
              .map((result) => result.pos)
          : pluginState.collapsed
        if (meta) {
          const toggled = tr.mapping.map(meta.toggle, 1)
          collapsed = collapsed.includes(toggled)
            ? collapsed.filter((pos) => pos !== toggled)
            : [...collapsed, toggled]
        }
        if (!tr.docChanged && collapsed === pluginState.collapsed) {
          return pluginState
        }
        const sections = collectRichMarkdownFoldSections(tr.doc)
        // Why: an edit can dissolve the block a fold was anchored to, and the
        // caret must never land inside content the fold is hiding.
        const revealed = findRichMarkdownFoldsToReveal(
          sections,
          collapsed,
          tr.selection.from,
          tr.selection.to
        )
        collapsed = collapsed.filter(
          (pos) =>
            !revealed.includes(pos) && findRichMarkdownFoldSection(sections, pos)?.bodyNodes.length
        )
        return { collapsed, decorations: buildFoldDecorations(tr.doc, sections, collapsed) }
      }
    },
    props: {
      decorations(state) {
        return richMarkdownFoldPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      }
    }
  })
}

export function createRichMarkdownFoldExtension(): Extension {
  return Extension.create({
    name: 'richMarkdownFold',
    addProseMirrorPlugins() {
      return [createRichMarkdownFoldPlugin()]
    }
  })
}
