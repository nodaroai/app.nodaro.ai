import { describe, it, expect } from "vitest"
import { computeCollageLayout, type ImageDim, type Rect } from "../collage-layout.js"
import { buildCollageFfmpegArgs } from "../collage.js"

/** Every rect must sit fully inside the (possibly floated) canvas, allowing 1px
 *  rounding slack. */
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

/** Mirror of the layout's internal aspect clamp so no-crop assertions compare
 *  against the same value the layout actually targets. */
const MIN_ASPECT = 0.2
const MAX_ASPECT = 5
function clampAspect(w: number, h: number): number {
  const a = (w > 0 ? w : 1) / (h > 0 ? h : 1)
  if (!Number.isFinite(a) || a <= 0) return 1
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, a))
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

/** Aspects kept safely inside the [0.2, 5] clamp band so the no-crop invariant
 *  isn't perturbed by clamping. */
function seededModerateDims(n: number, seed: number): ImageDim[] {
  const out: ImageDim[] = []
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const w = 600 + (s % 1200) // 600..1800
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const h = 600 + (s % 1200)
    out.push({ w, h })
  }
  return out
}

describe("computeCollageLayout — smart mode (justified, floating height)", () => {
  it("returns exactly one rect per image", () => {
    for (const n of [1, 2, 3, 4, 5, 7, 9, 12, 20, 30]) {
      const { rects } = computeCollageLayout(seededDims(n, n * 7 + 1), 2560, 2560, { mode: "smart", gap: 12 })
      expect(rects.length).toBe(n)
    }
  })

  it("keeps every rect inside the returned canvas for many n / aspect / canvas combos", () => {
    const canvases: Array<[number, number]> = [
      [2560, 2560], // 1:1
      [3840, 2160], // 16:9
      [2160, 3840], // 9:16
      [2048, 2560], // 4:5
    ]
    for (const [cw, ch] of canvases) {
      for (let n = 1; n <= 24; n++) {
        for (const seed of [1, 42, 999]) {
          const { rects, canvasW, canvasH } = computeCollageLayout(seededDims(n, seed + n), cw, ch, {
            mode: "smart",
            gap: 10,
          })
          expect(rects.length).toBe(n)
          assertInBounds(rects, canvasW, canvasH)
        }
      }
    }
  })

  it("fixes the canvas WIDTH to the target and floats the HEIGHT (never squashed to fit)", () => {
    // A single square image on a wide 16:9 target must NOT be squashed into the
    // short target height — the height floats up so the square stays a square.
    const { rects, canvasW, canvasH } = computeCollageLayout(dims([1000, 1000]), 2560, 1440, {
      mode: "smart",
      gap: 20,
    })
    expect(canvasW).toBe(2560)
    // Height floats to ≈ width (square image ⇒ square-ish canvas), far above 1440.
    expect(canvasH).toBeGreaterThan(2000)
    const [r] = rects
    // The cell stays square (aspect ≈ 1) — no vertical crop.
    expect(r.w / r.h).toBeCloseTo(1, 1)
  })

  it("gives every cell the SAME aspect ratio as its source image (the no-crop invariant)", () => {
    const canvases: Array<[number, number]> = [
      [2560, 2560],
      [3840, 2160],
      [2160, 3840],
    ]
    for (const [cw, ch] of canvases) {
      for (let n = 2; n <= 20; n++) {
        for (const seed of [3, 77, 500]) {
          const imgs = seededModerateDims(n, seed + n)
          const { rects } = computeCollageLayout(imgs, cw, ch, { mode: "smart", gap: 8 })
          rects.forEach((r, i) => {
            const cellAspect = r.w / r.h
            const imgAspect = clampAspect(imgs[i]!.w, imgs[i]!.h)
            // Within 6% — the only deviation is integer rounding + the last-cell
            // width absorb. A cover-crop would blow this out by 20–40%.
            expect(Math.abs(cellAspect - imgAspect) / imgAspect).toBeLessThan(0.06)
          })
        }
      }
    }
  })

  it("each row spans the full canvas width (widths + gaps ≈ canvasW)", () => {
    const cw = 3000
    const ch = 3000
    const gap = 16
    const { rects, canvasW } = computeCollageLayout(seededDims(11, 5), cw, ch, { mode: "smart", gap })
    const byRow = new Map<number, Rect[]>()
    for (const r of rects) {
      const key = Math.round(r.y)
      const arr = byRow.get(key) ?? []
      arr.push(r)
      byRow.set(key, arr)
    }
    for (const row of byRow.values()) {
      const widthPlusGaps = row.reduce((s, r) => s + r.w, 0) + gap * (row.length + 1)
      expect(widthPlusGaps).toBeGreaterThan(canvasW - 6)
      expect(widthPlusGaps).toBeLessThan(canvasW + 6)
    }
  })

  it("caps a pathologically tall collage by uniformly scaling down (still no crop)", () => {
    // Many extreme-portrait images ⇒ natural height would be enormous. The cap
    // must bound the long edge while preserving each cell's aspect ratio.
    const imgs: ImageDim[] = Array.from({ length: 6 }, () => ({ w: 200, h: 1600 })) // aspect 0.125 → clamps to 0.2
    const { rects, canvasW, canvasH } = computeCollageLayout(imgs, 2560, 2560, { mode: "smart", gap: 10 })
    expect(canvasH).toBeLessThanOrEqual(Math.max(canvasW, 2560) * 2 + 2)
    assertInBounds(rects, canvasW, canvasH)
    // Cells stay tall (aspect ≈ 0.2 after clamp) — scaled, not cropped.
    for (const r of rects) expect(r.w / r.h).toBeCloseTo(0.2, 1)
  })

  it("returns even canvas dimensions", () => {
    for (const n of [2, 3, 5, 8, 13]) {
      const { canvasW, canvasH } = computeCollageLayout(seededDims(n, n + 2), 2560, 1440, { mode: "smart", gap: 12 })
      expect(canvasW % 2).toBe(0)
      expect(canvasH % 2).toBe(0)
    }
  })

  it("is deterministic", () => {
    const a = computeCollageLayout(seededDims(9, 3), 2560, 2560, { mode: "smart", gap: 12 })
    const b = computeCollageLayout(seededDims(9, 3), 2560, 2560, { mode: "smart", gap: 12 })
    expect(a).toEqual(b)
  })

  it("produces integer pixel rects", () => {
    const { rects } = computeCollageLayout(seededDims(6, 2), 2560, 1440, { mode: "smart", gap: 12 })
    for (const r of rects) {
      expect(Number.isInteger(r.x)).toBe(true)
      expect(Number.isInteger(r.y)).toBe(true)
      expect(Number.isInteger(r.w)).toBe(true)
      expect(Number.isInteger(r.h)).toBe(true)
    }
  })
})

