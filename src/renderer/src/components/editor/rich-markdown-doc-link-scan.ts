export const DOC_LINK_PATTERN = /\[\[([^[\]\r\n]+)\]\]/g
const DOC_LINK_OPEN = '[['

type DocLinkTextNodeContext = {
  type: { name: string }
  text?: string
  marks: readonly { type: { name: string } }[]
}

type DocLinkParentContext = {
  type: { spec: { code?: boolean } }
}

export function isDocLinkLiteralCodeTextNode(
  node: Pick<DocLinkTextNodeContext, 'marks'>,
  parent: DocLinkParentContext | null
): boolean {
  return parent?.type.spec.code === true || node.marks.some((mark) => mark.type.name === 'code')
}

// A link match requires the exact ASCII opener, including for non-ASCII targets.
export function canHoldDocLink(
  node: DocLinkTextNodeContext,
  parent: DocLinkParentContext | null
): node is DocLinkTextNodeContext & { text: string } {
  return (
    node.type.name === 'text' &&
    !!node.text &&
    node.text.includes(DOC_LINK_OPEN) &&
    !isDocLinkLiteralCodeTextNode(node, parent)
  )
}

/**
 * The `[[target]]` literal covering an offset in a text block — the state a link
 * is in while the caret still sits inside it, before it converts to an atom.
 */
export function findDocLinkLiteralAtOffset(text: string, offset: number): string | null {
  for (const match of text.matchAll(DOC_LINK_PATTERN)) {
    if (match.index === undefined) {
      continue
    }
    if (offset >= match.index && offset <= match.index + match[0].length) {
      return match[1]
    }
  }
  return null
}
