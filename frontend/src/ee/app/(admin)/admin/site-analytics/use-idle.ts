import { useEffect, useState } from "react"

/** What counts as someone being at the page. */
const WINDOW_ACTIVITY = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const

/**
 * True once nobody has touched the page for `ms` — a tab left open on a
 * second screen all day. Any activity, or the tab coming back into view,
 * makes it false again.
 */
export function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), ms)
    const wake = () => {
      clearTimeout(timer)
      setIdle(false)
      timer = setTimeout(() => setIdle(true), ms)
    }
    for (const event of WINDOW_ACTIVITY) window.addEventListener(event, wake, { passive: true })
    document.addEventListener("visibilitychange", wake)
    return () => {
      clearTimeout(timer)
      for (const event of WINDOW_ACTIVITY) window.removeEventListener(event, wake)
      document.removeEventListener("visibilitychange", wake)
    }
  }, [ms])
  return idle
}
