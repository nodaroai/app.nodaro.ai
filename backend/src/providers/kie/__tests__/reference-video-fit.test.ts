import { describe, it, expect } from "vitest"
import { VIDEO_REF_VIDEO_PICTURE_LIMITS, refVideoAspectProblem } from "@nodaro/shared/models"
import {
  fittedReferenceSize,
  referenceVideoFitFilter,
  referenceVideoFitFps,
  referenceVideoFitPeakShape,
} from "../reference-video-fit.js"

// Decided 2026-11-16: every reference video sent to a model with a picture
// window (Seedance 2.5 Flash: 409,600–927,408 pixels, 24–60 fps) is fitted
// into it by the provider's re-encode; every other model's clip is untouched.

const FLASH = "seedance-2-5-flash"
const limit = VIDEO_REF_VIDEO_PICTURE_LIMITS[FLASH]!

describe("the window", () => {
  it("is Flash's documented one, and no other model has one", () => {
    expect(limit).toEqual({ minPixels: 409_600, maxPixels: 927_408, minAspect: 0.4, maxAspect: 2.5, minFps: 24, maxFps: 60 })
    expect(Object.keys(VIDEO_REF_VIDEO_PICTURE_LIMITS)).toEqual([FLASH])
    for (const other of ["seedance-2-5", "seedance-2", "kling-4", "minimax-h3"]) {
      expect(referenceVideoFitFilter(other, { fpsRational: "120/1" }), other).toBeUndefined()
      expect(fittedReferenceSize(other, 1920, 1080), other).toBeUndefined()
    }
  })
})

describe("the size", () => {
  it("scales 1080p and 4K down, small clips up, and leaves 720p-class clips as they are", () => {
    expect(fittedReferenceSize(FLASH, 1920, 1080)).toEqual({ width: 1284, height: 722 })
    expect(fittedReferenceSize(FLASH, 3840, 2160)).toEqual({ width: 1284, height: 722 })
    expect(fittedReferenceSize(FLASH, 1080, 1920)).toEqual({ width: 722, height: 1284 })
    expect(fittedReferenceSize(FLASH, 640, 360)).toEqual({ width: 854, height: 480 })
    expect(fittedReferenceSize(FLASH, 1280, 720)).toEqual({ width: 1280, height: 720 })
    expect(fittedReferenceSize(FLASH, 854, 480)).toEqual({ width: 854, height: 480 })
  })

  // The size is judged on the picture after its odd sides are cut, which is
  // what the scale reads: 641×361 is 640×360 (under the window), 427×960 is
  // 426×960 (under it too, though 427×960 is inside it).
  it("judges an odd-sized picture on its even-cut sides", () => {
    expect(fittedReferenceSize(FLASH, 641, 361)).toEqual({ width: 854, height: 480 })
    const tall = fittedReferenceSize(FLASH, 427, 960)!
    expect(tall.width * tall.height).toBeGreaterThanOrEqual(limit.minPixels)
    expect(427 * 960).toBeGreaterThanOrEqual(limit.minPixels)
    expect(426 * 960).toBeLessThan(limit.minPixels)
  })

  // Decided 2026-11-16: a picture at exactly 2.5:1 (or 1:2.5) rounded side by
  // side came out at 1522×608 (2.503:1); the crop after the scale brings it back.
  it("keeps a picture at the very edge of the allowed shapes inside them", () => {
    for (const [w, h] of [[1920, 768], [2400, 960], [2500, 1000], [3840, 1536]] as const) {
      expect(fittedReferenceSize(FLASH, w, h), `${w}×${h}`).toEqual({ width: 1520, height: 608 })
      expect(fittedReferenceSize(FLASH, h, w), `${h}×${w}`).toEqual({ width: 608, height: 1520 })
    }
  })

  it("brute force: every size of a shape Flash takes, odd and even, lands inside the window and the allowed shapes with even sides", () => {
    let cases = 0
    for (let w = 64; w <= 4096; w += 7) {
      for (let h = 64; h <= 4096; h += 11) {
        if (refVideoAspectProblem(FLASH, w, h)) continue
        const out = fittedReferenceSize(FLASH, w, h)!
        const pixels = out.width * out.height
        const ratio = out.width / out.height
        if (
          pixels < limit.minPixels || pixels > limit.maxPixels || out.width % 2 !== 0 || out.height % 2 !== 0 ||
          ratio < limit.minAspect || ratio > limit.maxAspect
        ) {
          throw new Error(`${w}×${h} → ${out.width}×${out.height} (${pixels} px)`)
        }
        const before = (w - (w % 2)) / (h - (h % 2))
        if (Math.abs(out.width / out.height - before) / before > 0.02) throw new Error(`${w}×${h}: shape ${before} → ${out.width / out.height}`)
        cases++
      }
    }
    expect(cases).toBeGreaterThan(100_000)
  })
})

