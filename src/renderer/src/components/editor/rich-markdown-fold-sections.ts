import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export type RichMarkdownFoldAnchorKind = 'heading' | 'list-item' | 'task-item'

/** Anchor is the node that owns the fold: a heading, or a list item with children. */
export type RichMarkdownFoldSection = {
  kind: RichMarkdownFoldAnchorKind
  anchorFrom: number
  anchorTo: number
  /** Inline position of the toggle widget, inside the anchor's own text line. */
  toggleFrom: number
  /** End of the anchor's own text line, where the collapsed ellipsis sits. */
  textEnd: number
  /** Blocks the anchor owns, in document order. */
  bodyNodes: { from: number; to: number }[]
}

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem'])

function anchorKind(node: ProseMirrorNode): RichMarkdownFoldAnchorKind {
  if (isHeading(node)) {
    return 'heading'
  }
  return node.type.name === 'taskItem' ? 'task-item' : 'list-item'
}

function headingLevel(node: ProseMirrorNode): number {
  const level = node.attrs.level
  return typeof level === 'number' ? level : 1
}

function isHeading(node: ProseMirrorNode): boolean {
  return node.type.name === 'heading'
}

/**
 * Offset from a fold toggle back to its anchor node: headings hold the toggle in
 * their own text, list items hold it in the paragraph one level down.
 */
function richMarkdownFoldAnchorOffset(node: ProseMirrorNode): number {
  return isHeading(node) ? 1 : 2
}

function headingSection(
  children: { node: ProseMirrorNode; from: number }[],
  index: number
): RichMarkdownFoldSection {
  const heading = children[index]
  const level = headingLevel(heading.node)
  const bodyNodes: { from: number; to: number }[] = []
  for (let next = index + 1; next < children.length; next++) {
    const sibling = children[next]
    if (isHeading(sibling.node) && headingLevel(sibling.node) <= level) {
      break
    }
    bodyNodes.push({ from: sibling.from, to: sibling.from + sibling.node.nodeSize })
  }
  return {
    kind: 'heading',
    anchorFrom: heading.from,
    anchorTo: heading.from + heading.node.nodeSize,
    toggleFrom: heading.from + richMarkdownFoldAnchorOffset(heading.node),
    textEnd: heading.from + heading.node.nodeSize - 1,
    bodyNodes
  }
}

function listItemSection(item: ProseMirrorNode, from: number): RichMarkdownFoldSection | null {
  const first = item.firstChild
  // Why: the toggle rides the item's own text line, so an item that opens with a
  // nested list instead of a paragraph has nowhere to put it.
  if (!first?.isTextblock) {
    return null
  }
  const bodyNodes: { from: number; to: number }[] = []
  let offset = from + 1 + first.nodeSize
  for (let index = 1; index < item.childCount; index++) {
    const child = item.child(index)
    bodyNodes.push({ from: offset, to: offset + child.nodeSize })
    offset += child.nodeSize
  }
  return {
    kind: anchorKind(item),
    anchorFrom: from,
    anchorTo: from + item.nodeSize,
    toggleFrom: from + richMarkdownFoldAnchorOffset(item),
    textEnd: from + first.nodeSize,
    bodyNodes
  }
}

function collectFromContainer(
  container: ProseMirrorNode,
  contentStart: number,
  sections: RichMarkdownFoldSection[]
): void {
  const children: { node: ProseMirrorNode; from: number }[] = []
  container.forEach((child, offset) => {
    children.push({ node: child, from: contentStart + offset })
  })

  children.forEach((child, index) => {
    if (isHeading(child.node)) {
      sections.push(headingSection(children, index))
    } else if (LIST_ITEM_TYPES.has(child.node.type.name)) {
      const section = listItemSection(child.node, child.from)
      if (section) {
        sections.push(section)
      }
    }
    // Why: headings and items also live inside blockquotes, list items and
    // toggle bodies, and each container scopes its own sections.
    if (!child.node.isTextblock && !child.node.isLeaf) {
      collectFromContainer(child.node, child.from + 1, sections)
    }
  })
}

/**
 * Every foldable block with the content it owns — for a heading the following
 * blocks up to the next heading of the same or higher rank, for a list item its
 * nested children. Folding hides that content with decorations, so the markdown
 * source never changes.
 */
export function collectRichMarkdownFoldSections(doc: ProseMirrorNode): RichMarkdownFoldSection[] {
  const sections: RichMarkdownFoldSection[] = []
  collectFromContainer(doc, 0, sections)
  return sections
}

/**
 * The heading or list item a position sits in — read from the live document so a
 * reused toggle button never acts on a stale position.
 */
export function findRichMarkdownFoldAnchorAt(doc: ProseMirrorNode, pos: number): number | null {
  const resolved = doc.resolve(pos)
  for (let depth = resolved.depth; depth > 0; depth--) {
    const node = resolved.node(depth)
    if (isHeading(node) || LIST_ITEM_TYPES.has(node.type.name)) {
      return resolved.before(depth)
    }
  }
  return null
}

export function findRichMarkdownFoldSection(
  sections: RichMarkdownFoldSection[],
  anchorFrom: number
): RichMarkdownFoldSection | null {
  return sections.find((section) => section.anchorFrom === anchorFrom) ?? null
}

function sectionBodyRange(section: RichMarkdownFoldSection): { from: number; to: number } | null {
  const first = section.bodyNodes[0]
  const last = section.bodyNodes.at(-1)
  return first && last ? { from: first.from, to: last.to } : null
}

export function isRichMarkdownFoldSectionCovering(
  section: RichMarkdownFoldSection,
  from: number,
  to: number
): boolean {
  const body = sectionBodyRange(section)
  return body !== null && to > body.from && from < body.to
}

/**
 * Collapsed anchors whose hidden body would swallow the selection — the caret
 * must never land in content the reader cannot see.
 */
export function findRichMarkdownFoldsToReveal(
  sections: RichMarkdownFoldSection[],
  collapsed: readonly number[],
  from: number,
  to: number
): number[] {
  return collapsed.filter((anchorFrom) => {
    const section = findRichMarkdownFoldSection(sections, anchorFrom)
    return section !== null && isRichMarkdownFoldSectionCovering(section, from, to)
  })
}
