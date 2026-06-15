import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { ChevronLeft, ChevronRight, FileText } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { getOutputType } from "@/lib/presentation-utils"
import { isVideoUrl } from "@/lib/media-type"
import { GlassCard } from "../output-cards/shared"
import { WaveformBars } from "../input-cards/shared"
import type { WorkflowNode } from "@/types/nodes"
import type { ViewProps } from "./types"
import type { ChatRunSlotsApi } from "./chat-view"

interface FullscreenViewProps extends ViewProps {
  onBack: () => void
  /** When present, ↑/↓ navigate to the previous/next run. */
  runSlots?: ChatRunSlotsApi
}

type MediaType = "image" | "video" | "audio" | "text"

interface FsItem {
  nodeId: string
  kind: "input" | "output"
  title: string
  mediaType: MediaType
  url?: string
  text?: string
}

function mediaTypeFor(node: WorkflowNode, result: { url?: string; text?: string }): MediaType {
  const ot = getOutputType(node.type)
  if (ot === "image" || ot === "video" || ot === "audio") return ot
  if (result.url) return node.type === "upload-audio" ? "audio" : isVideoUrl(result.url) ? "video" : "image"
  return "text"
}

export function FullscreenView({
  orderedInputNodes,
  orderedOutputNodes,
  getResult,
  getCardTitle,
  onBack,
  runSlots,
}: FullscreenViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const touchStartRef = useRef<number | null>(null)

  // ←/→ navigate a single list of INPUTS then OUTPUTS.
  const items: FsItem[] = useMemo(() => {
    const build = (nodes: WorkflowNode[], kind: "input" | "output"): FsItem[] =>
      nodes
        .map((node): FsItem | null => {
          const result = getResult(node.id)
          if (!result.url && !result.text) return null
          return {
            nodeId: node.id,
            kind,
            title: getCardTitle(node),
            mediaType: mediaTypeFor(node, result),
            url: result.url,
            text: result.text,
          }
        })
        .filter((i): i is FsItem => i !== null)
    return [...build(orderedInputNodes, "input"), ...build(orderedOutputNodes, "output")]
  }, [orderedInputNodes, orderedOutputNodes, getResult, getCardTitle])

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, items.length - 1))
  }, [items.length])

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }, [])

  // ↑/↓ navigate to the previous/next run (fullscreen only).
  const runNav = useCallback(
    (dir: 1 | -1) => {
      const slots = runSlots?.slots
      if (!slots || slots.length === 0) return
      const idx = slots.findIndex((s) => s.id === runSlots?.activeSlotId)
      const base = idx >= 0 ? idx : 0
      let next = base + dir
      if (next < 0) next = slots.length - 1
      else if (next >= slots.length) next = 0
      runSlots?.handleSelectSlot(slots[next].id)
      setCurrentIndex(0)
    },
    [runSlots],
  )

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      switch (e.key) {
        case "ArrowRight": e.preventDefault(); goNext(); break
        case "ArrowLeft": e.preventDefault(); goPrev(); break
        case "ArrowDown": e.preventDefault(); runNav(1); break
        case "ArrowUp": e.preventDefault(); runNav(-1); break
        case "Escape": onBack(); break
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [goNext, goPrev, runNav, onBack])

  // Touch swipe (horizontal = item navigation)
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
        <p className="text-sm">Run the workflow to see inputs &amp; outputs</p>
      </div>
    )
  }

  const safeIndex = Math.min(currentIndex, items.length - 1)
  const current = items[safeIndex]
  const hasRunNav = !!runSlots && (runSlots.slots?.length ?? 0) > 1

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center relative select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Corner badge: Input / Output + node name */}
      <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
            current.kind === "input"
              ? "bg-sky-500/15 text-sky-500"
              : "bg-green-500/15 text-green-600"
          }`}
        >
          {current.kind}
        </span>
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider truncate max-w-[40vw]">{current.title}</span>
      </div>

      {/* Counter + run-nav hint */}
      <div className="absolute top-4 right-4 flex items-center gap-2 text-[11px] text-muted-foreground/60 z-10">
        <span>{safeIndex + 1} / {items.length}</span>
        {hasRunNav && <span className="hidden sm:inline">↑↓ runs · ←→ items</span>}
      </div>

      {/* Left arrow */}
      <button
        type="button"
        onClick={goPrev}
        disabled={safeIndex === 0}
        className={`absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-11 h-11 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors z-10 touch-manipulation ${
          safeIndex === 0
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
        disabled={safeIndex >= items.length - 1}
        className={`absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-11 h-11 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors z-10 touch-manipulation ${
          safeIndex >= items.length - 1
            ? "bg-muted/40 text-muted-foreground/30 cursor-default"
            : "bg-muted/80 hover:bg-muted text-foreground cursor-pointer"
        }`}
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Content */}
      <div className="px-4 sm:px-16 py-6 sm:py-12 w-full flex items-center justify-center">
        {current.mediaType === "image" && current.url ? (
          <CachedImage
            src={current.url}
            alt={current.title}
            className="max-w-[90vw] sm:max-w-[80vw] max-h-[70vh] rounded-xl object-contain"
          />
        ) : current.mediaType === "video" && current.url ? (
          <video
            key={`${current.nodeId}:${safeIndex}`}
            src={current.url}
            controls
            autoPlay
            className="max-w-[90vw] sm:max-w-[80vw] max-h-[70vh] rounded-xl"
          />
        ) : current.mediaType === "audio" && current.url ? (
          <GlassCard className="w-full max-w-md">
            <div className="flex flex-col items-center gap-4 py-4">
              <WaveformBars />
              <WaveformAudioPlayer key={`${current.nodeId}:${safeIndex}`} url={current.url} variant="full" autoPlay className="w-full" />
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
