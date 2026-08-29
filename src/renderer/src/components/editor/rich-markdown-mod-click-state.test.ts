import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRichMarkdownModClickPress,
  recordRichMarkdownModClickPress,
  wasRichMarkdownModClickPressed
} from './rich-markdown-mod-click-state'

function mouseEvent(time: number, x = 100, y = 100): MouseEvent {
  return { timeStamp: time, clientX: x, clientY: y } as MouseEvent
}

beforeEach(() => {
  clearRichMarkdownModClickPress()
})

describe('rich markdown mod-click state', () => {
  it('treats a click as modified when the modifier was down at mousedown', () => {
    recordRichMarkdownModClickPress(mouseEvent(1_000), true)

    expect(wasRichMarkdownModClickPressed(mouseEvent(1_120))).toBe(true)
  })

  it('ignores a press made without the modifier', () => {
    recordRichMarkdownModClickPress(mouseEvent(1_000), false)

    expect(wasRichMarkdownModClickPressed(mouseEvent(1_010))).toBe(false)
  })

  it('does not carry a stale press into a later unmodified click', () => {
    recordRichMarkdownModClickPress(mouseEvent(1_000), true)

    expect(wasRichMarkdownModClickPressed(mouseEvent(2_500))).toBe(false)
  })

  it('does not carry a press across a drag to another spot', () => {
    recordRichMarkdownModClickPress(mouseEvent(1_000, 100, 100), true)

    expect(wasRichMarkdownModClickPressed(mouseEvent(1_050, 400, 100))).toBe(false)
  })
})