describe("the frame rate", () => {
  it("moves a constant rate outside 24–60 fps to the nearest bound and keeps one inside it", () => {
    const constant = (r: string) => ({ fpsRational: r, nominalFpsRational: r })
    expect(referenceVideoFitFps(limit, constant("24000/1001"))).toBe(24)
    expect(referenceVideoFitFps(limit, constant("15/1"))).toBe(24)
    expect(referenceVideoFitFps(limit, constant("120/1"))).toBe(60)
    expect(referenceVideoFitFps(limit, constant("240/1"))).toBe(60)
    for (const kept of ["24/1", "25/1", "30000/1001", "60/1", "60000/1001"]) {
      expect(referenceVideoFitFps(limit, constant(kept)), kept).toBeUndefined()
    }
  })

  // Decided 2026-11-16: a variable-rate clip (no constant rate) is set to its
  // nominal rate held in the window, which also makes it constant-rate.
  it("sets a variable-rate clip to its nominal rate, held in the window; a clip with no readable rate is left alone", () => {
    expect(referenceVideoFitFps(limit, { nominalFpsRational: "120/1" })).toBe(60)
    expect(referenceVideoFitFps(limit, { nominalFpsRational: "30/1" })).toBe(30)
    expect(referenceVideoFitFps(limit, { nominalFpsRational: "5/1" })).toBe(24)
    // A constant rate inside the window with a nominal one outside it is set too.
    expect(referenceVideoFitFps(limit, { fpsRational: "30/1", nominalFpsRational: "90000/1" })).toBe(30)
    for (const none of [{}, { fpsRational: "0/0" }, { nominalFpsRational: "nonsense" }]) {
      expect(referenceVideoFitFps(limit, none), JSON.stringify(none)).toBeUndefined()
    }
  })
})

describe("the filter", () => {
  it("cuts odd sides to even, scales into the window in ffmpeg's terms, and moves a frame rate only when it must", () => {
    const filter = referenceVideoFitFilter(FLASH, { fpsRational: "30/1", nominalFpsRational: "30/1" })!
    expect(filter.startsWith("crop=trunc(iw/2)*2:trunc(ih/2)*2,scale=w=")).toBe(true)
    expect(filter).toContain(`gt(iw*ih\\,${limit.maxPixels})`)
    expect(filter).toContain(`lt(iw*ih\\,${limit.minPixels})`)
    expect(filter).not.toContain("fps=")
    expect(filter).toContain(`crop=w=min(iw\\,trunc(ih*${limit.maxAspect}/2)*2)`)
    expect(referenceVideoFitFilter(FLASH, { fpsRational: "120/1" })!.endsWith(",fps=60")).toBe(true)
    expect(referenceVideoFitFilter(FLASH, { fpsRational: "24000/1001" })!.endsWith(",fps=24")).toBe(true)
    expect(referenceVideoFitFilter(FLASH, { nominalFpsRational: "120/1" })!.endsWith(",fps=60")).toBe(true)
    // A clip whose size and rate the probe could not read is still fitted: the scale reads the picture itself.
    expect(referenceVideoFitFilter(FLASH, {})).toBe(filter)
  })

  it("admits the encode at least at the window's top size", () => {
    const shape = referenceVideoFitPeakShape(FLASH)!
    expect(shape.width * shape.height).toBeGreaterThanOrEqual(limit.maxPixels)
    expect(referenceVideoFitPeakShape("seedance-2-5")).toBeUndefined()
  })
})

describe("the shape a model refuses", () => {
  it("refuses a clip wider than 2.5:1 or taller than 1:2.5 on Flash, with the clip's own size in the sentence", () => {
    expect(refVideoAspectProblem(FLASH, 3840, 1080)).toMatch(/1:2\.5 to 2\.5:1.*3840×1080 \(3\.56:1\)/)
    expect(refVideoAspectProblem(FLASH, 400, 1080)).toMatch(/400×1080 \(1:2\.7\)/)
    for (const [w, h] of [[1920, 1080], [1080, 1920], [2500, 1000], [1000, 2500], [1, 1]] as const) {
      expect(refVideoAspectProblem(FLASH, w, h), `${w}×${h}`).toBeUndefined()
    }
  })

  it("never refuses a size that is not known, nor a model with no rule", () => {
    expect(refVideoAspectProblem(FLASH, undefined, 1080)).toBeUndefined()
    expect(refVideoAspectProblem(FLASH, 0, 1080)).toBeUndefined()
    expect(refVideoAspectProblem("seedance-2-5", 3840, 1080)).toBeUndefined()
  })
})
