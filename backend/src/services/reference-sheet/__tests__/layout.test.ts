import { describe, it, expect } from "vitest"
import { computeLayout } from "../layout.js"
import type { ResolvedSection } from "../types.js"

const grid = (n: number): ResolvedSection => ({
  kind: "expression-board", title: "EXPRESSIONS",
  panels: Array.from({ length: n }, (_, i) => ({ image: Buffer.alloc(1), label: `e${i}` })),
})

describe("computeLayout", () => {
  it("canvas width follows the aspect; height is the summed band stack", () => {
    const lay = computeLayout({ skin: "studio", aspect: "landscape", sections: [grid(4)] })
    expect(lay.width).toBe(1600)
    expect(lay.height).toBeGreaterThan(0)
    expect(lay.bands).toHaveLength(1)
  })
  it("a 4-panel board in landscape (5 cols) places 4 slots on one row", () => {
    const lay = computeLayout({ skin: "studio", aspect: "landscape", sections: [grid(4)] })
    const slots = lay.bands[0].slots
    expect(slots).toHaveLength(4)
    const topY = slots[0].y
    expect(slots.every((s) => s.y === topY)).toBe(true) // single row
    expect(slots[1].x).toBeGreaterThan(slots[0].x)      // left → right
  })
  it("9 panels in story (3 cols) wrap to 3 rows", () => {
    const lay = computeLayout({ skin: "studio", aspect: "story", sections: [grid(9)] })
    const ys = new Set(lay.bands[0].slots.map((s) => s.y))
    expect(ys.size).toBe(3)
  })
  it("slots stay within the canvas width", () => {
    const lay = computeLayout({ skin: "studio", aspect: "landscape", sections: [grid(5)] })
    for (const s of lay.bands[0].slots) expect(s.x + s.w).toBeLessThanOrEqual(lay.width)
  })
})
