import type { KeyboardEvent } from "react"

/**
 * Props that make a click-to-seek bar (a playback progress bar, a timeline
 * track) a keyboard slider (WCAG 2.1.1, 4.1.2): it is in the Tab order,
 * announced as a slider with its position, and the arrow keys move it by
 * `step`, PageUp/PageDown by twice that, Home/End to the ends. The mouse keeps
 * the element's own click handler; this adds the keyboard path beside it.
 *
 * `fraction` is the current position in [0, 1]; `onSeek` receives the new one.
 */
export function seekSlider({
  label,
  fraction,
  onSeek,
  step = 0.05,
}: {
  readonly label: string
  readonly fraction: number
  readonly onSeek: (fraction: number) => void
  readonly step?: number
}) {
  const now = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const moves: Record<string, number> = {
    ArrowRight: step,
    ArrowUp: step,
    ArrowLeft: -step,
    ArrowDown: -step,
    PageUp: step * 2,
    PageDown: -step * 2,
  }
  return {
    role: "slider" as const,
    tabIndex: 0,
    "aria-label": label,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": Math.round(now * 100),
    "aria-valuetext": `${Math.round(now * 100)}%`,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      let next: number | null = null
      if (event.key === "Home") next = 0
      else if (event.key === "End") next = 1
      else if (event.key in moves) next = now + moves[event.key]!
      if (next === null) return
      event.preventDefault()
      event.stopPropagation()
      onSeek(Math.min(1, Math.max(0, next)))
    },
  }
}
