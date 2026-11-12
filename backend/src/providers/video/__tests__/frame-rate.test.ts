import { describe, it, expect } from "vitest"
import { constantFrameRate, parseFrameRate } from "../frame-rate.js"
import * as ffmpegUtils from "../ffmpeg-utils.js"

/**
 * The one frame-rate rule (`../frame-rate.ts`): ffprobe's rational read as
 * frames per second, and the clip's constant rate, or none for a
 * variable-frame-rate clip. `ffmpeg-utils.ts` re-exports it, so every probe
 * reads a rate the same way.
 */

describe("parseFrameRate", () => {
  it("reads ffprobe's rational, and a bare number", () => {
    expect(parseFrameRate("24/1")).toBe(24)
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2)
    expect(parseFrameRate("25")).toBe(25)
    expect(parseFrameRate(" 24/1 ")).toBe(24)
  })

  it("answers undefined for every unusable form, a negative numerator included", () => {
    expect(parseFrameRate("-30/-1")).toBeUndefined()
    expect(parseFrameRate("-30/1")).toBeUndefined()
    expect(parseFrameRate("30/-1")).toBeUndefined()
    expect(parseFrameRate("0/0")).toBeUndefined()
    expect(parseFrameRate("24/0")).toBeUndefined()
    expect(parseFrameRate("")).toBeUndefined()
    expect(parseFrameRate("abc")).toBeUndefined()
    expect(parseFrameRate(undefined)).toBeUndefined()
    expect(parseFrameRate(24)).toBeUndefined()
  })
})

describe("constantFrameRate", () => {
  it("is the average when the nominal rate agrees with it, and whichever reads when only one does", () => {
    expect(constantFrameRate(24, 24)).toBe(24)
    expect(constantFrameRate(29.99, 30)).toBe(29.99)
    expect(constantFrameRate(undefined, 25)).toBe(25)
    expect(constantFrameRate(24, undefined)).toBe(24)
    expect(constantFrameRate(undefined, undefined)).toBeUndefined()
  })

  it("is none for a variable-frame-rate clip (an average of ~6 against a base of 60)", () => {
    expect(constantFrameRate(6, 60)).toBeUndefined()
  })
})

describe("ffmpeg-utils", () => {
  it("re-exports the same rule, not a copy", () => {
    expect(ffmpegUtils.parseFrameRate).toBe(parseFrameRate)
    expect(ffmpegUtils.constantFrameRate).toBe(constantFrameRate)
  })
})
