import { useEffect, useMemo, useRef, useState } from "react"
import {
  useVirtualizer,
  useWindowVirtualizer,
  type VirtualItem,
} from "@tanstack/react-virtual"

/**
 * Row-virtualization for uniform fixed-height tile grids (gallery, library,
 * media-library modal). Keeps the FULL flat items array in React Query memory
 * (no maxPages, no getPreviousPageParam) and virtualizes ONLY the DOM: rows
 * outside the viewport+overscan are unmounted, so deep-scrolled infinite lists
 * no longer grow the DOM without bound.
 *
 * Lightbox/preview code keeps indexing into the flat array unchanged — windowing
 * never reorders or drops items, it only controls which rows are mounted.
 */

/**
 * Breakpoint → column count. `min` is a viewport min-width in px and MUST mirror
 * the file's Tailwind `grid-cols-*` / `sm:` / `md:` / `lg:` classes exactly.
 * Tailwind's responsive grid is driven by VIEWPORT media queries (not container
 * width), so the active column count is derived from `window.innerWidth` against
 * these same breakpoints — a single source of truth shared by the hook's
 * rowCount math and the render's `gridTemplateColumns`. A mismatch here would
 * overlap/gap tiles, so the consumer derives both from the same array.
 */
export interface GridBreakpoint {
  readonly min: number
  readonly cols: number
}

export interface UseVirtualGridOptions {
  /** Total number of items across ALL loaded pages (flat array length). */
  readonly itemCount: number
  /** Viewport breakpoint → columns, ascending by `min`. */
  readonly breakpoints: readonly GridBreakpoint[]
  /**
   * Fallback row height in px (tile height + info section), used before the grid
   * has been measured and in non-layout environments (jsdom tests).
   */
  readonly estimateRowHeight: number
  /**
   * When set, the tile thumbnail is square (`aspect-square`) and the row height
   * is computed from the measured column width: `tileWidth + extraRowHeight`.
   * Leave undefined for fixed-height tiles (e.g. library `h-32`).
   */
  readonly squareTiles?: boolean
  /**
   * Extra px below a square thumbnail (info/caption section). Added to the
   * measured tile width to get the row height. Only used with `squareTiles`.
   */
  readonly extraRowHeight?: number
  /** Grid gap in px (used for both the virtualizer `gap` and the row template). */
  readonly gap: number
  /**
   * Explicit scroll container for element-scrolled grids (e.g. the media-library
   * modal's inner `overflow-y-auto`). When omitted, the hook auto-detects the
   * scroll parent: it walks up from the grid element to the nearest scrollable
   * ancestor and virtualizes against that (e.g. the dashboard's
   * `<main className="overflow-auto">` for the embedded `/_gallery` + `/my-files`
   * routes); if there is no scrollable ancestor it falls back to the window
   * (the standalone `/gallery` route). This keeps a single page component correct
   * whether it renders window-scrolled or inside an inner scroll container.
   */
  readonly scrollElementRef?: React.RefObject<HTMLElement | null>
  /** Rows to render above/below the viewport. */
  readonly overscan?: number
  /** Infinite-load wiring from the page's `useInfiniteQuery`. */
  readonly fetchNextPage: () => void
  readonly hasNextPage: boolean
  readonly isFetchingNextPage: boolean
}

export interface UseVirtualGrid {
  /** Attach to the grid container `div` (height = totalSize, position relative). */
  readonly gridRef: React.RefObject<HTMLDivElement | null>
  /** Visible (+overscan) virtual rows from `getVirtualItems()`. */
  readonly virtualRows: VirtualItem[]
  /** Total scrollable height of all rows in px (the container's height). */
  readonly totalSize: number
  /** Current column count for this viewport width. */
  readonly columns: number
  /** Offset (px) of the grid from the scroll origin — subtract from row.start. */
  readonly scrollMargin: number
  /** `gridTemplateColumns` value derived from the same breakpoint array. */
  readonly gridTemplateColumns: string
}

