/**
 * React wrapper around `probeAudioDuration` (lib/audio-duration) — resolves a
 * wired audio URL to its duration in seconds, or `undefined` while loading /
 * when the browser can't decode it. The probe layer caches per URL, so many
 * consumers (node preview + config panel) share one metadata fetch.
 *
 * Used by still-to-video, where the audio's duration IS the output length —
 * the "hero fact" surfaced on the node preview and the panel footer before
 * any render runs.
 */
import { useEffect, useState } from "react"
import { probeAudioDuration } from "@/lib/audio-duration"

export function useProbedAudioDuration(url: string | undefined): number | undefined {
  const [duration, setDuration] = useState<number | undefined>(undefined)

  useEffect(() => {
    let alive = true
    if (!url) {
      setDuration(undefined)
      return
    }
    probeAudioDuration(url).then((seconds) => {
      if (alive) setDuration(seconds)
    })
    return () => {
      alive = false
    }
  }, [url])

  return url ? duration : undefined
}

/** "0:24.6" — clip-length format (m:ss.tenths), matching the node design. */
export function formatClipLength(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const rest = seconds - m * 60
  const whole = Math.floor(rest)
  const tenths = Math.floor((rest - whole) * 10)
  return `${m}:${String(whole).padStart(2, "0")}.${tenths}`
}
