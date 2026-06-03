import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mock @tanstack/react-virtual so the hook's pure logic (column count,
// rowCount, infinite-load trigger) can be asserted without a real DOM layout
// (jsdom has none). We capture the options passed to the virtualizer and let
// the test control which virtual rows are "visible".
// ---------------------------------------------------------------------------

interface CapturedOptions {
  count: number
  estimateSize: () => number
  overscan: number
  gap: number
  scrollMargin?: number
  enabled?: boolean
  getScrollElement?: () => HTMLElement | null
}

let lastWindowOptions: CapturedOptions | null = null
let lastElementOptions: CapturedOptions | null = null

// Controls what getVirtualItems() returns for the enabled virtualizer.
let visibleRows: { index: number; key: number; start: number; size: number }[] = []

function makeVirtualizer(options: CapturedOptions) {
  return {
    options,
    measure: vi.fn(),
    getVirtualItems: () => (options.enabled === false ? [] : visibleRows),
    getTotalSize: () =>
      options.count * (options.estimateSize ? options.estimateSize() : 0),
  }
}

vi.mock("@tanstack/react-virtual", () => ({
  useWindowVirtualizer: (opts: CapturedOptions) => {
    lastWindowOptions = opts
    return makeVirtualizer(opts)
  },
  useVirtualizer: (opts: CapturedOptions) => {
    lastElementOptions = opts
    return makeVirtualizer(opts)
  },
}))

import {
  useVirtualGrid,
  columnsForWidth,
  rowItems,
  GRID_BREAKPOINTS,
  type GridBreakpoint,
} from "../use-virtual-grid"

const GALLERY_BPS: readonly GridBreakpoint[] = GRID_BREAKPOINTS.gallery

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  })
}

