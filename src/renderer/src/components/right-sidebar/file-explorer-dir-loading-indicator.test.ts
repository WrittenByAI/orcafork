// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import {
  DIR_LOADING_INDICATOR_DELAY_MS,
  useDelayedDirLoadingIndicator
} from './file-explorer-dir-loading-indicator'

describe('useDelayedDirLoadingIndicator', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('never shows for a load that finishes inside the delay', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useDelayedDirLoadingIndicator(loading),
      {
        initialProps: { loading: true }
      }
    )
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(DIR_LOADING_INDICATOR_DELAY_MS - 1))
    rerender({ loading: false })
    act(() => vi.advanceTimersByTime(DIR_LOADING_INDICATOR_DELAY_MS * 2))
    expect(result.current).toBe(false)
  })

  it('shows once a load outlasts the delay and hides when it ends', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useDelayedDirLoadingIndicator(loading),
      {
        initialProps: { loading: true }
      }
    )
    act(() => vi.advanceTimersByTime(DIR_LOADING_INDICATOR_DELAY_MS))
    expect(result.current).toBe(true)
    rerender({ loading: false })
    expect(result.current).toBe(false)
  })
})
