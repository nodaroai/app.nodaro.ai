// A video a tutorial can actually play.
//
// Machinery, not look: the controls live in the shared layer so every tutorial
// body gets the same playback behaviour, while the frame around it stays the
// body's own. Native `controls` would have done the job but paints a chrome bar
// that fights the design, so this is the small subset that matters — play,
// sound, fullscreen — over the tutorial's own tokens.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2 } from "lucide-react"
import { useT } from "@/lib/i18n"
import "./tutorial-video.css"

interface TutorialVideoProps {
  src: string
  poster?: string
  /** Loop silently on mount — right for a clip whose point is the motion. */
  autoPlay?: boolean
  /** Start muted. A clip that exists to demonstrate audio should not. */
  muted?: boolean
  /** Rendered bottom-left, e.g. the duration badge. */
  badge?: ReactNode
}

export function TutorialVideo({
  src,
  poster,
  autoPlay = false,
  muted = true,
  badge,
}: TutorialVideoProps) {
  const t = useT()
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(!!autoPlay)
  const [isMuted, setIsMuted] = useState(muted)
  const [full, setFull] = useState(false)

  const togglePlay = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    // Read the element rather than the state flag: the browser pauses videos on
    // its own (tab hidden, autoplay refused), and a flag would drift out of sync.
    if (el.paused) void el.play().catch(() => undefined)
    else el.pause()
  }, [])

  const toggleMute = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = !el.muted
    setIsMuted(el.muted)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const wrap = wrapRef.current
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (!wrap) return
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }
    if (wrap.requestFullscreen) {
      void wrap.requestFullscreen().catch(() => undefined)
    } else if (video?.webkitEnterFullscreen) {
      // iOS Safari will only fullscreen the video element itself.
      video.webkitEnterFullscreen()
    }
  }, [])

  // Track fullscreen from the DOM, so Esc and the browser's own exit keep the
  // button honest.
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === wrapRef.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  return (
    <div className="tv" ref={wrapRef}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        muted={muted}
        loop
        autoPlay={autoPlay}
        playsInline
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {badge && <div className="tv-badge">{badge}</div>}
      <div className="tv-controls">
        <button type="button" onClick={togglePlay} aria-label={t(playing ? "common.pause" : "common.play")}>
          {playing ? <Pause className="tv-icon" /> : <Play className="tv-icon" />}
        </button>
        <button type="button" onClick={toggleMute} aria-label={t(isMuted ? "present.unmute" : "present.mute")}>
          {isMuted ? <VolumeX className="tv-icon" /> : <Volume2 className="tv-icon" />}
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={t(full ? "common.exitFullscreen" : "common.fullscreen")}
        >
          {full ? <Minimize2 className="tv-icon" /> : <Maximize2 className="tv-icon" />}
        </button>
      </div>
    </div>
  )
}
