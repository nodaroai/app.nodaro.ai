import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { ChevronLeft, ChevronRight, ImageIcon, VideoIcon, Music, FileText } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { getOutputType, type OutputType } from "@/lib/presentation-utils"
import { GlassCard } from "../output-cards/shared"
import { WaveformBars } from "../input-cards/shared"
import type { ViewProps } from "./types"

interface FullscreenViewProps extends ViewProps {
  onBack: () => void
}

interface OutputItem {
  nodeId: string
  title: string
  outputType: OutputType
  url?: string
  text?: string
}

export function FullscreenView({
  orderedOutputNodes,
  getNodeStatus,
  getResult,
  getCardTitle,
  onBack,
}: FullscreenViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const touchStartRef = useRef<number | null>(null)

  const items: OutputItem[] = useMemo(() => {
    return orderedOutputNodes
      .map((node) => {
        const outputType = getOutputType(node.type)
        const result = getResult(node.id)
        if (!result.url && !result.text) return null
        return {
          nodeId: node.id,
          title: getCardTitle(node),
          outputType,
          url: result.url,
          text: result.text,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [orderedOutputNodes, getResult, getCardTitle])

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, items.length - 1))
  }, [items.length])

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext()
      else if (e.key === "ArrowLeft") goPrev()
      else if (e.key === "Escape") onBack()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [goNext, goPrev, onBack])

  // Touch swipe
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartRef.current === null) return
    const diff = e.changedTouches[0].clientX - touchStartRef.current
    if (Math.abs(diff) > 50) {
      if (diff < 0) goNext()
      else goPrev()
    }
    touchStartRef.current = null
  }, [goNext, goPrev])

  // Clamp index if items shrink
  useEffect(() => {
    if (currentIndex >= items.length && items.length > 0) {
      setCurrentIndex(items.length - 1)
    }
  }, [currentIndex, items.length])

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 p-6">
        <FileText className="w-12 h-12 text-muted-foreground/30" />
        <p className="text-sm">Run the workflow to see outputs</p>
      </div>
    )
  }

  const current = items[currentIndex]

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center relative select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Counter */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-xs text-muted-foreground font-medium">
        {currentIndex + 1} of {items.length}
      </div>

      {/* Title */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 text-[11px] text-muted-foreground/60 uppercase tracking-wider">
        {current.title}
      </div>

      {/* Left arrow */}
      <button
        type="button"
        onClick={goPrev}
        disabled={currentIndex === 0}
        className={`absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-11 h-11 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors z-10 touch-manipulation ${
          currentIndex === 0
            ? "bg-muted/40 text-muted-foreground/30 cursor-default"
            : "bg-muted/80 hover:bg-muted text-foreground cursor-pointer"
        }`}
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      {/* Right arrow */}
      <button
        type="button"
        onClick={goNext}
        disabled={currentIndex >= items.length - 1}
        className={`absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-11 h-11 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors z-10 touch-manipulation ${
          currentIndex >= items.length - 1
            ? "bg-muted/40 text-muted-foreground/30 cursor-default"
            : "bg-muted/80 hover:bg-muted text-foreground cursor-pointer"
        }`}
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Content */}
      <div className="px-4 sm:px-16 py-6 sm:py-12 w-full flex items-center justify-center">
        {current.outputType === "image" && current.url ? (
          <CachedImage
            src={current.url}
            alt={current.title}
            className="max-w-[90vw] sm:max-w-[80vw] max-h-[70vh] rounded-xl object-contain"
          />
        ) : current.outputType === "video" && current.url ? (
          <video
            key={currentIndex}
            src={current.url}
            controls
            autoPlay
            className="max-w-[90vw] sm:max-w-[80vw] max-h-[70vh] rounded-xl"
          />
        ) : current.outputType === "audio" && current.url ? (
          <GlassCard className="w-full max-w-md">
            <div className="flex flex-col items-center gap-4 py-4">
              <WaveformBars />
              <WaveformAudioPlayer key={currentIndex} url={current.url} variant="full" autoPlay className="w-full" />
            </div>
          </GlassCard>
        ) : current.text ? (
          <GlassCard className="max-w-2xl w-full max-h-[70vh] overflow-y-auto">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{current.text}</p>
          </GlassCard>
        ) : null}
      </div>
    </div>
  )
}
