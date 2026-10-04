import { useEffect, useRef, useState } from "react"

const DURATION_MS = 900

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

/**
 * A number that counts up from `from` to `to` once, when `play` turns true,
 * then calls `onDone`. Without play (or with reduced motion) it is `to` at
 * once, and `onDone` still runs when play was asked for.
 */
export function useCountUp(to: number, play: boolean, onDone?: () => void, from = 1): number {
  const [value, setValue] = useState(play ? from : to)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    if (!play || prefersReducedMotion() || !Number.isFinite(to) || typeof requestAnimationFrame !== "function") {
      setValue(to)
      if (play) done.current?.()
      return
    }
    let frame = 0
    setValue(from)
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION_MS, 1)
      // Ease out: fast at first, settling on the number.
      const eased = 1 - (1 - t) ** 3
      setValue(from + (to - from) * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
      else done.current?.()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to, play, from])

  return value
}
