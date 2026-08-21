/**
 * Unit tests for the slideshow timing planner (`../slideshow-timing.ts`).
 *
 * Everything is integer FRAME math on the output grid — per-slide seconds are
 * converted once and reconciled with largest-remainder so the slot frames sum
 * EXACTLY to the total (no cumulative rounding drift across 100 slides).
 *
 * The four timeline cases mirror the design sheet:
 *   A — audio wired, equal split          (30s / 5 = 6.0s each)
 *   B — some rows pinned, rest distributed (10 + 4 pinned → 3 × 5.33 auto)
 *   C — all pinned, sum ≠ audio → proportional scale + disclosed factor
 *   D — no audio → N × perImageDuration, silent output
 *
 * Transition invariant (spec): transitions consume time from the OUTGOING
 * slide, never the incoming one — the total stays exact.
 */
import { describe, it, expect } from "vitest"
import { computeSlideshowPlan, resolveSlideMotion } from "../slideshow-timing.js"

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

describe("computeSlideshowPlan — Case A: audio wired, equal split", () => {
  it("30s / 5 images at 30fps → 180 frames (6.0s) each, total exactly ceil(audio*fps)", () => {
    const plan = computeSlideshowPlan({
      imageCount: 5,
      fps: 30,
      audioDurationSeconds: 30,
      perImageDurationSeconds: 3,
      transitionSeconds: 0,
      transitionId: "cut",
    })
    expect(plan.silent).toBe(false)
    expect(plan.totalFrames).toBe(900)
    expect(plan.slotFrames).toEqual([180, 180, 180, 180, 180])
    expect(plan.scaleFactor).toBeNull()
  })

  it("non-divisible split still sums exactly (largest remainder, no drift)", () => {
    const plan = computeSlideshowPlan({
      imageCount: 7,
      fps: 30,
      audioDurationSeconds: 10, // 300 frames / 7 = 42.86
      perImageDurationSeconds: 3,
      transitionSeconds: 0,
      transitionId: "cut",
    })
    expect(plan.totalFrames).toBe(300)
    expect(sum(plan.slotFrames)).toBe(300)
    // Every slot within 1 frame of the ideal share.
    for (const f of plan.slotFrames) expect(Math.abs(f - 300 / 7)).toBeLessThan(1)
  })
})

describe("computeSlideshowPlan — Case B: partial overrides", () => {
  it("pinned rows keep their frames; the remainder splits equally across autos (design: 10 + 4 pinned, 3 autos share 16s)", () => {
    const plan = computeSlideshowPlan({
      imageCount: 5,
      fps: 30,
      audioDurationSeconds: 30,
      perImageDurationSeconds: 3,
      overrides: [10, 4, null, null, null],
      transitionSeconds: 0,
      transitionId: "cut",
    })
    expect(plan.totalFrames).toBe(900)
    expect(plan.slotFrames[0]).toBe(300) // 10s pinned
    expect(plan.slotFrames[1]).toBe(120) // 4s pinned
    // 16s = 480 frames across 3 autos → 160 each
    expect(plan.slotFrames.slice(2)).toEqual([160, 160, 160])
    expect(sum(plan.slotFrames)).toBe(900)
    expect(plan.scaleFactor).toBeNull()
  })

  it("pinned sum ≥ audio → everything (pins + nominal autos) scales proportionally, factor disclosed", () => {
    const plan = computeSlideshowPlan({
      imageCount: 3,
      fps: 30,
      audioDurationSeconds: 10, // 300 frames
      perImageDurationSeconds: 3,
      overrides: [8, 6, null], // pins alone = 14s > 10s
      transitionSeconds: 0,
      transitionId: "cut",
    })
    expect(sum(plan.slotFrames)).toBe(300)
    expect(plan.scaleFactor).not.toBeNull()
    // Proportions preserved: pin ratio 8:6 stays ~4:3 after scaling.
    expect(plan.slotFrames[0]! / plan.slotFrames[1]!).toBeCloseTo(8 / 6, 1)
  })
})

describe("computeSlideshowPlan — Case C: all overridden, sum ≠ audio", () => {
  it("scales all rows proportionally to fill the audio and reports the factor", () => {
    const plan = computeSlideshowPlan({
      imageCount: 5,
      fps: 30,
      audioDurationSeconds: 30,
      perImageDurationSeconds: 3,
      overrides: [6.7, 6.7, 4, 4, 3.6], // sums to 25s ≠ 30s
      transitionSeconds: 0,
      transitionId: "cut",
    })
    expect(plan.totalFrames).toBe(900)
    expect(sum(plan.slotFrames)).toBe(900)
    expect(plan.scaleFactor).toBeCloseTo(30 / 25, 5) // ×1.2, the design's example
    // Proportions preserved within a frame.
    expect(plan.slotFrames[0]! / plan.slotFrames[2]!).toBeCloseTo(6.7 / 4, 1)
  })

  it("all overridden and sum == audio → no factor (nothing to disclose)", () => {
    const plan = computeSlideshowPlan({
      imageCount: 2,
      fps: 30,
      audioDurationSeconds: 10,
      perImageDurationSeconds: 3,
      overrides: [4, 6],
      transitionSeconds: 0,
      transitionId: "cut",
    })
    expect(plan.slotFrames).toEqual([120, 180])
    expect(plan.scaleFactor).toBeNull()
  })
})

describe("computeSlideshowPlan — Case D: no audio", () => {
  it("N × perImageDuration, silent, no factor", () => {
    const plan = computeSlideshowPlan({
      imageCount: 5,
      fps: 30,
      perImageDurationSeconds: 3,
      transitionSeconds: 0,
      transitionId: "cut",
    })
    expect(plan.silent).toBe(true)
    expect(plan.slotFrames).toEqual([90, 90, 90, 90, 90])
    expect(plan.totalFrames).toBe(450)
    expect(plan.scaleFactor).toBeNull()
  })
})

