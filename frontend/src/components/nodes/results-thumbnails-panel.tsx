"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"

interface ResultsThumbnailsPanelProps<T extends { url: string; jobId?: string }> {
  readonly results: ReadonlyArray<T>
  readonly activeIndex: number
  readonly onSelect: (index: number) => void
  /** When the parent node is selected, ArrowLeft / ArrowRight on the
   *  document advance / retreat `activeIndex`. The hosting node component
   *  owns selection state via React Flow's `selected` prop — pass it in
   *  so the keyboard handler doesn't fire while the user is typing in
   *  an input elsewhere on the canvas. */
  readonly nodeSelected: boolean
  /** Thumbnail edge length in pixels (square). Default 48. Larger sizes
   *  fit fewer items per page. */
  readonly thumbSize?: number
}

const GAP_PX = 6
const PAGE_BUTTON_PX = 28
const PANEL_PAD_X = 12
const PANEL_PAD_RIGHT_EXTRA = 4

/**
 * Multi-result thumbnail strip for media-producing nodes (Generate Image,
 * Image-to-Video, etc.). Renders the result list as a horizontal grid of
 * numbered thumbnails. Three features beyond the bare thumbnail list:
 *
 * 1. **Numbered badge** at the top-left of each thumbnail so the user
 *    can quickly identify "the 7th result" without counting.
 * 2. **Paging by node width.** Measures its container with a
 *    ResizeObserver and shows N thumbnails per page where N is computed
 *    from available width. Beyond N, prev/next chevrons step through
 *    pages. The active result's page is always visible.
 * 3. **Keyboard arrow navigation.** When the parent node is selected,
 *    ArrowLeft / ArrowRight cycle through results (clamped at the
 *    boundaries). The active result's page auto-scrolls to stay in
 *    view as the index moves between pages.
 */
