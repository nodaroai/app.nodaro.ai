"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
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
  /** Media type — `"image"` (default) renders thumbnails via CachedImage
   *  (`<img>`). `"video"` renders a muted/playsInline `<video>` for any
   *  thumb whose url ISN'T an obvious image src — handles the case where
   *  the ffmpeg backend's `generateAndUploadThumbnail` returned null and
   *  the caller fell back to the raw video url. */
  readonly mediaType?: "image" | "video"
  /** Per-thumbnail delete affordance (hover-revealed red X on each tile).
   *  Omit to disable. Matches the legacy inline strip behavior — without
   *  it, removing non-active results becomes a two-click detour through
   *  the result overlay. */
  readonly onDelete?: (index: number) => void
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
/** URLs whose extension marks them as a video file. Used to decide
 *  whether to render `<video>` or `<img>` for a given thumb when the
 *  caller is a video-producing node. Conservative — anything not matching
 *  falls through to `<img>` via CachedImage (which renders a broken-image
 *  icon for non-images but keeps DOM structure consistent).
 *  Covers the same extensions enumerated by save-to-storage.ts +
 *  download-video.ts on the backend so the predicate doesn't drift. */
function looksLikeVideoUrl(url: string): boolean {
  const m = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i)
  if (!m) return false
  const ext = m[1].toLowerCase()
  return ext === "mp4" || ext === "mov" || ext === "webm" || ext === "m4v" || ext === "mkv" || ext === "avi" || ext === "flv"
}

/** Whether a URL is hosted on a domain we control (R2, our CDN) where
 *  CORS-credentialed requests are allowed. External hosts reject
 *  preflight with `crossOrigin="anonymous"` and the resource fails to
 *  load — same gate `CachedImage` uses internally. Inline here to avoid
 *  pulling in CachedImage's full module surface. */
function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin)
    const host = parsed.hostname
    return (
      host === window.location.hostname ||
      host.endsWith(".nodaro.ai") ||
      host.endsWith(".r2.cloudflarestorage.com") ||
      host.endsWith(".r2.dev") ||
      host === "cdn.nodaro.ai" ||
      host === "next.nodaro.ai" ||
      host === "app.nodaro.ai"
    )
  } catch {
    return false
  }
}

export function ResultsThumbnailsPanel<T extends { url: string; jobId?: string }>({
  results,
  activeIndex,
  onSelect,
  nodeSelected,
  thumbSize = 48,
  mediaType = "image",
  onDelete,
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
          const useVideoTile = mediaType === "video" && looksLikeVideoUrl(r.url)
          const tileClass = `w-full h-full object-cover rounded-lg cursor-pointer transition-all ${
            isActive ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
          }`
          const handleClick = (e: React.MouseEvent) => {
            e.stopPropagation()
            onSelect(absoluteIndex)
          }
          return (
            <div
              key={`${r.jobId ?? "result"}-${absoluteIndex}`}
              className="relative shrink-0 group/thumb"
              style={{ width: thumbSize, height: thumbSize }}
            >
              {useVideoTile ? (
                // iOS Safari intercepts taps on <video> without controls
                // to play/pause; React's synthetic onClick fires
                // unreliably as a result. Transparent overlay div above
                // the video captures the click cleanly. The video itself
                // sets pointer-events: none so it never sees the tap.
                // `crossOrigin` is gated on `isInternalUrl` because
                // external hosts (e.g. external preview URLs that flow
                // through pre-R2-mirror code paths) reject CORS-
                // credentialed requests — mirrors CachedImage's logic.
                <>
                  <video
                    src={r.url}
                    crossOrigin={isInternalUrl(r.url) ? "anonymous" : undefined}
                    className={tileClass}
                    style={{ pointerEvents: "none" }}
                    muted
                    playsInline
                    preload="metadata"
                  />
                  <button
                    type="button"
                    aria-label={`Switch to result ${absoluteIndex + 1}`}
                    className="absolute inset-0 cursor-pointer bg-transparent border-0 p-0"
                    onClick={handleClick}
                  />
                </>
              ) : (
                <CachedImage
                  src={r.url}
                  alt={`Result ${absoluteIndex + 1}`}
                  className={tileClass}
                  thumbnail
                  thumbnailWidth={96}
                  onClick={handleClick}
                />
              )}
              <span
                aria-hidden
                className={`absolute top-0.5 left-0.5 text-[9px] leading-none font-semibold px-1 py-0.5 rounded-sm tabular-nums shadow-sm pointer-events-none ${
                  isActive
                    ? "bg-[#ff0073] text-white"
                    : "bg-black/70 text-white/85"
                }`}
              >
                {absoluteIndex + 1}
              </span>
              {onDelete && (
                <button
                  type="button"
                  aria-label={`Delete result ${absoluteIndex + 1}`}
                  title="Delete this result"
                  className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(absoluteIndex)
                  }}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
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
