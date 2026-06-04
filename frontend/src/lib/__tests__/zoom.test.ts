import { describe, it, expect } from "vitest"
import {
  ZOOM_MIN,
  ZOOM_MAX,
  formatZoomPercent,
  clampZoom,
  snapZoom,
  scrubZoom,
  parseZoomInput,
} from "@/lib/zoom"

describe("formatZoomPercent", () => {
  it("formats round and fractional zooms", () => {
    expect(formatZoomPercent(1)).toBe("100%")
    expect(formatZoomPercent(0.882)).toBe("88.2%")
    expect(formatZoomPercent(0.75)).toBe("75%")
    expect(formatZoomPercent(1.8)).toBe("180%")
    expect(formatZoomPercent(8)).toBe("800%")
  })
})

describe("clampZoom", () => {
  it("clamps to [ZOOM_MIN, ZOOM_MAX]", () => {
    expect(clampZoom(0.05)).toBe(ZOOM_MIN)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
    expect(clampZoom(1)).toBe(1)
  })
})

describe("snapZoom", () => {
  it("steps up to the next ladder stop", () => {
    expect(snapZoom(1, 1)).toBeCloseTo(1.25)
    expect(snapZoom(0.88, 1)).toBeCloseTo(1)
    expect(snapZoom(0.25, 1)).toBeCloseTo(0.33)
  })

  it("steps down to the previous ladder stop", () => {
    expect(snapZoom(1, -1)).toBeCloseTo(0.75)
    expect(snapZoom(0.88, -1)).toBeCloseTo(0.75)
  })

  it("does not step past the min/max bounds", () => {
    expect(snapZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(snapZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
    // below the smallest ladder stop, stepping down lands on the min
    expect(snapZoom(0.25, -1)).toBe(ZOOM_MIN)
  })
})

describe("scrubZoom", () => {
  it("returns the start zoom for no movement", () => {
    expect(scrubZoom(1, 0)).toBeCloseTo(1)
  })

  it("dragging up (positive dy) increases zoom; down decreases", () => {
    expect(scrubZoom(1, 100)).toBeGreaterThan(1)
    expect(scrubZoom(1, -100)).toBeLessThan(1)
    expect(scrubZoom(1, 80)).toBeGreaterThan(scrubZoom(1, 20))
  })

  it("clamps to the zoom bounds", () => {
    expect(scrubZoom(8, 5000)).toBe(ZOOM_MAX)
    expect(scrubZoom(0.2, -5000)).toBe(ZOOM_MIN)
  })
})

describe("parseZoomInput", () => {
  it("parses plain numbers, percent signs, and whitespace", () => {
    expect(parseZoomInput("120")).toBeCloseTo(1.2)
    expect(parseZoomInput("120%")).toBeCloseTo(1.2)
    expect(parseZoomInput("  88.2 ")).toBeCloseTo(0.882)
  })

  it("clamps to the zoom bounds", () => {
    expect(parseZoomInput("5")).toBe(ZOOM_MIN)
    expect(parseZoomInput("1000")).toBe(ZOOM_MAX)
  })

  it("returns null for invalid or non-positive input", () => {
    expect(parseZoomInput("abc")).toBeNull()
    expect(parseZoomInput("")).toBeNull()
    expect(parseZoomInput("0")).toBeNull()
    expect(parseZoomInput("-50")).toBeNull()
  })
})