export function ResultsThumbnailsPanel<T extends { url: string; jobId?: string }>({
  results,
  activeIndex,
  onSelect,
  nodeSelected,
  thumbSize = 48,
}: ResultsThumbnailsPanelProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number>(0)

  // Measure once on mount and on every resize so the items-per-page
  // recomputes when the user resizes the node.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const setW = () => setContainerWidth(el.clientWidth)
    setW()
    const ro = new ResizeObserver(setW)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Items per page calculation. We RESERVE space for prev/next page
  // buttons up-front (even when not visible) so the thumb-strip width
  // doesn't jump as the user pages through. If results fit on a single
  // page, the chevrons collapse and we use the freed space — recomputed
  // on a second pass.
  const { itemsPerPage, needsPaging } = useMemo(() => {
    if (containerWidth <= 0) return { itemsPerPage: results.length, needsPaging: false }
    const reservedForButtons = PAGE_BUTTON_PX * 2 + GAP_PX * 2
    const usableForButtons = Math.max(0, containerWidth - PANEL_PAD_X - PANEL_PAD_RIGHT_EXTRA - reservedForButtons)
    const usableNoButtons = Math.max(0, containerWidth - PANEL_PAD_X - PANEL_PAD_RIGHT_EXTRA)
    const fitsAll = Math.max(1, Math.floor((usableNoButtons + GAP_PX) / (thumbSize + GAP_PX)))
    if (fitsAll >= results.length) {
      return { itemsPerPage: results.length, needsPaging: false }
    }
    const withButtons = Math.max(1, Math.floor((usableForButtons + GAP_PX) / (thumbSize + GAP_PX)))
    return { itemsPerPage: withButtons, needsPaging: true }
  }, [containerWidth, results.length, thumbSize])

  // Active result's page is the page we always want visible. The user
  // can press the chevrons to manually browse to OTHER pages without
  // changing `activeIndex` — `pageIndex` is local state, seeded from the
  // active page but free to drift while the panel is open.
  const activePage = Math.floor(activeIndex / Math.max(1, itemsPerPage))
  const [pageIndex, setPageIndex] = useState(activePage)
  // Whenever `activeIndex` jumps to a different page (via keyboard nav
  // or external code), follow it.
  useEffect(() => {
    setPageIndex(activePage)
  }, [activePage])

  const totalPages = Math.max(1, Math.ceil(results.length / Math.max(1, itemsPerPage)))
  const safePageIndex = Math.min(pageIndex, totalPages - 1)
  const pageStart = safePageIndex * itemsPerPage
  const visible = results.slice(pageStart, pageStart + itemsPerPage)

  // Keyboard arrow navigation. Only when the parent node is selected and
  // focus isn't trapped in an input/textarea/contenteditable elsewhere.
  //
  // Registered on `window` with capture-phase + `stopImmediatePropagation`.
  // The `window` target is CRITICAL — workflow-canvas.tsx registers its
  // own capture-phase keydown on `document` (handles neighbor-navigation
  // when the settings panel is open, plus React Flow's built-in arrow-
  // nudge). Capture phase walks window → document → target, so a
  // window-capture listener fires BEFORE any document-capture listener.
  // That + stopImmediatePropagation is what stops the canvas handler
  // from also moving / re-selecting nodes while the user is browsing
  // results.
  useEffect(() => {
    if (!nodeSelected || results.length <= 1) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      // Skip when typing — let inputs receive arrow keys natively.
      const target = e.target as HTMLElement | null
      const editable = !!target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      )
      if (editable) return
      // Skip when a modal overlay is open — mirror the workflow-canvas
      // gate so we don't fight with modal arrow handlers.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      if (e.key === "ArrowLeft" && activeIndex > 0) onSelect(activeIndex - 1)
      else if (e.key === "ArrowRight" && activeIndex < results.length - 1) onSelect(activeIndex + 1)
    }
    window.addEventListener("keydown", handler, { capture: true })
    return () => window.removeEventListener("keydown", handler, { capture: true })
  }, [nodeSelected, activeIndex, results.length, onSelect])

  const handlePrev = useCallback(() => {
    setPageIndex((p) => Math.max(0, p - 1))
  }, [])
  const handleNext = useCallback(() => {
    setPageIndex((p) => Math.min(totalPages - 1, p + 1))
  }, [totalPages])

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-1.5 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10"
    >
      {needsPaging && (
        <button
          type="button"
          aria-label="Previous page"
          title="Previous page"
          disabled={safePageIndex === 0}
          className="flex items-center justify-center rounded-md text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-default transition-colors shrink-0"
          style={{ width: PAGE_BUTTON_PX, height: PAGE_BUTTON_PX }}
          onClick={(e) => {
            e.stopPropagation()
            handlePrev()
          }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      <div className="flex items-center" style={{ gap: GAP_PX }}>
        {visible.map((r, i) => {
          const absoluteIndex = pageStart + i
          const isActive = absoluteIndex === activeIndex
          return (
            <div
              key={`${r.jobId ?? "result"}-${absoluteIndex}`}
              className="relative shrink-0"
              style={{ width: thumbSize, height: thumbSize }}
            >
              <CachedImage
                src={r.url}
                alt={`Result ${absoluteIndex + 1}`}
                className={`w-full h-full object-cover rounded-lg cursor-pointer transition-all ${
                  isActive ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                }`}
                thumbnail
                thumbnailWidth={96}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(absoluteIndex)
                }}
              />
              <span
                aria-hidden
                className={`absolute top-0.5 left-0.5 text-[9px] leading-none font-semibold px-1 py-0.5 rounded-sm tabular-nums shadow-sm ${
                  isActive
                    ? "bg-[#ff0073] text-white"
                    : "bg-black/70 text-white/85"
                }`}
              >
                {absoluteIndex + 1}
              </span>
            </div>
          )
        })}
      </div>
      {needsPaging && (
        <button
          type="button"
          aria-label="Next page"
          title="Next page"
          disabled={safePageIndex >= totalPages - 1}
          className="flex items-center justify-center rounded-md text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-default transition-colors shrink-0"
          style={{ width: PAGE_BUTTON_PX, height: PAGE_BUTTON_PX }}
          onClick={(e) => {
            e.stopPropagation()
            handleNext()
          }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
