import { describe, it, expect } from "vitest"
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_PER_PIXEL,
  SNAP_THRESHOLD,
  TEAR_AWAY_THRESHOLD,
  applyMagnet,
  computeZoomFromDrag,
  computeVisualSize,
} from "../zoom-math"

describe("constants", () => {
  it("has the expected calibration values", () => {
    expect(ZOOM_MIN).toBe(0.5)
    expect(ZOOM_MAX).toBe(2.0)
    expect(ZOOM_PER_PIXEL).toBe(0.005)
    expect(SNAP_THRESHOLD).toBe(0.05)
    expect(TEAR_AWAY_THRESHOLD).toBe(0.08)
  })
})

describe("applyMagnet", () => {
  it("snaps to 1.0 within ±5% when not previously snapped", () => {
    expect(applyMagnet(1.04, 1.5)).toBe(1.0)
    expect(applyMagnet(0.96, 1.5)).toBe(1.0)
  })
  it("does not snap when outside ±5% from a non-snapped start", () => {
    expect(applyMagnet(1.06, 1.5)).toBe(1.06)
    expect(applyMagnet(0.94, 1.5)).toBe(0.94)
  })
  it("requires crossing ±8% to leave the snap once snapped", () => {
    expect(applyMagnet(1.07, 1.0)).toBe(1.0)  // still snapped, < 8%
    expect(applyMagnet(1.09, 1.0)).toBe(1.09) // tore away, > 8%
    expect(applyMagnet(0.91, 1.0)).toBe(0.91) // tore away on the other side
  })
  it("re-snaps once back inside ±5% from a non-snapped state", () => {
    expect(applyMagnet(1.04, 1.2)).toBe(1.0)
  })
})

describe("computeZoomFromDrag", () => {
  it("bottom-left: down-left grows, up-right shrinks", () => {
    // Down-left drag (now.x<start.x AND now.y>start.y): GROW
    expect(computeZoomFromDrag(1.0, { x: 100, y: 100 }, { x: 50, y: 150 })).toBeCloseTo(1.5, 5)
    // Up-right drag (now.x>start.x AND now.y<start.y): SHRINK
    expect(computeZoomFromDrag(1.0, { x: 100, y: 100 }, { x: 150, y: 50 })).toBeCloseTo(0.5, 5)
  })

  it("bottom-right: down-right grows, up-left shrinks (X-sign flipped)", () => {
    // Down-right drag (now.x>start.x AND now.y>start.y): GROW
    expect(computeZoomFromDrag(1.0, { x: 100, y: 100 }, { x: 150, y: 150 }, "bottom-right")).toBeCloseTo(1.5, 5)
    // Up-left drag (now.x<start.x AND now.y<start.y): SHRINK
    expect(computeZoomFromDrag(1.0, { x: 100, y: 100 }, { x: 50, y: 50 }, "bottom-right")).toBeCloseTo(0.5, 5)
  })

  it("clamps to ZOOM_MIN and ZOOM_MAX", () => {
    expect(computeZoomFromDrag(1.0, { x: 100, y: 100 }, { x: -1000, y: 2000 })).toBe(ZOOM_MAX)
    expect(computeZoomFromDrag(1.0, { x: 100, y: 100 }, { x: 2000, y: -1000 })).toBe(ZOOM_MIN)
  })

  it("starts from the given zoom_0", () => {
    expect(computeZoomFromDrag(1.5, { x: 100, y: 100 }, { x: 100, y: 100 })).toBe(1.5)
  })
})

describe("computeVisualSize", () => {
  it("multiplies logical by zoom and rounds to integers", () => {
    expect(computeVisualSize({ w: 200, h: 100 }, 1.5)).toEqual({ w: 300, h: 150 })
    expect(computeVisualSize({ w: 200, h: 100 }, 1.13)).toEqual({ w: 226, h: 113 })
  })

  it("applies a 100px hard floor on width", () => {
    expect(computeVisualSize({ w: 220, h: 100 }, 0.4)).toEqual({ w: 100, h: 100 })
  })

  it("applies floor only when inputs would go below it", () => {
    expect(computeVisualSize({ w: 220, h: 100 }, 0.5)).toEqual({ w: 110, h: 100 })
  })
})

describe("zoom drift round-trip", () => {
  it("preserves logical size across resize-then-zoom-then-resize-then-zoom", () => {
    let logical = { w: 220, h: 110 }
    let zoom = 1.0

    // Zoom 1.0 → 1.5
    zoom = 1.5
    let visual = computeVisualSize(logical, zoom)
    expect(visual).toEqual({ w: 330, h: 165 })

    // Resize: visual width grows by 100 (right edge drag); logical recomputes
    visual = { ...visual, w: visual.w + 100 } // 430
    logical = { w: visual.w / zoom, h: visual.h / zoom } // 286.67, 110

    // Zoom 1.5 → 0.5
    zoom = 0.5
    visual = computeVisualSize(logical, zoom)
    expect(visual.w).toBeCloseTo(143, 0)
    expect(visual.h).toBe(100) // floored

    // Round-trip back: zoom 0.5 → 1.5
    zoom = 1.5
    visual = computeVisualSize(logical, zoom)
    expect(visual.w).toBe(430)
  })
})
