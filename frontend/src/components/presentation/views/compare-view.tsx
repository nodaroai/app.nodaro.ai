import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { ArrowLeftRight, Maximize2, X } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getOutputType, type OutputType } from "@/lib/presentation-utils"
import { isVideoUrl, isImageUrl, isAudioUrl } from "@/lib/media-type"
import { GlassCard } from "../output-cards/shared"
import type { ViewProps } from "./types"

/** Resolve output type from node type, falling back to URL-based detection for data types (e.g. loop nodes) */
function resolveOutputType(nodeType: string | undefined, url?: string): OutputType {
  const t = getOutputType(nodeType)
  if (t !== "data" || !url) return t
  if (isImageUrl(url)) return "image"
  if (isVideoUrl(url)) return "video"
  if (isAudioUrl(url)) return "audio"
  return t
}

interface CompareItem {
  id: string
  title: string
  group: "Inputs" | "Outputs"
  outputType: OutputType
  url?: string
  text?: string
}

interface CompareViewProps extends ViewProps {
  initialLeft?: string
  initialRight?: string
  onSelectionChange?: (left: string, right: string) => void
}

export function CompareView({
  orderedInputNodes,
  orderedOutputNodes,
  getResult,
  getCardTitle,
  initialLeft,
  initialRight,
  onSelectionChange,
}: CompareViewProps) {
  const [leftId, setLeftId] = useState<string>(initialLeft ?? "")
  const [rightId, setRightId] = useState<string>(initialRight ?? "")
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Sync when defaults change (e.g. settings loaded after mount)
  useEffect(() => {
    if (initialLeft && !leftId) setLeftId(initialLeft)
  }, [initialLeft]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialRight && !rightId) setRightId(initialRight)
  }, [initialRight]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist selection changes — use refs to avoid stale closures
  const leftIdRef = useRef(leftId)
  const rightIdRef = useRef(rightId)
  leftIdRef.current = leftId
  rightIdRef.current = rightId

  const handleLeftChange = useCallback((id: string) => {
    setLeftId(id)
    onSelectionChange?.(id, rightIdRef.current)
  }, [onSelectionChange])

  const handleRightChange = useCallback((id: string) => {
    setRightId(id)
    onSelectionChange?.(leftIdRef.current, id)
  }, [onSelectionChange])

  const handleSwap = useCallback(() => {
    const prevLeft = leftIdRef.current
    const prevRight = rightIdRef.current
    setLeftId(prevRight)
    setRightId(prevLeft)
    onSelectionChange?.(prevRight, prevLeft)
  }, [onSelectionChange])

  // ESC exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false)
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [isFullscreen])

  const items: CompareItem[] = useMemo(() => {
    const result: CompareItem[] = []
    for (const node of orderedInputNodes) {
      const r = getResult(node.id)
      if (r.url || r.text) {
        result.push({
          id: node.id,
          title: getCardTitle(node),
          group: "Inputs",
          outputType: resolveOutputType(node.type, r.url),
          url: r.url,
          text: r.text,
        })
      }
    }
    for (const node of orderedOutputNodes) {
      const r = getResult(node.id)
      if (r.url || r.text) {
        result.push({
          id: node.id,
          title: getCardTitle(node),
          group: "Outputs",
          outputType: getOutputType(node.type),
          url: r.url,
          text: r.text,
        })
      }
    }
    return result
  }, [orderedInputNodes, orderedOutputNodes, getResult, getCardTitle])

  const leftItem = items.find((i) => i.id === leftId)
  const rightItem = items.find((i) => i.id === rightId)

  const groupedItems = useMemo(() => ({
    inputItems: items.filter((i) => i.group === "Inputs"),
    outputItems: items.filter((i) => i.group === "Outputs"),
  }), [items])

  // Auto-select first input + first output when nothing is selected
  const itemIds = items.map((i) => i.id).join(",")
  useEffect(() => {
    if (leftId || rightId) return
    if (items.length === 0) return
    const inputItems = items.filter((i) => i.group === "Inputs")
    const outputItems = items.filter((i) => i.group === "Outputs")
    if (inputItems.length > 0 && outputItems.length > 0) {
      setLeftId(inputItems[0].id)
      setRightId(outputItems[0].id)
      onSelectionChange?.(inputItems[0].id, outputItems[0].id)
    } else if (items.length >= 2) {
      setLeftId(items[0].id)
      setRightId(items[1].id)
      onSelectionChange?.(items[0].id, items[1].id)
    }
  }, [itemIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const bothVisual =
    leftItem &&
    rightItem &&
    (leftItem.outputType === "image" || leftItem.outputType === "video") &&
    (rightItem.outputType === "image" || rightItem.outputType === "video")

  const bothText = leftItem?.text && rightItem?.text && !leftItem.url && !rightItem.url
  const bothAudio =
    leftItem?.outputType === "audio" &&
    rightItem?.outputType === "audio" &&
    leftItem.url &&
    rightItem.url

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Selectors */}
        <div className="flex items-end gap-2 mb-4">
          <div className="flex-1">
            <ItemSelect
              label="Left"
              value={leftId}
              onChange={handleLeftChange}
              groups={groupedItems}
            />
          </div>
          <button
            type="button"
            onClick={handleSwap}
            title="Swap selections"
            className="shrink-0 mb-0.5 w-9 h-9 rounded-lg border border-border bg-card hover:bg-accent/50 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>
          <div className="flex-1">
            <ItemSelect
              label="Right"
              value={rightId}
              onChange={handleRightChange}
              groups={groupedItems}
            />
          </div>
        </div>

        {/* Comparison area */}
        {!leftItem || !rightItem ? (
          <div className="text-sm text-muted-foreground text-center py-16">
            Select two items to compare
          </div>
        ) : bothVisual ? (
          <div className="relative">
            <VisualSlider leftItem={leftItem} rightItem={rightItem} />
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              className="absolute bottom-3 right-3 z-20 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
              title="Fullscreen compare"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        ) : bothText ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <GlassCard>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-2">
                {leftItem.title}
              </span>
              <div className="text-sm text-foreground whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed">
                {leftItem.text}
              </div>
            </GlassCard>
            <GlassCard>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-2">
                {rightItem.title}
              </span>
              <div className="text-sm text-foreground whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed">
                {rightItem.text}
              </div>
            </GlassCard>
          </div>
        ) : bothAudio ? (
          <div className="space-y-4 max-w-2xl mx-auto">
            <GlassCard>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-2">
                {leftItem.title}
              </span>
              {leftItem.url && (
                <WaveformAudioPlayer url={leftItem.url} variant="compact" className="w-full" />
              )}
            </GlassCard>
            <GlassCard>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-2">
                {rightItem.title}
              </span>
              {rightItem.url && (
                <WaveformAudioPlayer url={rightItem.url} variant="compact" className="w-full" />
              )}
            </GlassCard>
          </div>
        ) : (
          /* Mixed types — side by side */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <CompareItemDisplay item={leftItem} />
            <CompareItemDisplay item={rightItem} />
          </div>
        )}
      </div>

      {/* Fullscreen overlay */}
      {isFullscreen && leftItem && rightItem && bothVisual && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
          <button
            type="button"
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <VisualSlider leftItem={leftItem} rightItem={rightItem} fullscreen />
        </div>
      )}
    </div>
  )
}