describe("computeSlideshowPlan — transitions consume the OUTGOING slide, total stays exact", () => {
  it("dissolve 0.5s over 5 × 6s: first segment = its slot, later segments = slot + td, xfade total == totalFrames", () => {
    const plan = computeSlideshowPlan({
      imageCount: 5,
      fps: 30,
      audioDurationSeconds: 30,
      perImageDurationSeconds: 3,
      transitionSeconds: 0.5,
      transitionId: "dissolve",
    })
    const td = plan.transitionFrames
    expect(td).toBe(15) // 0.5s * 30fps
    expect(plan.segmentFrames[0]).toBe(plan.slotFrames[0])
    for (let i = 1; i < 5; i++) {
      expect(plan.segmentFrames[i]).toBe(plan.slotFrames[i]! + td)
    }
    // xfade chain length: seg_0 + Σ(seg_i − td) — must equal the total EXACTLY.
    const chain = plan.segmentFrames[0]! + plan.segmentFrames.slice(1).reduce((a, s) => a + s - td, 0)
    expect(chain).toBe(plan.totalFrames)
    // Each blend window ends exactly on its slot boundary (consumes outgoing):
    // offset_k = prefix(slots 0..k)/fps − td/fps.
    let prefix = 0
    for (let k = 0; k < 4; k++) {
      prefix += plan.slotFrames[k]!
      expect(plan.xfadeOffsetsSeconds[k]).toBeCloseTo((prefix - td) / 30, 6)
    }
    expect(plan.transitionClamped).toBe(false)
  })

  it("cut (or zero duration) → no extensions, no offsets", () => {
    const plan = computeSlideshowPlan({
      imageCount: 3,
      fps: 30,
      audioDurationSeconds: 9,
      perImageDurationSeconds: 3,
      transitionSeconds: 0.5,
      transitionId: "cut",
    })
    expect(plan.transitionFrames).toBe(0)
    expect(plan.segmentFrames).toEqual(plan.slotFrames)
    expect(plan.xfadeOffsetsSeconds).toEqual([])
  })

  it("transition longer than the shortest slot is clamped (and flagged) instead of corrupting the chain", () => {
    const plan = computeSlideshowPlan({
      imageCount: 4,
      fps: 30,
      audioDurationSeconds: 4, // 1s slots (30 frames)
      perImageDurationSeconds: 3,
      transitionSeconds: 2, // longer than a whole slot
      transitionId: "fade",
    })
    expect(plan.transitionClamped).toBe(true)
    expect(plan.transitionFrames).toBeLessThan(30)
    expect(sum(plan.slotFrames)).toBe(plan.totalFrames)
  })
})

describe("computeSlideshowPlan — guards", () => {
  it("audio too short to give every image a frame → clear error", () => {
    expect(() =>
      computeSlideshowPlan({
        imageCount: 100,
        fps: 30,
        audioDurationSeconds: 0.1, // 3 frames for 100 images
        perImageDurationSeconds: 3,
        transitionSeconds: 0,
        transitionId: "cut",
      }),
    ).toThrow(/audio/i)
  })

  it("override arrays of the wrong length are rejected", () => {
    expect(() =>
      computeSlideshowPlan({
        imageCount: 3,
        fps: 30,
        audioDurationSeconds: 10,
        perImageDurationSeconds: 3,
        overrides: [1, 2],
        transitionSeconds: 0,
        transitionId: "cut",
      }),
    ).toThrow(/overrides/i)
  })
})

describe("computeSlideshowPlan — override sanitization (unguarded workflow-JSON path)", () => {
  it("non-numeric / non-finite / non-positive override entries degrade to auto, never NaN-cascade", () => {
    const plan = computeSlideshowPlan({
      imageCount: 4,
      fps: 30,
      audioDurationSeconds: 12,
      perImageDurationSeconds: 3,
      overrides: ["evil" as unknown as number, Number.NaN, -5, 6],
      transitionSeconds: 0,
      transitionId: "cut",
    })
    // The one valid pin (6s = 180f) holds; the three garbage entries are auto.
    expect(plan.slotFrames[3]).toBe(180)
    expect(sum(plan.slotFrames)).toBe(360)
    for (const f of plan.slotFrames) {
      expect(Number.isInteger(f)).toBe(true)
      expect(f).toBeGreaterThan(0)
    }
  })

  it("a fully-garbage overrides array degrades to the equal split", () => {
    const plan = computeSlideshowPlan({
      imageCount: 3,
      fps: 30,
      audioDurationSeconds: 9,
      perImageDurationSeconds: 3,
      overrides: ["a", "b", "c"] as unknown as number[],
      transitionSeconds: 0,
      transitionId: "cut",
    })
    expect(plan.slotFrames).toEqual([90, 90, 90])
    expect(plan.scaleFactor).toBeNull()
  })
})

describe("resolveSlideMotion — alternate flips zoom-in / zoom-out per slide", () => {
  it("alternate: even index → zoom-in, odd → zoom-out", () => {
    expect(resolveSlideMotion("alternate", 0)).toBe("zoom-in")
    expect(resolveSlideMotion("alternate", 1)).toBe("zoom-out")
    expect(resolveSlideMotion("alternate", 2)).toBe("zoom-in")
    expect(resolveSlideMotion("alternate", 3)).toBe("zoom-out")
  })

  it("fixed motions pass through per slide unchanged", () => {
    for (const m of ["none", "zoom-in", "zoom-out", "ken-burns"] as const) {
      expect(resolveSlideMotion(m, 0)).toBe(m)
      expect(resolveSlideMotion(m, 7)).toBe(m)
    }
  })
})
