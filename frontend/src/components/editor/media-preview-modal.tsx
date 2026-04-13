"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { X, ChevronLeft, ChevronRight, Play, Pause, RotateCcw, Repeat, Square, Volume2, VolumeX } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"

interface MediaPreviewModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly type: "image" | "video" | "audio" | "text"
  readonly url: string
  /** All results for internal prev/next navigation (overrides currentIndex/totalCount/onPrev/onNext) */
  readonly results?: ReadonlyArray<{ url?: string; text?: string; type?: "image" | "video" | "audio" | "text" }>
  /** Starting index into results (default 0) */
  readonly initialIndex?: number
  /** Called when internal navigation changes the viewed index */
  readonly onIndexChange?: (index: number) => void
  /** Current 0-based index (for "X of Y" counter) — used when results not provided */
  readonly currentIndex?: number
  /** Total items across all pages — used when results not provided */
  readonly totalCount?: number
  /** Navigate to previous item (undefined = at start) — used when results not provided */
  readonly onPrev?: () => void
  /** Navigate to next item (undefined = at end) — used when results not provided */
  readonly onNext?: () => void
  /** Called when user changes video playback state from fullscreen controls */
  readonly onVideoStateChange?: (state: { playState: "loop" | "paused" | "stopped"; currentTime: number }) => void
  /** Initial video play state from the node (respects paused/stopped state) */
  readonly initialVideoPlayState?: "loop" | "paused" | "stopped"
  /** Initial seek time when opening in paused state */
  readonly initialPausedAtTime?: number
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function MediaPreviewModal({ isOpen, onClose, type, url, results, initialIndex, onIndexChange, currentIndex, totalCount, onPrev, onNext, onVideoStateChange, initialVideoPlayState, initialPausedAtTime }: MediaPreviewModalProps) {
  // Internal navigation state when results array is provided
  const validResults = results?.filter((r) => r.url || r.text) ?? []
  const hasInternalNav = validResults.length > 1
  const [viewIndex, setViewIndex] = useState(initialIndex ?? 0)

  // Per-item derivations — declared early so video-state effects can depend on effectiveType
  const effectiveType: "image" | "video" | "audio" | "text" =
    hasInternalNav ? (validResults[viewIndex]?.type ?? type) : type
  const effectiveText = hasInternalNav ? validResults[viewIndex]?.text : undefined
  const effectiveUrl  = hasInternalNav ? (validResults[viewIndex]?.url ?? url) : url

  // Video state
  const videoRef = useRef<HTMLVideoElement>(null)
  const initialState = initialVideoPlayState ?? "loop"
  const [isPlaying, setIsPlaying] = useState(initialState === "loop")
  const [activeState, setActiveState] = useState<"loop" | "paused" | "stopped">(initialState)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const progressBarRef = useRef<HTMLDivElement>(null)

  // Reset viewIndex when modal opens or initialIndex changes
  useEffect(() => {
    if (isOpen) setViewIndex(initialIndex ?? 0)
  }, [isOpen, initialIndex])

  // Respect node play state when modal opens
  useEffect(() => {
    if (!isOpen || effectiveType !== "video") return
    const state = initialVideoPlayState ?? "loop"
    setIsPlaying(state === "loop")
    setActiveState(state)
    setControlsVisible(true)
  }, [isOpen, effectiveType, initialVideoPlayState])

  // Apply initial state to the video element after it loads
  useEffect(() => {
    if (!isOpen || effectiveType !== "video") return
    const video = videoRef.current
    if (!video) return
    const state = initialVideoPlayState ?? "loop"
    if (state === "loop") {
      video.play().catch(() => {})
    } else if (state === "paused") {
      video.pause()
      if (initialPausedAtTime !== undefined) video.currentTime = initialPausedAtTime
    } else {
      video.pause()
      video.currentTime = 0
    }
  }, [isOpen, effectiveType, initialVideoPlayState, initialPausedAtTime])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = isMuted
  }, [isMuted])

  // Auto-hide controls after 2s of no mouse movement
  const resetHideTimer = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2000)
  }, [])

  useEffect(() => {
    return () => clearTimeout(hideTimerRef.current)
  }, [])

  const goInternalPrev = useCallback(() => {
    setViewIndex((prev) => {
      const next = Math.max(0, prev - 1)
      onIndexChange?.(next)
      return next
    })
  }, [onIndexChange])

  const goInternalNext = useCallback(() => {
    setViewIndex((prev) => {
      const next = Math.min(validResults.length - 1, prev + 1)
      onIndexChange?.(next)
      return next
    })
  }, [validResults.length, onIndexChange])

  // Determine which navigation to use
  const effectiveIndex = hasInternalNav ? viewIndex : currentIndex
  const effectiveTotal = hasInternalNav ? validResults.length : totalCount
  const effectivePrev = hasInternalNav ? (viewIndex > 0 ? goInternalPrev : undefined) : onPrev
  const effectiveNext = hasInternalNav ? (viewIndex < validResults.length - 1 ? goInternalNext : undefined) : onNext
  const hasNav = effectiveIndex !== undefined && effectiveTotal !== undefined

  // Video controls
  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play().catch(() => {})
      setActiveState("loop")
      onVideoStateChange?.({ playState: "loop", currentTime: video.currentTime })
    } else {
      video.pause()
      setActiveState("paused")
      onVideoStateChange?.({ playState: "paused", currentTime: video.currentTime })
    }
  }, [onVideoStateChange])

  const restart = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    video.play().catch(() => {})
    setActiveState("loop")
    onVideoStateChange?.({ playState: "loop", currentTime: 0 })
  }, [onVideoStateChange])

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    const bar = progressBarRef.current
    if (!video || !bar) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    video.currentTime = ratio * video.duration
  }, [])

  // Node state controls — also drive the fullscreen video for immediate feedback
  const setNodeState = useCallback((playState: "loop" | "stopped") => {
    const video = videoRef.current
    const time = video?.currentTime ?? 0
    setActiveState(playState)
    onVideoStateChange?.({ playState, currentTime: time })
    if (video) {
      if (playState === "stopped") {
        video.pause()
        video.currentTime = 0
      } else {
        video.play().catch(() => {})
      }
    }
  }, [onVideoStateChange])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopImmediatePropagation(); handleClose() }
    if (e.key === "ArrowLeft" && effectivePrev) { e.stopImmediatePropagation(); effectivePrev() }
    if (e.key === "ArrowRight" && effectiveNext) { e.stopImmediatePropagation(); effectiveNext() }
    if (e.key === " " && effectiveType === "video") { e.preventDefault(); e.stopImmediatePropagation(); togglePlay() }
  }, [handleClose, effectivePrev, effectiveNext, effectiveType, togglePlay])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [isOpen, handleKeyDown])

  // Touch swipe support
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return
    if (dx < 0 && effectiveNext) effectiveNext()
    if (dx > 0 && effectivePrev) effectivePrev()
  }, [effectivePrev, effectiveNext])

  const hasContent = effectiveUrl || effectiveText
  if (!isOpen || !hasContent) return null

  const shouldAutoPlay = (initialVideoPlayState ?? "loop") === "loop" && effectiveType === "video"

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] bg-black/80 flex items-center justify-center"
      onClick={handleClose}
      onTouchStart={hasNav ? handleTouchStart : undefined}
      onTouchEnd={hasNav ? handleTouchEnd : undefined}
      onMouseMove={effectiveType === "video" ? resetHideTimer : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-[95vw] max-h-[95vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          aria-label="Close preview"
          className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors z-20"
          onClick={handleClose}
        >
          <X className="w-7 h-7" />
        </button>

        {/* Counter — bottom center */}
        {hasNav && (
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-white/70 text-sm tabular-nums">
            {effectiveIndex! + 1} / {effectiveTotal}
          </div>
        )}

        {/* Prev button */}
        {effectivePrev && (
          <button
            type="button"
            aria-label="Previous"
            className="absolute left-0 md:-left-12 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
            onClick={(e) => { e.stopPropagation(); effectivePrev() }}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* Next button */}
        {effectiveNext && (
          <button
            type="button"
            aria-label="Next"
            className="absolute right-0 md:-right-12 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
            onClick={(e) => { e.stopPropagation(); effectiveNext() }}
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {effectiveType === "text" ? (
          <div
            className="bg-card border border-border rounded-lg p-6 max-w-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {effectiveText}
            </p>
          </div>
        ) : effectiveType === "video" ? (
          <div className="relative max-w-full max-h-[80vh] flex items-center justify-center">
            <video
              ref={videoRef}
              key={effectiveUrl}
              src={effectiveUrl}
              className="max-w-full max-h-[80vh] rounded-lg"
              autoPlay={shouldAutoPlay}
              loop
              playsInline
              onClick={togglePlay}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            />

            {/* Custom control bar */}
            <div
              className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent rounded-b-lg px-4 pt-8 pb-3 transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              {/* Progress bar */}
              <div
                ref={progressBarRef}
                className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer mb-3 group/progress"
                onClick={handleSeek}
              >
                <div
                  className="h-full bg-[#ff0073] rounded-full relative"
                  style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%" }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-sm opacity-0 group-hover/progress:opacity-100 transition-opacity" />
                </div>
              </div>

              <div className="flex items-center justify-between">
                {/* Left: playback controls */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={isPlaying ? "Pause" : "Play"}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white transition-colors"
                    onClick={togglePlay}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>
                  <button
                    type="button"
                    aria-label="Restart"
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white transition-colors"
                    onClick={restart}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={isMuted ? "Unmute" : "Mute"}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white transition-colors"
                    onClick={() => setIsMuted((m) => !m)}
                  >
                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <span className="text-white/60 text-xs tabular-nums ml-1">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                {/* Right: node state controls — Loop and Stop only (play/pause is on the left) */}
                {onVideoStateChange && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Set node to loop"
                      title="Loop on node"
                      className={`w-8 h-8 flex items-center justify-center rounded-full border border-dashed transition-colors ${
                        activeState === "loop"
                          ? "border-[#38BDF8] text-[#38BDF8]"
                          : "border-white/50 text-white/50 hover:text-white hover:border-white/70"
                      }`}
                      onClick={() => setNodeState("loop")}
                    >
                      <Repeat className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Stop node (show first frame)"
                      title="Stop — show first frame on node"
                      className={`w-8 h-8 flex items-center justify-center rounded-full border transition-colors ${
                        activeState === "stopped"
                          ? "border-[#38BDF8] bg-[#38BDF8]/20 text-[#38BDF8]"
                          : "border-transparent text-white/50 hover:text-white hover:bg-white/10"
                      }`}
                      onClick={() => setNodeState("stopped")}
                    >
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : effectiveType === "audio" ? (
          <audio key={effectiveUrl} src={effectiveUrl} controls autoPlay className="w-full" />
        ) : (
          /* effectiveType === "image" — final else, no implicit fallback */
          <CachedImage src={effectiveUrl} alt="Preview" className="max-w-full max-h-[90vh] rounded-lg object-contain" />
        )}
      </div>
    </div>,
    document.body
  )
}