function ItemSelect({
  label,
  value,
  onChange,
  groups,
}: {
  label: string
  value: string
  onChange: (id: string) => void
  groups: { inputItems: CompareItem[]; outputItems: CompareItem[] }
}) {
  return (
    <div>
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select item..." />
        </SelectTrigger>
        <SelectContent>
          {groups.inputItems.length > 0 && (
            <SelectGroup>
              <SelectLabel>Inputs</SelectLabel>
              {groups.inputItems.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {groups.outputItems.length > 0 && (
            <SelectGroup>
              <SelectLabel>Outputs</SelectLabel>
              {groups.outputItems.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  )
}

function VisualSlider({ leftItem, rightItem, fullscreen }: { leftItem: CompareItem; rightItem: CompareItem; fullscreen?: boolean }) {
  const [position, setPosition] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  // Cache the bounding rect at drag-start to avoid layout reads on every move.
  const dragRectRef = useRef<DOMRect | null>(null)
  const rafIdRef = useRef<number | null>(null)

  // Clean up drag listeners and pending RAF on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [])

  // pendingClientXRef holds the latest clientX so the RAF always applies the
  // most recent pointer position (not the one that first triggered the frame).
  const pendingClientXRef = useRef<number | null>(null)

  const updatePosition = useCallback((clientX: number) => {
    if (!dragRectRef.current) return
    pendingClientXRef.current = clientX
    if (rafIdRef.current !== null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      const latestX = pendingClientXRef.current
      const rect = dragRectRef.current
      if (latestX === null || !rect) return
      pendingClientXRef.current = null
      const pct = ((latestX - rect.left) / rect.width) * 100
      setPosition(Math.max(2, Math.min(98, pct)))
    })
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    // Capture rect once at drag-start — container won't move during drag.
    dragRectRef.current = containerRef.current?.getBoundingClientRect() ?? null

    const handleMove = (ev: MouseEvent) => {
      if (isDragging.current) updatePosition(ev.clientX)
    }
    const handleUp = () => {
      isDragging.current = false
      dragRectRef.current = null
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      document.removeEventListener("mousemove", handleMove)
      document.removeEventListener("mouseup", handleUp)
      cleanupRef.current = null
    }

    document.addEventListener("mousemove", handleMove)
    document.addEventListener("mouseup", handleUp)
    cleanupRef.current = handleUp
  }, [updatePosition])

  const handleTouchStart = useCallback(() => {
    // Capture rect once at touch-start so handleTouchMove doesn't re-read layout.
    dragRectRef.current = containerRef.current?.getBoundingClientRect() ?? null
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    updatePosition(e.touches[0].clientX)
  }, [updatePosition])

  const renderMedia = (item: CompareItem, className: string) => {
    if (item.outputType === "image" && item.url) {
      return <CachedImage src={item.url} alt={item.title} className={className} />
    }
    if (item.outputType === "video" && item.url) {
      return <video src={item.url} className={className} muted playsInline loop autoPlay />
    }
    return null
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden select-none ${
        fullscreen
          ? "h-full max-h-screen"
          : "rounded-xl bg-muted/30"
      }`}
      style={fullscreen ? undefined : { aspectRatio: "16 / 9" }}
    >
      {/* Left (bottom layer, full) */}
      <div className="absolute inset-0">
        {renderMedia(leftItem, "w-full h-full object-contain")}
      </div>

      {/* Right (clipped) */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 0 0 ${position}%)` }}
      >
        {renderMedia(rightItem, "w-full h-full object-contain")}
      </div>

      {/* Divider line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white/80 z-10"
        style={{ left: `${position}%` }}
      />

      {/* Drag handle */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 w-8 h-8 rounded-full bg-white border-2 border-[#ff0073] cursor-ew-resize flex items-center justify-center shadow-lg"
        style={{ left: `${position}%` }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        <div className="flex gap-0.5">
          <div className="w-0.5 h-3 bg-[#ff0073]/60 rounded-full" />
          <div className="w-0.5 h-3 bg-[#ff0073]/60 rounded-full" />
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-2 left-2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full z-10">
        {leftItem.title}
      </div>
      <div className="absolute top-2 right-2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full z-10">
        {rightItem.title}
      </div>
    </div>
  )
}

function CompareItemDisplay({ item }: { item: CompareItem }) {
  return (
    <GlassCard>
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-2">
        {item.title}
      </span>
      {item.outputType === "image" && item.url ? (
        <CachedImage src={item.url} alt={item.title} className="w-full rounded-lg" thumbnail thumbnailWidth={480} />
      ) : item.outputType === "video" && item.url ? (
        <video src={item.url} controls className="w-full rounded-lg" />
      ) : item.outputType === "audio" && item.url ? (
        <WaveformAudioPlayer url={item.url} variant="compact" className="w-full" />
      ) : item.text ? (
        <div className="text-sm text-foreground whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
          {item.text}
        </div>
      ) : (
        <div className="h-32 flex items-center justify-center text-muted-foreground/40 text-xs">No content</div>
      )}
    </GlassCard>
  )
}
