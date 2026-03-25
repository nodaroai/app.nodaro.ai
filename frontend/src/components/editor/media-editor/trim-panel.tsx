// frontend/src/components/editor/media-editor/trim-panel.tsx
import { useCallback, useRef, useState, useEffect } from "react"
import { Play, Pause } from "lucide-react"
import { cn } from "@/lib/utils"
import { useFilmstrip } from "./use-filmstrip"
import { useWaveform } from "./use-waveform"
import type { TrimState } from "./utils"

interface TrimPanelProps {
  mediaUrl: string
  mediaType: "video" | "audio"
  duration: number
  trim: TrimState
  onTrimChange: (trim: TrimState) => void
  videoRef?: React.RefObject<HTMLVideoElement | null>
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function TrimPanel({
  mediaUrl,
  mediaType,
  duration,
  trim,
  onTrimChange,
  videoRef,
}: TrimPanelProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<"start" | "end" | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(trim.startTime)
  const animRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const { frames, isLoading: filmstripLoading } = useFilmstrip(
    mediaType === "video" ? mediaUrl : null,
    12,
  )
  const { waveformData, isLoading: waveformLoading } = useWaveform(
    mediaType === "audio" ? mediaUrl : null,
  )

  const isLoading = mediaType === "video" ? filmstripLoading : waveformLoading

  const getPositionFromEvent = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track || duration <= 0) return 0
      const rect = track.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return ratio * duration
    },
    [duration],
  )

  // Handle drag
  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const time = getPositionFromEvent(e.clientX)
      if (dragging === "start") {
        onTrimChange({ startTime: Math.min(time, trim.endTime - 0.1), endTime: trim.endTime })
      } else {
        onTrimChange({ startTime: trim.startTime, endTime: Math.max(time, trim.startTime + 0.1) })
      }
    }

    const handleMouseUp = () => setDragging(null)

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [dragging, trim, onTrimChange, getPositionFromEvent])

  // Playback
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false)
      if (videoRef?.current) videoRef.current.pause()
      if (audioRef.current) audioRef.current.pause()
      if (animRef.current) cancelAnimationFrame(animRef.current)
      return
    }

    setIsPlaying(true)
    setPlayhead(trim.startTime)

    if (mediaType === "video" && videoRef?.current) {
      const video = videoRef.current
      video.currentTime = trim.startTime
      video.play()

      const tick = () => {
        if (video.currentTime >= trim.endTime) {
          video.pause()
          setIsPlaying(false)
          setPlayhead(trim.startTime)
          return
        }
        setPlayhead(video.currentTime)
        animRef.current = requestAnimationFrame(tick)
      }
      animRef.current = requestAnimationFrame(tick)
    } else if (mediaType === "audio") {
      if (!audioRef.current) {
        audioRef.current = new Audio(mediaUrl)
      }
      const audio = audioRef.current
      audio.currentTime = trim.startTime
      audio.play()

      const tick = () => {
        if (audio.currentTime >= trim.endTime) {
          audio.pause()
          setIsPlaying(false)
          setPlayhead(trim.startTime)
          return
        }
        setPlayhead(audio.currentTime)
        animRef.current = requestAnimationFrame(tick)
      }
      animRef.current = requestAnimationFrame(tick)
    }
  }, [isPlaying, trim, mediaType, mediaUrl, videoRef])

  // Reset audio element when URL changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }, [mediaUrl])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  const startPct = duration > 0 ? (trim.startTime / duration) * 100 : 0
  const endPct = duration > 0 ? (trim.endTime / duration) * 100 : 100
  const playheadPct = duration > 0 ? (playhead / duration) * 100 : 0

  return (
    <div className="flex flex-col gap-2">
      {/* Time display */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>Trim</span>
        <span>
          <span className="text-[#ff0073]">{formatTime(trim.startTime)}</span>
          {" — "}
          <span className="text-[#ff0073]">{formatTime(trim.endTime)}</span>
          <span className="text-muted-foreground/50"> (of {formatTime(duration)})</span>
        </span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-12 bg-[#1a1a2a] rounded-lg overflow-hidden select-none"
      >
        {/* Filmstrip frames (video) */}
        {mediaType === "video" && (
          <div className="absolute inset-0 flex">
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                Loading frames...
              </div>
            ) : (
              frames.map((frame, i) => (
                <img
                  key={i}
                  src={frame.dataUrl}
                  alt=""
                  className="h-full object-cover opacity-40"
                  style={{ width: `${100 / frames.length}%` }}
                  draggable={false}
                />
              ))
            )}
          </div>
        )}

        {/* Waveform bars (audio) */}
        {mediaType === "audio" && (
          <div className="absolute inset-0 flex items-center gap-px px-1">
            {waveformLoading ? (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                Loading waveform...
              </div>
            ) : (
              waveformData.map((amplitude, i) => {
                const pct = (i / waveformData.length) * 100
                const inRange = pct >= startPct && pct <= endPct
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex-1 rounded-sm transition-colors",
                      inRange ? "bg-[#ff0073]" : "bg-muted-foreground/20",
                    )}
                    style={{ height: `${Math.max(4, amplitude * 100)}%` }}
                  />
                )
              })
            )}
          </div>
        )}

        {/* Inactive regions (dimmed) */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-black/50 pointer-events-none"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 right-0 bg-black/50 pointer-events-none"
          style={{ width: `${100 - endPct}%` }}
        />

        {/* Active region border */}
        <div
          className="absolute top-0 bottom-0 border-t-2 border-b-2 border-[#ff0073]/30 pointer-events-none"
          style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
        />

        {/* Start handle */}
        <div
          className="absolute top-0 bottom-0 w-1 bg-[#ff0073] cursor-ew-resize z-10 hover:w-1.5"
          style={{ left: `${startPct}%` }}
          onMouseDown={(e) => {
            e.preventDefault()
            setDragging("start")
          }}
        >
          <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-4 h-6 bg-[#ff0073] rounded-sm flex items-center justify-center">
            <div className="w-0.5 h-3 bg-white/60 rounded-full" />
          </div>
        </div>

        {/* End handle */}
        <div
          className="absolute top-0 bottom-0 w-1 bg-[#ff0073] cursor-ew-resize z-10 hover:w-1.5"
          style={{ left: `${endPct}%` }}
          onMouseDown={(e) => {
            e.preventDefault()
            setDragging("end")
          }}
        >
          <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-4 h-6 bg-[#ff0073] rounded-sm flex items-center justify-center">
            <div className="w-0.5 h-3 bg-white/60 rounded-full" />
          </div>
        </div>

        {/* Playhead */}
        {isPlaying && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white z-20 pointer-events-none"
            style={{ left: `${playheadPct}%` }}
          />
        )}
      </div>

      {/* Play button */}
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#ff0073] hover:bg-[#ff0073]/80 text-white text-xs transition-colors"
        >
          {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {isPlaying ? "Pause" : "Preview"}
        </button>
      </div>
    </div>
  )
}
