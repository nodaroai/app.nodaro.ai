import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Frame transport for the 3D preview.
 *
 * Frames are the unit of truth (the plan is authored in frames and the export
 * is frame-deterministic), so playback advances the frame from WALL CLOCK time
 * rather than counting animation frames — a dropped rAF then shows up as a
 * skipped frame, exactly like the renderer, instead of as slow motion.
 */
export function useScene3DPlayback(durationInFrames: number, fps: number) {
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<{ time: number; frame: number } | null>(null)
  // The loop's own output, read (never depended on) when playback starts —
  // anchoring the effect on `frame` would restart the timer every painted frame.
  const frameRef = useRef(0)
  frameRef.current = frame

  const lastFrame = Math.max(0, durationInFrames - 1)

  // A shorter revision must not leave the playhead past the end.
  useEffect(() => {
    setFrame((f) => (f > lastFrame ? lastFrame : f))
  }, [lastFrame])

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      startRef.current = null
      return
    }
    startRef.current = { time: performance.now(), frame: frameRef.current }
    const step = () => {
      const anchor = startRef.current
      if (!anchor) return
      const elapsedFrames = ((performance.now() - anchor.time) / 1000) * fps
      const next = durationInFrames > 0
        ? Math.floor(anchor.frame + elapsedFrames) % durationInFrames
        : 0
      setFrame(next)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [playing, fps, durationInFrames])

  const seek = useCallback(
    (value: number) => {
      const clamped = Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), lastFrame) : 0
      setFrame(clamped)
      if (startRef.current) startRef.current = { time: performance.now(), frame: clamped }
    },
    [lastFrame],
  )

  return { frame, playing, setPlaying, seek, lastFrame }
}
