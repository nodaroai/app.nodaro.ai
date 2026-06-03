import { useCallback, useRef, useState, useEffect } from "react"
import { Play, Pause, Repeat } from "lucide-react"
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
  const ms = Math.floor((seconds % 1) * 1000)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
}

function getClientX(e: MouseEvent | TouchEvent): number {
  if ("touches" in e) {
    const t = e.touches[0] ?? e.changedTouches[0]
    return t.clientX
  }
  return e.clientX
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
  const [dragging, setDragging] = useState<"start" | "end" | "playhead" | "region" | null>(null)
  const regionDragStartRef = useRef<{ time: number; trimStart: number; trimEnd: number } | null>(null)
  // Cache track bounding rect at drag-start; re-read only on each new drag.
  const dragRectRef = useRef<DOMRect | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loopEnabled, setLoopEnabled] = useState(true)
  const [playhead, setPlayhead] = useState(trim.startTime)
  const animRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const trimRef = useRef(trim)
  trimRef.current = trim
  const loopRef = useRef(loopEnabled)
  loopRef.current = loopEnabled

  const { frames, isLoading: filmstripLoading } = useFilmstrip(
    mediaType === "video" ? mediaUrl : null,
    12,
  )
  const { waveformData, isLoading: waveformLoading } = useWaveform(
    mediaType === "audio" ? mediaUrl : null,
  )

  const isLoading = mediaType === "video" ? filmstripLoading : waveformLoading

  const getTimeFromX = useCallback(
    (clientX: number) => {
      if (duration <= 0) return 0
      // Use cached rect (set at drag-start) to avoid layout reads on every move.
      const rect = dragRectRef.current ?? trackRef.current?.getBoundingClientRect()
      if (!rect) return 0
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration
    },
    [duration],
  )

  const seekToTime = useCallback((time: number) => {
    setPlayhead(time)
    if (mediaType === "video" && videoRef?.current && !isPlaying) {
      videoRef.current.currentTime = time
    }
  }, [mediaType, videoRef, isPlaying])

  // Unified drag handler (mouse + touch)
  useEffect(() => {
    if (!dragging) return

    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      const time = getTimeFromX(getClientX(e))
      if (dragging === "start") {
        const newStart = Math.min(time, trim.endTime - 0.1)
        onTrimChange({ startTime: newStart, endTime: trim.endTime })
        seekToTime(newStart)
      } else if (dragging === "end") {
        const newEnd = Math.max(time, trim.startTime + 0.1)
        onTrimChange({ startTime: trim.startTime, endTime: newEnd })
        seekToTime(newEnd)
      } else if (dragging === "playhead") {
        seekToTime(Math.max(trim.startTime, Math.min(time, trim.endTime)))
      } else if (dragging === "region" && regionDragStartRef.current) {
        const ref = regionDragStartRef.current
        const delta = time - ref.time
        const len = ref.trimEnd - ref.trimStart
        let ns = ref.trimStart + delta
        let ne = ref.trimEnd + delta
        if (ns < 0) { ns = 0; ne = len }
        if (ne > duration) { ne = duration; ns = duration - len }
        onTrimChange({ startTime: ns, endTime: ne })
        seekToTime(ns + (playhead - ref.trimStart))
      }
    }

    const handleEnd = () => {
      setDragging(null)
      regionDragStartRef.current = null
      dragRectRef.current = null
    }

    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleEnd)
    window.addEventListener("touchmove", handleMove, { passive: false })
    window.addEventListener("touchend", handleEnd)
    window.addEventListener("touchcancel", handleEnd)
    return () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleEnd)
      window.removeEventListener("touchmove", handleMove)
      window.removeEventListener("touchend", handleEnd)
      window.removeEventListener("touchcancel", handleEnd)
    }
  }, [dragging, trim, onTrimChange, getTimeFromX, seekToTime, duration, playhead])

  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-trim-handle]")) return
    seekToTime(Math.max(trim.startTime, Math.min(getTimeFromX(e.clientX), trim.endTime)))
  }, [getTimeFromX, trim, seekToTime])

  // Start drag helper (shared by mouse and touch)
  const startHandleDrag = (clientX: number, type: "start" | "end" | "playhead" | "region") => {
    if (isPlaying) stopPlayback()
    // Capture bounding rect once at drag-start so getTimeFromX doesn't re-read
    // layout on every mousemove / touchmove event.
    dragRectRef.current = trackRef.current?.getBoundingClientRect() ?? null
    if (type === "region") {
      regionDragStartRef.current = { time: getTimeFromX(clientX), trimStart: trim.startTime, trimEnd: trim.endTime }
    }
    setDragging(type)
  }

  // Playback
  const seekingRef = useRef(false)

  const stopPlayback = useCallback(() => {
    setIsPlaying(false)
    if (videoRef?.current) videoRef.current.pause()
    if (audioRef.current) audioRef.current.pause()
    if (animRef.current) cancelAnimationFrame(animRef.current)
    animRef.current = null
  }, [videoRef])

  const togglePlay = useCallback(() => {
    if (isPlaying) { stopPlayback(); return }

    const t = trimRef.current
    const startFrom = playhead >= t.endTime - 0.1 ? t.startTime : playhead

    const startMedia = (el: HTMLMediaElement) => {
      el.currentTime = startFrom
      seekingRef.current = false
      const p = el.play()
      if (p) p.catch(() => {})

      const tick = () => {
        if (!el.paused && !seekingRef.current) {
          const ct = el.currentTime
          const tr = trimRef.current
          if (ct >= tr.endTime) {
            if (loopRef.current) {
              seekingRef.current = true
              el.currentTime = tr.startTime
              const onSeeked = () => { el.removeEventListener("seeked", onSeeked); seekingRef.current = false }
              el.addEventListener("seeked", onSeeked)
            } else {
              el.pause(); setIsPlaying(false); setPlayhead(tr.endTime); return
            }
          } else {
            setPlayhead(ct)
          }
        }
        animRef.current = requestAnimationFrame(tick)
      }
      setIsPlaying(true)
      animRef.current = requestAnimationFrame(tick)
    }

    if (mediaType === "video" && videoRef?.current) startMedia(videoRef.current)
    else if (mediaType === "audio") {
      if (!audioRef.current) audioRef.current = new Audio(mediaUrl)
      startMedia(audioRef.current)
    }
  }, [isPlaying, playhead, mediaType, mediaUrl, videoRef, stopPlayback])

  useEffect(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
  }, [mediaUrl])

  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    }
  }, [])

  useEffect(() => {
    if (mediaType === "video" && videoRef?.current) videoRef.current.currentTime = trim.startTime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startPct = duration > 0 ? (trim.startTime / duration) * 100 : 0
  const endPct = duration > 0 ? (trim.endTime / duration) * 100 : 100
  const playheadPct = duration > 0 ? (playhead / duration) * 100 : 0

  // Shared touch+mouse handler for trim handles
  const handleDown = (e: React.MouseEvent | React.TouchEvent, type: "start" | "end" | "playhead" | "region") => {
    e.preventDefault()
    e.stopPropagation()
    const x = "touches" in e ? e.touches[0].clientX : e.clientX
    startHandleDrag(x, type)
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Play + Loop — own row on mobile, inline on desktop */}
      <div className="flex items-center justify-center gap-2 sm:hidden">
        <button type="button" onClick={togglePlay} className="flex items-center justify-center w-8 h-8 rounded-full bg-[#ff0073] hover:bg-[#ff0073]/80 text-white transition-colors">
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <button type="button" onClick={() => setLoopEnabled(!loopEnabled)} title={loopEnabled ? "Loop on" : "Loop off"}
          className={`flex items-center justify-center w-8 h-8 rounded-full border transition-colors ${loopEnabled ? "border-[#ff0073]/50 bg-[#ff0073]/10 text-[#ff0073]" : "border-white/20 text-white/30"}`}>
          <Repeat className="w-4 h-4" />
        </button>
      </div>

      {/* Controls row: Trim | Play+Loop (desktop only, centered) | Time */}
      <div className="relative flex items-center justify-between text-xs text-muted-foreground px-1 h-8">
        <span>Trim</span>
        {/* Desktop only — centered */}
        <div className="absolute left-1/2 -translate-x-1/2 hidden sm:flex items-center gap-2">
          <button type="button" onClick={togglePlay} className="flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] hover:bg-[#ff0073]/80 text-white transition-colors">
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>
          <button type="button" onClick={() => setLoopEnabled(!loopEnabled)} title={loopEnabled ? "Loop on" : "Loop off"}
            className={`flex items-center justify-center w-7 h-7 rounded-full border transition-colors ${loopEnabled ? "border-[#ff0073]/50 bg-[#ff0073]/10 text-[#ff0073]" : "border-white/20 text-white/30 hover:text-white/50"}`}>
            <Repeat className="w-3.5 h-3.5" />
          </button>
        </div>
        <span className="text-[11px] sm:text-xs">
          <span className="text-[#ff0073]">{formatTime(trim.startTime)}</span>
          {" — "}
          <span className="text-[#ff0073]">{formatTime(trim.endTime)}</span>
          <span className="text-muted-foreground/50"> ({formatTime(duration)})</span>
        </span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-12 bg-[#1a1a2a] rounded-lg overflow-hidden select-none cursor-pointer touch-none"
        onClick={handleTrackClick}
      >
        {/* Filmstrip */}
        {mediaType === "video" && (
          <div className="absolute inset-0 flex pointer-events-none">
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">Loading...</div>
            ) : frames.map((frame, i) => (
              <img key={i} src={frame.dataUrl} alt="" className="h-full object-cover opacity-40" style={{ width: `${100 / frames.length}%` }} draggable={false} />
            ))}
          </div>
        )}

        {/* Waveform */}
        {mediaType === "audio" && (
          <div className="absolute inset-0 flex items-center gap-px px-1 pointer-events-none">
            {waveformLoading ? (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">Loading...</div>
            ) : waveformData.map((amp, i) => {
              const pct = (i / waveformData.length) * 100
              return <div key={i} className={cn("flex-1 rounded-sm", pct >= startPct && pct <= endPct ? "bg-[#ff0073]" : "bg-muted-foreground/20")} style={{ height: `${Math.max(4, amp * 100)}%` }} />
            })}
          </div>
        )}

        {/* Inactive dim */}
        <div className="absolute top-0 bottom-0 left-0 bg-black/50 pointer-events-none" style={{ width: `${startPct}%` }} />
        <div className="absolute top-0 bottom-0 right-0 bg-black/50 pointer-events-none" style={{ width: `${100 - endPct}%` }} />

        {/* Active region — drag to slide */}
        <div
          data-trim-handle
          className="absolute top-0 bottom-0 border-t-2 border-b-2 border-[#ff0073]/30 cursor-grab active:cursor-grabbing touch-none"
          style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
          onMouseDown={(e) => handleDown(e, "region")}
          onTouchStart={(e) => handleDown(e, "region")}
        />

        {/* Start handle */}
        <div
          data-trim-handle
          className="absolute top-0 bottom-0 cursor-ew-resize z-10 touch-none"
          style={{ left: `calc(${startPct}% - 8px)`, width: 16 }}
          onMouseDown={(e) => handleDown(e, "start")}
          onTouchStart={(e) => handleDown(e, "start")}
        >
          <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-1 bg-[#ff0073]" />
          <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-4 h-6 bg-[#ff0073] rounded-sm flex items-center justify-center">
            <div className="w-0.5 h-3 bg-white/60 rounded-full" />
          </div>
        </div>

        {/* End handle */}
        <div
          data-trim-handle
          className="absolute top-0 bottom-0 cursor-ew-resize z-10 touch-none"
          style={{ left: `calc(${endPct}% - 8px)`, width: 16 }}
          onMouseDown={(e) => handleDown(e, "end")}
          onTouchStart={(e) => handleDown(e, "end")}
        >
          <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-1 bg-[#ff0073]" />
          <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-4 h-6 bg-[#ff0073] rounded-sm flex items-center justify-center">
            <div className="w-0.5 h-3 bg-white/60 rounded-full" />
          </div>
        </div>

        {/* Playhead */}
        <div
          data-trim-handle
          className="absolute top-0 bottom-0 z-20 cursor-ew-resize touch-none"
          style={{ left: `calc(${playheadPct}% - 8px)`, width: 16 }}
          onMouseDown={(e) => handleDown(e, "playhead")}
          onTouchStart={(e) => handleDown(e, "playhead")}
        >
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white -translate-x-1/2" />
          <div className="absolute left-1/2 -top-1 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow" />
        </div>
      </div>
    </div>
  )
}
