import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { ChevronLeft, ChevronRight, FileText, X } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { getOutputType } from "@/lib/presentation-utils"
import { isAudioUrl, isVideoUrl } from "@/lib/media-type"
import { GlassCard } from "../output-cards/shared"
import { WaveformBars } from "../input-cards/shared"
import type { WorkflowNode } from "@/types/nodes"
import type { ViewProps } from "./types"

interface FullscreenViewProps extends ViewProps {
  onBack: () => void
  /** Render as a fixed-inset modal overlay (chat result viewer) instead of an inline pane. */
  asOverlay?: boolean
  /** Override item media/text resolution — used to show a FROZEN run slot's result. */
  resolveResult?: (nodeId: string) => { url?: string; text?: string }
  /** Seed the viewer to a specific node's position when opened / when it changes. */
  initialNodeId?: string
  /** Override ↑/↓ run navigation (chat threads its own ordered run list). */
  onRunChange?: (dir: 1 | -1) => void
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
  if (result.url) return isAudioUrl(result.url) ? "audio" : isVideoUrl(result.url) ? "video" : "image"
  return "text"
}

export function FullscreenView({
  orderedInputNodes,
  orderedOutputNodes,
  getResult,
  getCardTitle,
  onBack,
  runSlots,
  asOverlay,
  resolveResult,
  initialNodeId,
  onRunChange,
}: FullscreenViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const touchStartRef = useRef<number | null>(null)

  // ←/→ navigate a single list of INPUTS then OUTPUTS. `resolveResult` (when
  // provided) overrides `getResult` so the viewer can show a FROZEN run slot.
  const items: FsItem[] = useMemo(() => {
    const resolve = resolveResult ?? getResult
    const build = (nodes: WorkflowNode[], kind: "input" | "output"): FsItem[] =>
      nodes
        .map((node): FsItem | null => {
          const result = resolve(node.id)
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
  }, [orderedInputNodes, orderedOutputNodes, resolveResult, getResult, getCardTitle])

  // Seed to the requested node's CURRENT position. Keyed on the resolved index
  // (not the raw id) so it re-points when a run switch moves the node within
  // `items`, while staying constant during in-viewer ←/→ (which changes neither
  // `items` nor `initialNodeId`, so this effect won't fire and reset position).
  const seededIndex = useMemo(
    () => (initialNodeId ? items.findIndex((it) => it.nodeId === initialNodeId) : -1),
    [initialNodeId, items],
  )
  useEffect(() => {
    if (seededIndex >= 0) setCurrentIndex(seededIndex)
  }, [seededIndex])

  // `currentIndex` can momentarily exceed range when `items` shrinks (e.g. a run
  // switch); `safeIndex` is the single source of truth for the current position.
  const safeIndex = items.length > 0 ? Math.min(currentIndex, items.length - 1) : 0

  const goNext = useCallback(() => {
    setCurrentIndex(Math.min(safeIndex + 1, items.length - 1))
  }, [safeIndex, items.length])

  const goPrev = useCallback(() => {
    setCurrentIndex(Math.max(safeIndex - 1, 0))
  }, [safeIndex])

  // ↑/↓ navigate to the previous/next run. Chat threads its own ordered run
  // list via `onRunChange` (keeps the same node position); otherwise page the
  // run slots (fullscreen viewMode).
  const runNav = useCallback(
    (dir: 1 | -1) => {
      if (onRunChange) {
        onRunChange(dir)
        return
      }
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
    [onRunChange, runSlots],
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

  const rootClass = asOverlay
    ? "fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm select-none"
    : "flex-1 flex flex-col items-center justify-center relative select-none"
  const closeButton = asOverlay ? (
    <button
      type="button"
      onClick={onBack}
      aria-label="Close"
      className="absolute top-4 right-14 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-muted/80 text-foreground hover:bg-muted"
    >
      <X className="h-5 w-5" />
    </button>
  ) : null

  if (items.length === 0) {
    return (
      <div className={`${rootClass} text-muted-foreground gap-3 p-6`}>
        {closeButton}
        <FileText className="w-12 h-12 text-muted-foreground/30" />
        <p className="text-sm">Run the workflow to see inputs &amp; outputs</p>
      </div>
    )
  }

  const current = items[safeIndex]
  const hasRunNav = !!onRunChange || (!!runSlots && (runSlots.slots?.length ?? 0) > 1)

  return (
    <div
      className={rootClass}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {closeButton}
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
