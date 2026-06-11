import { useCallback, useEffect, useRef } from "react"
import { cancelRender } from "remotion"

const LOTTIE_INIT_TIMEOUT_MS = 15_000

/**
 * lottie-web can throw while BUILDING an animation (e.g. a malformed shape
 * modifier); @remotion/lottie's internal delayRender then never clears and the
 * render dies ~2 minutes later with a generic delayRender timeout (prod job
 * 73e2c691, 2026-06-11). This turns that hang into a fast, descriptive failure.
 *
 * Pass the returned callback to `<Lottie onAnimationLoaded>`. If it hasn't
 * fired within 15s of the component being `armed` (mounted with animation data
 * present), the render is cancelled with an actionable error. `armed` exists
 * for renderers that fetch animation data first — their fetch has its own
 * delayRender budget and must not count against the init window.
 */
export function useLottieInitWatchdog(label: string, armed = true): () => void {
  const loadedRef = useRef(false)
  useEffect(() => {
    if (!armed || loadedRef.current) return
    const timer = setTimeout(() => {
      if (!loadedRef.current) {
        cancelRender(
          new Error(
            `Lottie animation "${label}" failed to initialize within ${LOTTIE_INIT_TIMEOUT_MS / 1000}s — the animation data is likely malformed (lottie-web could not construct it).`,
          ),
        )
      }
    }, LOTTIE_INIT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [label, armed])
  return useCallback(() => {
    loadedRef.current = true
  }, [])
}
