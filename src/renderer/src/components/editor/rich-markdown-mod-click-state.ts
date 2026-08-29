type ModClickPress = {
  modKey: boolean
  time: number
  x: number
  y: number
}

// Why: a click counts as a mod-click when the modifier was down as the button
// went down. Releasing Ctrl a few milliseconds before the mouse button is normal
// hand behavior, and the click event that ProseMirror routes has already lost it.
const MOD_CLICK_MAX_AGE_MS = 1_000
const MOD_CLICK_MAX_DRIFT_PX = 6

let lastPress: ModClickPress | null = null

export function recordRichMarkdownModClickPress(event: MouseEvent, modKey: boolean): void {
  lastPress = { modKey, time: event.timeStamp, x: event.clientX, y: event.clientY }
}

export function wasRichMarkdownModClickPressed(event: MouseEvent): boolean {
  if (!lastPress?.modKey) {
    return false
  }
  return (
    event.timeStamp - lastPress.time <= MOD_CLICK_MAX_AGE_MS &&
    Math.abs(event.clientX - lastPress.x) <= MOD_CLICK_MAX_DRIFT_PX &&
    Math.abs(event.clientY - lastPress.y) <= MOD_CLICK_MAX_DRIFT_PX
  )
}

export function clearRichMarkdownModClickPress(): void {
  lastPress = null
}