/** Resolve the active column count for a viewport width against the breakpoints. */
export function columnsForWidth(
  width: number,
  breakpoints: readonly GridBreakpoint[],
): number {
  let cols = breakpoints[0]?.cols ?? 1
  for (const bp of breakpoints) {
    if (width >= bp.min) cols = bp.cols
  }
  return cols
}

function readViewportWidth(): number {
  if (typeof window === "undefined") return 0
  return window.innerWidth
}

/**
 * Walk up from `el` to the nearest vertically-scrollable ancestor. Returns null
 * when the page scrolls on the window (no scrollable ancestor) — the caller then
 * uses the window virtualizer. Used to support both standalone (window-scrolled)
 * and embedded (inner `<main className="overflow-auto">`) renders of the same
 * grid without the caller knowing its routing context.
 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  if (typeof window === "undefined") return null
  let node = el?.parentElement ?? null
  while (node) {
    const style = window.getComputedStyle(node)
    const overflowY = style.overflowY
    const scrollable =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight
    if (scrollable) return node
    node = node.parentElement
  }
  return null
}

export function useVirtualGrid({
  itemCount,
  breakpoints,
  estimateRowHeight,
  squareTiles,
  extraRowHeight = 0,
  gap,
  scrollElementRef,
  overscan = 3,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
}: UseVirtualGridOptions): UseVirtualGrid {
  const gridRef = useRef<HTMLDivElement | null>(null)

  // Resolve the scroll context. An explicit ref always wins (modal). Otherwise
  // auto-detect the nearest scrollable ancestor on mount: an inner scroll
  // container (embedded `/_gallery`, `/my-files`) → element virtualizer; none
  // (standalone `/gallery`) → window virtualizer. Detected once the grid mounts.
  const [detectedScrollParent, setDetectedScrollParent] = useState<HTMLElement | null>(null)
  const [scrollResolved, setScrollResolved] = useState(false)
  useEffect(() => {
    if (scrollElementRef) return
    setDetectedScrollParent(findScrollParent(gridRef.current))
    setScrollResolved(true)
  }, [scrollElementRef])

  // Window mode = no explicit ref AND no detected scrollable ancestor.
  const isWindow = !scrollElementRef && !detectedScrollParent

  // Don't enable EITHER virtualizer until the scroll context is resolved (for
  // the auto-detect path) so we never briefly mount the wrong one. An explicit
  // ref needs no detection step.
  const ready = scrollElementRef != null || scrollResolved

  // Column count is derived from the viewport width (Tailwind responsive grids
  // are viewport-media-query driven), recomputed on resize.
  const [viewportWidth, setViewportWidth] = useState<number>(readViewportWidth)
  useEffect(() => {
    if (typeof window === "undefined") return
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener("resize", onResize)
    // Sync once on mount in case width changed between render and effect.
    onResize()
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const columns = useMemo(
    () => columnsForWidth(viewportWidth, breakpoints),
    [viewportWidth, breakpoints],
  )
  const gridTemplateColumns = useMemo(
    () => `repeat(${columns}, minmax(0, 1fr))`,
    [columns],
  )

  const rowCount = columns > 0 ? Math.ceil(itemCount / columns) : 0

  // Measure the grid's content width so square-tile rows get an accurate height
  // (aspect-square row height ≈ column width). Falls back to estimateRowHeight
  // before the first measurement (and in jsdom, which has no layout).
  const [gridWidth, setGridWidth] = useState(0)
  useEffect(() => {
    const el = gridRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setGridWidth((prev) => (prev !== w ? w : prev))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rowHeight = useMemo(() => {
    if (!squareTiles || gridWidth <= 0 || columns <= 0) return estimateRowHeight
    const tileWidth = (gridWidth - gap * (columns - 1)) / columns
    return Math.round(tileWidth + extraRowHeight)
  }, [squareTiles, gridWidth, columns, gap, extraRowHeight, estimateRowHeight])

  // The grid sits below a tall header (gallery hero+tabs) inside its scroll
  // origin, so row offsets must be measured relative to the grid, not the
  // scroll origin's top. `scrollMargin` captures the grid's offset within the
  // scroll origin (the document for window mode, or the scroll element for
  // inner-scroll mode). virtual-core adds it as the base for every row's
  // `start`, and the render subtracts it again to position rows grid-relative.
  // Recomputed on resize and whenever the scroll context / layout changes.
  const [scrollMargin, setScrollMargin] = useState(0)
  useEffect(() => {
    if (!ready) return
    const update = () => {
      const el = gridRef.current
      if (!el) return
      const gridTop = el.getBoundingClientRect().top
      const scrollEl = scrollElementRef?.current ?? detectedScrollParent
      const top = scrollEl
        ? gridTop - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
        : gridTop + window.scrollY
      setScrollMargin((prev) => (prev !== top ? top : prev))
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
    // viewportWidth/itemCount change the header/layout height → recompute offset.
  }, [ready, scrollElementRef, detectedScrollParent, viewportWidth, itemCount])

  const commonOptions = {
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan,
    gap,
  }

  const windowVirtualizer = useWindowVirtualizer({
    ...commonOptions,
    scrollMargin,
    enabled: ready && isWindow,
  })

  const elementVirtualizer = useVirtualizer({
    ...commonOptions,
    getScrollElement: () => scrollElementRef?.current ?? detectedScrollParent,
    scrollMargin,
    enabled: ready && !isWindow,
  })

  const virtualizer = isWindow ? windowVirtualizer : elementVirtualizer

  // Re-measure when the estimated row height changes (column count / grid width
  // shift) so cached row offsets don't keep a stale height.
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowHeight])

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  // Infinite-load: fetch the next page when the last rendered row reaches the
  // penultimate row. Replaces the IntersectionObserver sentinel (which never
  // mounts once the grid is windowed). Guarded so it can't double-fire while a
  // fetch is already in flight.
  const lastRowIndex = virtualRows.length > 0
    ? virtualRows[virtualRows.length - 1].index
    : -1
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return
    if (rowCount === 0) return
    if (lastRowIndex >= rowCount - 2) {
      fetchNextPage()
    }
  }, [lastRowIndex, rowCount, hasNextPage, isFetchingNextPage, fetchNextPage])

  return {
    gridRef,
    virtualRows,
    totalSize,
    columns,
    scrollMargin,
    gridTemplateColumns,
  }
}

/**
 * Slice the flat items array for a virtual row, preserving each item's ORIGINAL
 * flat index. Consumers MUST pass the returned `index` to each card so the
 * `CachedImage` `index < 10` priority heuristic and lightbox index mapping stay
 * correct (do NOT reset index per row).
 */
export function rowItems<T>(
  items: readonly T[],
  rowIndex: number,
  columns: number,
): ReadonlyArray<{ readonly item: T; readonly index: number }> {
  const start = rowIndex * columns
  const end = Math.min(start + columns, items.length)
  const out: { item: T; index: number }[] = []
  for (let i = start; i < end; i++) {
    out.push({ item: items[i], index: i })
  }
  return out
}

/** Shared breakpoint presets matching each grid's Tailwind classes. */
export const GRID_BREAKPOINTS = {
  /** gallery: grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 */
  gallery: [
    { min: 0, cols: 2 },
    { min: 640, cols: 3 },
    { min: 768, cols: 4 },
    { min: 1024, cols: 5 },
  ],
  /** library "My Files": grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 */
  library: [
    { min: 0, cols: 1 },
    { min: 640, cols: 2 },
    { min: 1024, cols: 3 },
  ],
  /** media-library modal: grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 */
  mediaLibrary: [
    { min: 0, cols: 2 },
    { min: 640, cols: 3 },
    { min: 768, cols: 4 },
    { min: 1024, cols: 5 },
  ],
} as const satisfies Record<string, readonly GridBreakpoint[]>
