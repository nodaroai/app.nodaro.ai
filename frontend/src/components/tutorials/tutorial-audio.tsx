// A clip a tutorial can listen to.
//
// The audio counterpart of TutorialVideo, and shared for the same reason: how
// playback behaves is machinery, while the card around it belongs to the body.
// Deliberately smaller than a full player — a tutorial needs "let me hear it",
// not scrubbing.

import { useCallback, useEffect, useRef, useState } from "react"
import { Play, Pause } from "lucide-react"
import { useT } from "@/lib/i18n"
import "./tutorial-audio.css"

/** m:ss, or null while the browser has not read the metadata yet. */
function clock(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

export function TutorialAudio({ src, label }: { src: string; label?: string }) {
  const t = useT()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const toggle = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    // Ask the element, not a flag — it can pause without telling us.
    if (el.paused) void el.play().catch(() => undefined)
    else el.pause()
  }, [])

  // Reset the readout when the clip changes, so a stale duration never shows
  // against a different file.
  useEffect(() => {
    setDuration(null)
    setElapsed(0)
    setPlaying(false)
  }, [src])

  const progress = duration && duration > 0 ? Math.min(1, elapsed / duration) : 0
  const readout = playing || elapsed > 0 ? clock(elapsed) : clock(duration)

  return (
    <div className="ta">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setElapsed(0)}
      />
      <button
        type="button"
        className="ta-button"
        onClick={toggle}
        aria-label={t(playing ? "tut.pauseLabel" : "tut.playLabel", { label: label ?? t("tut.audioNoun") })}
      >
        {playing ? <Pause className="ta-icon" /> : <Play className="ta-icon" />}
      </button>
      <div className="ta-track" aria-hidden="true">
        <div className="ta-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>
      {readout && <span className="ta-time">{readout}</span>}
    </div>
  )
}