describe("computeCollageLayout — grid mode (fixed canvas)", () => {
  it("returns one rect per image, all in bounds, and keeps the canvas fixed", () => {
    for (let n = 1; n <= 20; n++) {
      const { rects, canvasW, canvasH } = computeCollageLayout(seededDims(n, n), 2560, 2560, { mode: "grid", gap: 12 })
      expect(rects.length).toBe(n)
      // Grid keeps the exact target canvas — it does NOT float.
      expect(canvasW).toBe(2560)
      expect(canvasH).toBe(2560)
      assertInBounds(rects, canvasW, canvasH)
    }
  })

  it("uses uniform cell sizes", () => {
    const { rects } = computeCollageLayout(dims([100, 100], [200, 100], [100, 200], [300, 300]), 2000, 2000, {
      mode: "grid",
      gap: 20,
    })
    const w0 = rects[0]!.w
    const h0 = rects[0]!.h
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
    const { rects, canvasW, canvasH } = computeCollageLayout(dims([0, 0], [100, 0], [-5, 100]), 2560, 2560, {
      mode: "smart",
      gap: 10,
    })
    expect(rects.length).toBe(3)
    assertInBounds(rects, canvasW, canvasH)
  })
})

describe("buildCollageFfmpegArgs — compositor (fit, no crop)", () => {
  const base = {
    localPaths: ["/a.png", "/b.png"],
    rects: [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 100, y: 0, w: 200, h: 100 },
    ],
    canvasW: 300,
    canvasH: 100,
    bgColor: "0xffffff",
    outputPath: "/out.png",
  }

  it("fits each image inside its cell (scale down to fit), never cover-crops", () => {
    const args = buildCollageFfmpegArgs(base)
    const fc = args[args.indexOf("-filter_complex") + 1]!
    // Fit, not fill: scale-down to fit — no crop, no increase (cover) filter.
    expect(fc).toContain("force_original_aspect_ratio=decrease")
    expect(fc).not.toContain("force_original_aspect_ratio=increase")
    expect(fc).not.toMatch(/(^|[;,\[])crop=/)
  })

  it("does NOT use pad (avoids the decrease-rounding overshoot abort)", () => {
    const args = buildCollageFfmpegArgs(base)
    const fc = args[args.indexOf("-filter_complex") + 1]!
    expect(fc).not.toContain("pad=")
  })

  it("builds the solid canvas in the background color so letterbox bars match the gaps", () => {
    const args = buildCollageFfmpegArgs(base)
    expect(args.join(" ")).toContain("color=c=0xffffff:s=300x100")
  })

  it("centres each fitted image within its cell via an overlay expression", () => {
    const args = buildCollageFfmpegArgs(base)
    const fc = args[args.indexOf("-filter_complex") + 1]!
    // Cell 0 at x=0 w=100 → centred: 0+(100-w)/2 ; cell 1 at x=100 w=200.
    expect(fc).toContain("overlay=x=0+(100-w)/2:y=0+(100-h)/2")
    expect(fc).toContain("overlay=x=100+(200-w)/2:y=0+(100-h)/2")
    expect(fc).toContain("[out]")
    expect(args).toContain("-map")
  })
})
