import { describe, expect, it } from 'vitest'
import {
  canHoldDocLink,
  DOC_LINK_PATTERN,
  findDocLinkLiteralAtOffset
} from './rich-markdown-doc-link-scan'

function textContext(text: string, markNames: string[] = []) {
  return {
    type: { name: 'text' },
    text,
    marks: markNames.map((name) => ({ type: { name } }))
  }
}

function parentContext(code: boolean) {
  return {
    type: {
      spec: { code }
    }
  }
}

function scan(text: string, markNames: string[] = [], parentCode = false): string[] {
  const node = textContext(text, markNames)
  if (!canHoldDocLink(node, parentContext(parentCode))) {
    return []
  }
  return [...node.text.matchAll(DOC_LINK_PATTERN)].map((match) => match[1])
}

describe('production doc-link scan predicate', () => {
  it('finds links in ordinary prose, including non-ASCII targets', () => {
    expect(scan('See [[Guide]] and [[文档/😀]].')).toEqual(['Guide', '文档/😀'])
  })

  it('rejects ordinary prose without the exact opener', () => {
    expect(scan('See [Guide], plain prose, and closed brackets]].')).toEqual([])
  })

  it('skips inline and fenced code', () => {
    expect(scan('`[[inline]]`', ['code'])).toEqual([])
    expect(scan('[[fenced]]', [], true)).toEqual([])
  })

  it('does not match links across CR or LF boundaries', () => {
    expect(scan('[[carriage\rreturn]]')).toEqual([])
    expect(scan('[[line\nfeed]]')).toEqual([])
  })
})

describe('findDocLinkLiteralAtOffset', () => {
  const text = 'see [[Target|Alias]] and [[Other]] here'
  const targetStart = text.indexOf('[[Target')
  const targetEnd = targetStart + '[[Target|Alias]]'.length

  it('claims every offset from the opening bracket through the closing one', () => {
    expect(findDocLinkLiteralAtOffset(text, targetStart)).toBe('Target|Alias')
    expect(findDocLinkLiteralAtOffset(text, targetStart + 4)).toBe('Target|Alias')
    expect(findDocLinkLiteralAtOffset(text, targetEnd)).toBe('Target|Alias')
  })

  it('returns the link the offset is actually in', () => {
    expect(findDocLinkLiteralAtOffset(text, text.indexOf('[[Other') + 3)).toBe('Other')
  })

  it('ignores offsets outside any link', () => {
    expect(findDocLinkLiteralAtOffset(text, 1)).toBeNull()
    expect(findDocLinkLiteralAtOffset(text, text.length - 1)).toBeNull()
    expect(findDocLinkLiteralAtOffset('no links here', 4)).toBeNull()
  })
})
