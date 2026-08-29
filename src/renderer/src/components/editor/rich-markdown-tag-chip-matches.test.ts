import { describe, expect, it } from 'vitest'
import { findRichMarkdownTagChips } from './rich-markdown-tag-chip-matches'

function chipTexts(text: string): string[] {
  return findRichMarkdownTagChips(text).map((match) => text.slice(match.from, match.to))
}

describe('findRichMarkdownTagChips', () => {
  it('matches tags anywhere a word can start', () => {
    expect(chipTexts('#alpha and (#beta) then #gamma.')).toEqual(['#alpha', '#beta', '#gamma'])
  })

  it('matches non-Latin tags', () => {
    expect(chipTexts('заметка #автопостинг и #ручная-замена')).toEqual([
      '#автопостинг',
      '#ручная-замена'
    ])
  })

  it('matches nested tag paths', () => {
    expect(chipTexts('#work/orca/editor')).toEqual(['#work/orca/editor'])
  })

  it('skips issue references and other all-digit bodies', () => {
    expect(chipTexts('fixes #1234 and #12/34')).toEqual([])
    expect(chipTexts('#1234abc')).toEqual(['#1234abc'])
  })

  it('skips a # glued to a preceding word or path character', () => {
    expect(chipTexts('foo#bar')).toEqual([])
    expect(chipTexts('https://example.com/#section')).toEqual([])
    expect(chipTexts('##double')).toEqual([])
  })

  it('leaves trailing separators out of the chip', () => {
    expect(chipTexts('#tag/ ends')).toEqual(['#tag'])
    expect(chipTexts('#tag- ends')).toEqual(['#tag'])
  })

  it('ignores a bare # and whitespace after it', () => {
    expect(chipTexts('# heading-ish text')).toEqual([])
    expect(chipTexts('#')).toEqual([])
  })
})
