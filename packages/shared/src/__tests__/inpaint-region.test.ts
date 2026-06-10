import { describe, it, expect } from "vitest"
import { describeMaskRegion } from "../inpaint-region.js"

describe("describeMaskRegion", () => {
  it("maps an upper-left box to the upper-left location with normalized bbox", () => {
    const r = describeMaskRegion({ x: 10, y: 5, width: 30, height: 40 }, { width: 100, height: 100 })
    expect(r.location).toBe("the upper-left region")
    expect(r.normBbox).toEqual({ x: 0.1, y: 0.05, width: 0.3, height: 0.4 })
    expect(r.fragment).toContain("the upper-left region")
    expect(r.fragment).toContain("leaving everything else unchanged")
  })

  it("maps a centered box to the center", () => {
    const r = describeMaskRegion({ x: 40, y: 40, width: 20, height: 20 }, { width: 100, height: 100 })
    expect(r.location).toBe("the center")
  })

  it("clamps a bbox that overflows the image to [0,1]", () => {
    const r = describeMaskRegion({ x: 90, y: 90, width: 50, height: 50 }, { width: 100, height: 100 })
    expect(r.normBbox.width).toBe(0.1)
    expect(r.normBbox.height).toBe(0.1)
    expect(r.location).toBe("the lower-right region")
  })
})
