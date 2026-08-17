import { useEffect, useState } from 'react'

/**
 * Why: a local readdir round-trips in ~1ms, so a spinner shown on the first
 * loading frame only flashes and makes an instant expand read as "loading".
 * Hold it back like VS Code's progress delay; slow (SSH, huge dir) loads still get it.
 */
export const DIR_LOADING_INDICATOR_DELAY_MS = 150

export function useDelayedDirLoadingIndicator(
  isLoading: boolean,
  delayMs: number = DIR_LOADING_INDICATOR_DELAY_MS
): boolean {
  const [showIndicator, setShowIndicator] = useState(false)
  useEffect(() => {
    if (!isLoading) {
      setShowIndicator(false)
      return
    }
    const timer = setTimeout(() => setShowIndicator(true), delayMs)
    return () => clearTimeout(timer)
  }, [isLoading, delayMs])
  return isLoading && showIndicator
}
