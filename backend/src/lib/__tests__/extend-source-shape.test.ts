import { describe, expect, it } from "vitest"
import { displayVideoSize, extendSourceAspectProblem } from "../extend-source-shape.js"

// Decided 2026-11-17: Gemini Omni Flash 1.2 Extend continues only 16:9 or 9:16 sources.
describe("extendSourceAspectProblem — Gemini Omni Flash 1.2 Extend", () => {
  const p = "gemini-omni-flash-1-2-extend"

  it("takes 16:9 and 9:16, within 2%", () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1280, 720], [854, 480], [1000, 560]]) {
      expect(extendSourceAspectProblem(p, w, h), `${w}×${h}`).toBeUndefined()
    }
    expect(extendSourceAspectProblem(p, 640, 368)).toBeDefined() // 2.2% under: past the 2%
  })

  it("refuses 1:1, 4:3, 21:9 and 3:4 in words that name the two shapes and the Seedance engines", () => {
    for (const [w, h] of [[640, 640], [1440, 1080], [2560, 1080], [1080, 1440]] as const) {
      const problem = extendSourceAspectProblem(p, w, h)
      expect(problem, `${w}×${h}`).toBeDefined()
      expect(problem).toContain("16:9 or 9:16")
      expect(problem).toContain("Seedance")
      expect(problem).toContain(`${w}×${h}`)
    }
  })

  it("a quarter-turned source reads the same either way: the two shapes swap into each other", () => {
    // A phone clip stored 1920×1080 with a 90° rotation tag shows 1080×1920.
    expect(extendSourceAspectProblem(p, 1920, 1080)).toBeUndefined()
    expect(extendSourceAspectProblem(p, 1080, 1920)).toBeUndefined()
    expect(extendSourceAspectProblem(p, 1440, 1080)).toBeDefined()
    expect(extendSourceAspectProblem(p, 1080, 1440)).toBeDefined()
  })

  it("never refuses a size it does not know, nor another provider's source", () => {
    expect(extendSourceAspectProblem(p, undefined, 1080)).toBeUndefined()
    expect(extendSourceAspectProblem(p, 0, 0)).toBeUndefined()
    for (const other of ["seedance-2-5-extend", "kling-4-extend", "pixverse-v6-extend"]) {
      expect(extendSourceAspectProblem(other, 640, 640)).toBeUndefined()
    }
  })
})

// Decided 2026-11-17: the shape is judged on the picture as it plays.
describe("displayVideoSize — a probe's size with its sample aspect ratio applied", () => {
  it("widens an anamorphic picture to the size it plays at, so it is taken as 16:9", () => {
    const display = displayVideoSize({ width: 1440, height: 1080, sampleAspectRatio: 4 / 3 })
    expect(display).toEqual({ width: 1920, height: 1080 })
    expect(extendSourceAspectProblem("gemini-omni-flash-1-2-extend", display.width, display.height)).toBeUndefined()
    // The same stored size with square pixels is 4:3.
    expect(extendSourceAspectProblem("gemini-omni-flash-1-2-extend", 1440, 1080)).toBeDefined()
  })

  it("a 16:9 stored size that plays as another shape is refused", () => {
    const display = displayVideoSize({ width: 1920, height: 1080, sampleAspectRatio: 0.75 })
    expect(display).toEqual({ width: 1440, height: 1080 })
    expect(extendSourceAspectProblem("gemini-omni-flash-1-2-extend", display.width, display.height)).toBeDefined()
  })

  it("keeps the stored size with no sample aspect, a 1:1 one, or one that is not a positive number", () => {
    for (const sampleAspectRatio of [undefined, 1, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(displayVideoSize({ width: 1280, height: 720, ...(sampleAspectRatio !== undefined ? { sampleAspectRatio } : {}) })).toEqual({ width: 1280, height: 720 })
    }
  })
})
