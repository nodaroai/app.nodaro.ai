import { describe, it, expect } from "vitest"
import { computeCollageLayout, type ImageDim, type Rect } from "../collage-layout.js"

/** Every rect must sit fully inside the canvas (allowing 1px rounding slack). */
function assertInBounds(rects: readonly Rect[], canvasW: number, canvasH: number): void {
  for (const r of rects) {
    expect(r.w).toBeGreaterThan(0)
    expect(r.h).toBeGreaterThan(0)
    expect(Number.isFinite(r.x)).toBe(true)
    expect(Number.isFinite(r.y)).toBe(true)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + r.w).toBeLessThanOrEqual(canvasW + 1)
    expect(r.y + r.h).toBeLessThanOrEqual(canvasH + 1)
  }
}

function dims(...pairs: Array<[number, number]>): ImageDim[] {
  return pairs.map(([w, h]) => ({ w, h }))
}

/** Deterministic pseudo-random aspect generator (no Math.random for repeatability). */
function seededDims(n: number, seed: number): ImageDim[] {
  const out: ImageDim[] = []
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const w = 200 + (s % 1400) // 200..1600
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const h = 200 + (s % 1400)
    out.push({ w, h })
  }
  return out
}

describe("computeCollageLayout — smart mode", () => {
  it("returns exactly one rect per image", () => {
    for (const n of [1, 2, 3, 4, 5, 7, 9, 12, 20, 30]) {
      const rects = computeCollageLayout(seededDims(n, n * 7 + 1), 2560, 2560, { mode: "smart", gap: 12 })
      expect(rects.length).toBe(n)
    }
  })

  it("keeps every rect inside the canvas for many n / aspect / canvas combos", () => {
    const canvases: Array<[number, number]> = [
      [2560, 2560], // 1:1
      [3840, 2160], // 16:9
      [2160, 3840], // 9:16
      [2048, 2560], // 4:5
    ]
    for (const [cw, ch] of canvases) {
      for (let n = 1; n <= 24; n++) {
        for (const seed of [1, 42, 999]) {
          const rects = computeCollageLayout(seededDims(n, seed + n), cw, ch, { mode: "smart", gap: 10 })
          expect(rects.length).toBe(n)
          assertInBounds(rects, cw, ch)
        }
      }
    }
  })

  it("a single image fills (almost) the whole canvas inside the gap margin", () => {
    const [cw, ch] = [2560, 1440]
    const gap = 20
    const [r] = computeCollageLayout(dims([1000, 1000]), cw, ch, { mode: "smart", gap })
    expect(r.x).toBeCloseTo(gap, -1)
    expect(r.y).toBeCloseTo(gap, -1)
    expect(r.w).toBeCloseTo(cw - 2 * gap, -1)
    expect(r.h).toBeCloseTo(ch - 2 * gap, -1)
  })

  it("each row spans the full canvas width (widths + gaps ≈ canvasW)", () => {
    const cw = 3000
    const ch = 3000
    const gap = 16
    const rects = computeCollageLayout(seededDims(11, 5), cw, ch, { mode: "smart", gap })
    // Group rects by their y (row). Rects in the same row share y.
    const byRow = new Map<number, Rect[]>()
    for (const r of rects) {
      const key = Math.round(r.y)
      const arr = byRow.get(key) ?? []
      arr.push(r)
      byRow.set(key, arr)
    }
    for (const row of byRow.values()) {
      const widthPlusGaps = row.reduce((s, r) => s + r.w, 0) + gap * (row.length + 1)
      expect(widthPlusGaps).toBeGreaterThan(cw - 6)
      expect(widthPlusGaps).toBeLessThan(cw + 6)
    }
  })

  it("is deterministic", () => {
    const a = computeCollageLayout(seededDims(9, 3), 2560, 2560, { mode: "smart", gap: 12 })
    const b = computeCollageLayout(seededDims(9, 3), 2560, 2560, { mode: "smart", gap: 12 })
    expect(a).toEqual(b)
  })

  it("produces integer pixel rects", () => {
    const rects = computeCollageLayout(seededDims(6, 2), 2560, 1440, { mode: "smart", gap: 12 })
    for (const r of rects) {
      expect(Number.isInteger(r.x)).toBe(true)
      expect(Number.isInteger(r.y)).toBe(true)
      expect(Number.isInteger(r.w)).toBe(true)
      expect(Number.isInteger(r.h)).toBe(true)
    }
  })
})

describe("computeCollageLayout — grid mode", () => {
  it("returns one rect per image, all in bounds", () => {
    for (let n = 1; n <= 20; n++) {
      const rects = computeCollageLayout(seededDims(n, n), 2560, 2560, { mode: "grid", gap: 12 })
      expect(rects.length).toBe(n)
      assertInBounds(rects, 2560, 2560)
    }
  })

  it("uses uniform cell sizes", () => {
    // 4 images → 2x2 grid → all cells identical size.
    const rects = computeCollageLayout(dims([100, 100], [200, 100], [100, 200], [300, 300]), 2000, 2000, {
      mode: "grid",
      gap: 20,
    })
    const w0 = rects[0].w
    const h0 = rects[0].h
    for (const r of rects) {
      expect(r.w).toBe(w0)
      expect(r.h).toBe(h0)
    }
  })
})

describe("computeCollageLayout — guards", () => {
  it("throws on empty image list", () => {
    expect(() => computeCollageLayout([], 2560, 2560, { mode: "smart" })).toThrow()
  })

  it("tolerates degenerate (zero/negative) dims by treating them as square", () => {
    const rects = computeCollageLayout(dims([0, 0], [100, 0], [-5, 100]), 2560, 2560, { mode: "smart", gap: 10 })
    expect(rects.length).toBe(3)
    assertInBounds(rects, 2560, 2560)
  })
})
