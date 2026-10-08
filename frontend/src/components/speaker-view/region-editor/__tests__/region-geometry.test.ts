/**
 * The region editor's geometry. The concrete cases are the cloud plugin's own
 * (`cover-crop.test.ts`, `geometry.test.ts`): this copy mirrors its renderer,
 * so the dashed box and the chip show what will be drawn. The property tests
 * run seeded random regions, frames and slots through the invariants.
 */
import { describe, it, expect } from "vitest"
import {
  FULL_FRAME,
  UPSCALE_WARN,
  coverCropRect,
  jumpSeekMs,
  layoutSlotRects,
  masterToSourceMs,
  nudgeRegion,
  regionToDisplay,
  speakerViewCanvas,
  tidyRegion,
  upscaleOf,
  type Region,
  type Size,
  type SlotRect,
  type SpeakerViewAspect,
} from "../region-geometry"
import { clampRect, dragRect, type RectDrag } from "@/components/editor/media-editor/rect-handles"

const LANDSCAPE = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }
const ASPECTS: SpeakerViewAspect[] = ["16:9", "9:16", "1:1", "4:5"]

/** mulberry32: a small deterministic PRNG, so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomRegion(r: () => number): Region {
  const w = 0.01 + r() * 0.99
  const h = 0.01 + r() * 0.99
  return { x: r() * (1 - w), y: r() * (1 - h), w, h }
}
const randomSize = (r: () => number): Size => ({ width: 2 * Math.round(160 + r() * 1900), height: 2 * Math.round(160 + r() * 1900) })

describe("the canvas (SV7 a)", () => {
  it("draws a final at Social Media Format's sizes and a preview at a 720 short side", () => {
    expect(ASPECTS.map((a) => speakerViewCanvas(a, "final"))).toEqual([LANDSCAPE, PORTRAIT, { width: 1080, height: 1080 }, { width: 1080, height: 1350 }])
    for (const a of ASPECTS) {
      const p = speakerViewCanvas(a, "proxy")
      expect(Math.min(p.width, p.height)).toBe(720)
    }
  })
})

describe("layoutSlotRects (the plugin's placements)", () => {
  it("side by side, stacked (odd halves rounded even), single", () => {
    expect(layoutSlotRects("side-by-side", LANDSCAPE, 2)).toEqual([{ x: 0, y: 0, w: 960, h: 1080 }, { x: 960, y: 0, w: 960, h: 1080 }])
    expect(layoutSlotRects("stacked", { width: 1080, height: 1350 }, 2)).toEqual([{ x: 0, y: 0, w: 1080, h: 674 }, { x: 0, y: 674, w: 1080, h: 676 }])
    expect(layoutSlotRects("single", { width: 720, height: 900 }, 1)).toEqual([{ x: 0, y: 0, w: 720, h: 900 }])
  })

  it("grid: an incomplete last row keeps the cell size and is centred", () => {
    expect(layoutSlotRects("grid", LANDSCAPE, 5)).toEqual([
      { x: 0, y: 0, w: 640, h: 540 }, { x: 640, y: 0, w: 640, h: 540 }, { x: 1280, y: 0, w: 640, h: 540 },
      { x: 320, y: 540, w: 640, h: 540 }, { x: 960, y: 540, w: 640, h: 540 },
    ])
    expect(layoutSlotRects("grid", { width: 1080, height: 1080 }, 3)).toEqual([
      { x: 0, y: 0, w: 540, h: 540 }, { x: 540, y: 0, w: 540, h: 540 }, { x: 270, y: 540, w: 540, h: 540 },
    ])
  })

  it("pip: main fills the canvas; the inset is 0.3 of it, bottom-right (landscape) or top-right (portrait)", () => {
    expect(layoutSlotRects("pip", LANDSCAPE, 2)).toEqual([{ x: 0, y: 0, w: 1920, h: 1080 }, { x: 1920 - 42 - 576, y: 1080 - 42 - 324, w: 576, h: 324 }])
    expect(layoutSlotRects("pip", PORTRAIT, 2)[1]).toEqual({ x: 1080 - 42 - 324, y: 42, w: 324, h: 576 })
    expect(layoutSlotRects("pip", { width: 1080, height: 1350 }, 2)[1]).toEqual({ x: 1080 - 42 - 324, y: 42, w: 324, h: 404 })
  })

  it("draws nothing for a count or id the renderer does not take", () => {
    expect(layoutSlotRects("side-by-side", LANDSCAPE, 3)).toEqual([])
    expect(layoutSlotRects("grid", LANDSCAPE, 7)).toEqual([])
    expect(layoutSlotRects("single", LANDSCAPE, 2)).toEqual([])
    expect(layoutSlotRects("mosaic", LANDSCAPE, 2)).toEqual([])
  })

  it("every layout × aspect × count × quality: even, inside the canvas, and (pip aside) non-overlapping", () => {
    const ranges: Array<[string, number, number]> = [["single", 1, 1], ["side-by-side", 2, 2], ["stacked", 2, 2], ["grid", 2, 6], ["pip", 2, 2]]
    const overlaps = (a: SlotRect, b: SlotRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    for (const [layout, lo, hi] of ranges) for (const aspect of ASPECTS) for (const q of ["proxy", "final"] as const) for (let n = lo; n <= hi; n++) {
      const canvas = speakerViewCanvas(aspect, q)
      const rects = layoutSlotRects(layout, canvas, n)
      expect(rects, `${layout} ${aspect} ${q} ${n}`).toHaveLength(n)
      for (const r of rects) {
        for (const v of [r.x, r.y, r.w, r.h]) expect(v % 2).toBe(0)
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= canvas.width && r.y + r.h <= canvas.height).toBe(true)
      }
      if (layout !== "pip") for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false)
    }
  })
})

describe("coverCropRect (the plugin's cases)", () => {
  it("a full-frame landscape camera at 9:16 keeps a centred vertical strip", () => {
    const r = coverCropRect(FULL_FRAME, LANDSCAPE, PORTRAIT)
    expect(r.h).toBe(1080)
    expect(r.w).toBeCloseTo(607.5, 6)
    expect(r.x).toBeCloseTo((1920 - 607.5) / 2, 6)
    expect(r.y).toBe(0)
  })

  it("a region narrower than the slot keeps its width; a wider one keeps its height", () => {
    const a = coverCropRect({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, PORTRAIT, LANDSCAPE)
    expect([a.w, a.h, a.x, a.y].map((v) => +v.toFixed(6))).toEqual([540, 303.75, 270, +(960 - 303.75 / 2).toFixed(6)])
    const b = coverCropRect({ x: 0.1, y: 0.2, w: 0.8, h: 0.3 }, LANDSCAPE, LANDSCAPE)
    expect([b.w, b.h, b.x, b.y].map((v) => +v.toFixed(6))).toEqual([576, 324, 672, 216])
  })

  it("the left-third default at 9:16 frames that third", () => {
    const r = coverCropRect({ x: 0, y: 0, w: 1 / 3, h: 1 }, LANDSCAPE, PORTRAIT)
    expect(r.w).toBeCloseTo(607.5, 6)
    expect(r.x).toBeCloseTo(320 - 607.5 / 2, 6)
  })

  it("is the chip's example: 608 × 1080 → 1080 × 1920 is a 1.8× upscale, over the amber line", () => {
    const crop = coverCropRect({ x: 0, y: 0, w: 1 / 3, h: 1 }, LANDSCAPE, PORTRAIT)
    expect(Math.round(crop.w)).toBe(608)
    expect(upscaleOf(crop, PORTRAIT)).toBeCloseTo(1.78, 2)
    expect(upscaleOf(crop, PORTRAIT)).toBeGreaterThan(UPSCALE_WARN)
    expect(upscaleOf(coverCropRect(FULL_FRAME, LANDSCAPE, LANDSCAPE), LANDSCAPE)).toBe(1)
  })

  it("property: inside the region, the slot's aspect exactly, maximal, and centred unless the frame stops it", () => {
    const r = rng(20261008)
    for (let i = 0; i < 2000; i++) {
      const region = randomRegion(r)
      const source = randomSize(r)
      const slot = randomSize(r)
      const c = coverCropRect(region, source, slot)
      const label = JSON.stringify({ region, source, slot })
      const [rx, ry, rw, rh] = [region.x * source.width, region.y * source.height, region.w * source.width, region.h * source.height]
      expect(c.x, label).toBeGreaterThanOrEqual(rx - 1e-6)
      expect(c.y, label).toBeGreaterThanOrEqual(ry - 1e-6)
      expect(c.x + c.w, label).toBeLessThanOrEqual(rx + rw + 1e-6)
      expect(c.y + c.h, label).toBeLessThanOrEqual(ry + rh + 1e-6)
      expect(c.w * slot.height, label).toBeCloseTo(c.h * slot.width, 3)
      // Maximal: it touches the region on one axis.
      expect(Math.min(Math.abs(c.w - rw), Math.abs(c.h - rh)), label).toBeLessThan(1e-6)
      // Centred on the region (a region is inside the frame, so nothing clamps).
      expect(c.x + c.w / 2, label).toBeCloseTo(rx + rw / 2, 6)
      expect(c.y + c.h / 2, label).toBeCloseTo(ry + rh / 2, 6)
      expect(upscaleOf(c, slot)).toBeCloseTo(slot.height / c.h, 6)
    }
  })
})

describe("display ↔ fractions, tidy, nudge", () => {
  it("maps a region onto the displayed frame", () => {
    expect(regionToDisplay({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { width: 800, height: 400 })).toEqual({ x: 200, y: 200, width: 400, height: 100 })
  })

  it("property: a tidied region is inside the frame, ≥ the rule's minimum, 4 decimals, and within 1e-4 of the box", () => {
    const r = rng(7)
    for (let i = 0; i < 2000; i++) {
      const raw = { x: r() * 1.2 - 0.1, y: r() * 1.2 - 0.1, w: r() * 1.1, h: r() * 1.1 }
      const t = tidyRegion(raw)
      const label = JSON.stringify(raw)
      expect(t.x, label).toBeGreaterThanOrEqual(0)
      expect(t.y, label).toBeGreaterThanOrEqual(0)
      expect(t.x + t.w, label).toBeLessThanOrEqual(1 + 1e-9)
      expect(t.y + t.h, label).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.min(t.w, t.h), label).toBeGreaterThanOrEqual(0.01)
      for (const v of [t.x, t.y, t.w, t.h]) expect(Math.round(v * 1e4) / 1e4).toBe(v)
      if (raw.x >= 0 && raw.y >= 0 && raw.w >= 0.01 && raw.h >= 0.01 && raw.x + raw.w <= 1 && raw.y + raw.h <= 1) {
        for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(t[k] - raw[k]), label).toBeLessThanOrEqual(1e-4 + 1e-9)
      }
    }
  })

  it("nudges by source pixels and stops at the frame's edge", () => {
    const n = nudgeRegion({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, 192, -108, LANDSCAPE)
    expect(n.x).toBeCloseTo(0.6, 9)
    expect(n.y).toBeCloseTo(0.4, 9)
    expect(nudgeRegion({ x: 0.7, y: 0, w: 0.25, h: 0.25 }, 1000, -10, LANDSCAPE)).toEqual({ x: 0.75, y: 0, w: 0.25, h: 0.25 })
  })

  it("property: a box dragged in fractions with the shared handle math stays a valid region", () => {
    const r = rng(42)
    const types: RectDrag[] = ["move", "nw", "ne", "sw", "se", "n", "s", "e", "w"]
    for (let i = 0; i < 2000; i++) {
      const g = randomRegion(r)
      const start = { x: g.x, y: g.y, width: g.w, height: g.h }
      const type = types[Math.floor(r() * types.length)]!
      const corner = type.length === 2
      const out = clampRect(dragRect(start, type, r() * 2 - 1, r() * 2 - 1), { width: 1, height: 1 }, {
        minWidth: 0.01, minHeight: 0.01, ratio: corner ? start.width / start.height : null,
      })
      const label = JSON.stringify({ start, type })
      expect(out.x, label).toBeGreaterThanOrEqual(0)
      expect(out.y, label).toBeGreaterThanOrEqual(0)
      expect(out.x + out.width, label).toBeLessThanOrEqual(1 + 1e-9)
      expect(out.y + out.height, label).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.min(out.width, out.height), label).toBeGreaterThanOrEqual(0.01 - 1e-12)
      if (type === "move") expect([out.width, out.height]).toEqual([start.width, start.height])
    }
  })
})

describe("the seek (D19, SV9 a)", () => {
  it("maps master → source through offsetMs, positive and negative", () => {
    // Cam B starts 4 s after the master: master 12:04 is its own 12:00.
    expect(masterToSourceMs(724_000, 4000)).toBe(720_000)
    // A camera rolling 2.5 s before the master: master 0:10 is its own 0:12.5.
    expect(masterToSourceMs(10_000, -2500)).toBe(12_500)
    expect(masterToSourceMs(10_000, undefined)).toBe(10_000)
  })

  const turns = [
    { speaker: "Host", startMs: 1000, endMs: 3500 }, // too short
    { speaker: "Guest", startMs: 3500, endMs: 9000 },
    { speaker: "Host", startMs: 9000, endMs: 15_000 },
    { speaker: "Host", startMs: 20_000, endMs: 30_000 },
  ]

  it("jumps to the speaker's first turn longer than 3 s inside the camera's coverage", () => {
    expect(jumpSeekMs(turns, "Host", { offsetMs: 0, durationMs: 60_000 })).toBe(9000)
    expect(jumpSeekMs(turns, "Guest", { offsetMs: 0, durationMs: 60_000 })).toBe(3500)
  })

  it("with a positive offset, skips a turn before the camera began", () => {
    // Starts at master 10 s: the 9–15 s turn is not covered; 20 s plays at its own 10 s.
    expect(jumpSeekMs(turns, "Host", { offsetMs: 10_000, durationMs: 60_000 })).toBe(10_000)
  })

  it("with a negative offset, skips a turn past the camera's end", () => {
    // Rolled 5 s early and lasts 16 s: covers master −5 s … 11 s.
    expect(jumpSeekMs(turns, "Guest", { offsetMs: -5000, durationMs: 16_000 })).toBe(8500)
    expect(jumpSeekMs(turns, "Host", { offsetMs: -5000, durationMs: 16_000 })).toBeUndefined()
  })

  it("is undefined while the length is unknown, or for a speaker who never talks long enough", () => {
    expect(jumpSeekMs(turns, "Host", { offsetMs: 0 })).toBeUndefined()
    expect(jumpSeekMs(turns, "Producer", { offsetMs: 0, durationMs: 60_000 })).toBeUndefined()
  })
})
