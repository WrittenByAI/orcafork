export type RichMarkdownTagChipMatch = {
  from: number
  to: number
}

// Tag bodies follow Obsidian: letters (any script), digits, underscore, hyphen
// and slash, with at least one non-digit so issue refs like #1234 stay plain.
const TAG_CANDIDATE = /#[\p{L}\p{N}_/-]+/gu
// Why: a # glued to a preceding word or path character is a fragment or an
// inline anchor (foo#bar, https://host/#section), never a tag.
const TAG_BLOCKING_PREFIX = /[\p{L}\p{N}_#/]/u
const TAG_TRAILING_PUNCTUATION = /[-/]+$/
const TAG_REQUIRED_CHARACTER = /[\p{L}_]/u

export function findRichMarkdownTagChips(text: string): RichMarkdownTagChipMatch[] {
  const matches: RichMarkdownTagChipMatch[] = []
  for (const candidate of text.matchAll(TAG_CANDIDATE)) {
    const start = candidate.index
    const previous = start > 0 ? text[start - 1] : ''
    if (previous !== '' && TAG_BLOCKING_PREFIX.test(previous)) {
      continue
    }
    const body = candidate[0].slice(1).replace(TAG_TRAILING_PUNCTUATION, '')
    if (!TAG_REQUIRED_CHARACTER.test(body)) {
      continue
    }
    matches.push({ from: start, to: start + 1 + body.length })
  }
  return matches
}