beforeEach(() => {
  lastWindowOptions = null
  lastElementOptions = null
  visibleRows = []
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// columnsForWidth — pure breakpoint resolution (single source of truth shared
// by the hook's rowCount and the render's gridTemplateColumns).
// ---------------------------------------------------------------------------
describe("columnsForWidth", () => {
  it("returns the base column count below the first breakpoint", () => {
    expect(columnsForWidth(0, GALLERY_BPS)).toBe(2)
    expect(columnsForWidth(639, GALLERY_BPS)).toBe(2)
  })

  it("returns 3 columns at the sm breakpoint (640px)", () => {
    expect(columnsForWidth(640, GALLERY_BPS)).toBe(3)
    expect(columnsForWidth(767, GALLERY_BPS)).toBe(3)
  })

  it("returns 4 columns at the md breakpoint (768px)", () => {
    expect(columnsForWidth(768, GALLERY_BPS)).toBe(4)
    expect(columnsForWidth(1023, GALLERY_BPS)).toBe(4)
  })

  it("returns 5 columns at the lg breakpoint (1024px+)", () => {
    expect(columnsForWidth(1024, GALLERY_BPS)).toBe(5)
    expect(columnsForWidth(1920, GALLERY_BPS)).toBe(5)
  })

  it("matches the library breakpoints (1/2/3 cols)", () => {
    const lib = GRID_BREAKPOINTS.library
    expect(columnsForWidth(0, lib)).toBe(1)
    expect(columnsForWidth(640, lib)).toBe(2)
    expect(columnsForWidth(1024, lib)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// rowItems — slicing the flat array while preserving the ORIGINAL flat index
// (so CachedImage's `index < 10` heuristic and lightbox mapping stay correct).
// ---------------------------------------------------------------------------
describe("rowItems", () => {
  const items = Array.from({ length: 13 }, (_, i) => `item-${i}`)

  it("returns the correct slice with original indices for a middle row", () => {
    const row = rowItems(items, 2, 4) // row 2, 4 cols → indices 8..11
    expect(row.map((r) => r.index)).toEqual([8, 9, 10, 11])
    expect(row.map((r) => r.item)).toEqual(["item-8", "item-9", "item-10", "item-11"])
  })

  it("clamps the last (partial) row to the array length", () => {
    const row = rowItems(items, 3, 4) // row 3 → indices 12 only (13 items)
    expect(row.map((r) => r.index)).toEqual([12])
  })

  it("preserves global indices (does NOT reset per row)", () => {
    const row0 = rowItems(items, 0, 4)
    const row1 = rowItems(items, 1, 4)
    expect(row0[0].index).toBe(0)
    expect(row1[0].index).toBe(4) // NOT 0
  })
})

// ---------------------------------------------------------------------------
// useVirtualGrid — column count per width, rowCount = ceil(itemCount/cols),
// and the infinite-load fetch trigger.
// ---------------------------------------------------------------------------
describe("useVirtualGrid", () => {
  function renderGrid(
    overrides: Partial<Parameters<typeof useVirtualGrid>[0]> = {},
  ) {
    const fetchNextPage = vi.fn()
    const result = renderHook(() =>
      useVirtualGrid({
        itemCount: 100,
        breakpoints: GALLERY_BPS,
        estimateRowHeight: 240,
        gap: 16,
        fetchNextPage,
        hasNextPage: true,
        isFetchingNextPage: false,
        ...overrides,
      }),
    )
    return { ...result, fetchNextPage }
  }

  it("derives column count from the viewport width", () => {
    setViewportWidth(1024)
    const { result } = renderGrid()
    expect(result.current.columns).toBe(5)
    expect(result.current.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))")
  })

  it("derives a different column count at a smaller viewport", () => {
    setViewportWidth(640)
    const { result } = renderGrid()
    expect(result.current.columns).toBe(3)
  })

  it("computes rowCount = ceil(itemCount / cols) and passes it to the virtualizer", () => {
    setViewportWidth(1024) // 5 cols
    renderGrid({ itemCount: 23 }) // ceil(23/5) = 5 rows
    expect(lastWindowOptions?.count).toBe(5)
  })

  it("rowCount handles exact multiples", () => {
    setViewportWidth(1024) // 5 cols
    renderGrid({ itemCount: 20 }) // ceil(20/5) = 4
    expect(lastWindowOptions?.count).toBe(4)
  })

  it("uses the window virtualizer (enabled) when no scrollElementRef is given", () => {
    setViewportWidth(1024)
    renderGrid()
    expect(lastWindowOptions?.enabled).toBe(true)
    expect(lastElementOptions?.enabled).toBe(false)
  })

  it("uses the element virtualizer (enabled) when a scrollElementRef is given", () => {
    setViewportWidth(1024)
    const scrollElementRef = { current: document.createElement("div") }
    renderGrid({ scrollElementRef })
    expect(lastElementOptions?.enabled).toBe(true)
    expect(lastWindowOptions?.enabled).toBe(false)
  })

  it("passes gap and overscan through to the virtualizer", () => {
    setViewportWidth(1024)
    renderGrid({ gap: 16, overscan: 3 })
    expect(lastWindowOptions?.gap).toBe(16)
    expect(lastWindowOptions?.overscan).toBe(3)
  })

  // --- infinite-load trigger -------------------------------------------------

  it("fires fetchNextPage when the last visible row crosses rowCount - 2", () => {
    setViewportWidth(1024) // 5 cols, itemCount 100 → 20 rows
    // last visible row index 18 >= 20 - 2 = 18 → should fetch
    visibleRows = [{ index: 18, key: 18, start: 0, size: 240 }]
    const { fetchNextPage } = renderGrid({ itemCount: 100 })
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it("does NOT fire fetchNextPage when the last visible row is well before the end", () => {
    setViewportWidth(1024) // 20 rows
    visibleRows = [{ index: 5, key: 5, start: 0, size: 240 }]
    const { fetchNextPage } = renderGrid({ itemCount: 100 })
    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it("does NOT fire fetchNextPage while isFetchingNextPage is true (no double-fire)", () => {
    setViewportWidth(1024)
    visibleRows = [{ index: 19, key: 19, start: 0, size: 240 }]
    const { fetchNextPage } = renderGrid({
      itemCount: 100,
      isFetchingNextPage: true,
    })
    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it("does NOT fire fetchNextPage when hasNextPage is false", () => {
    setViewportWidth(1024)
    visibleRows = [{ index: 19, key: 19, start: 0, size: 240 }]
    const { fetchNextPage } = renderGrid({
      itemCount: 100,
      hasNextPage: false,
    })
    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it("does NOT fire fetchNextPage when there are no rows (empty list)", () => {
    setViewportWidth(1024)
    visibleRows = []
    const { fetchNextPage } = renderGrid({ itemCount: 0 })
    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it("exposes totalSize from the active virtualizer", () => {
    setViewportWidth(1024) // 20 rows × 240 = 4800
    const { result } = renderGrid({ itemCount: 100 })
    expect(result.current.totalSize).toBe(20 * 240)
  })
})
