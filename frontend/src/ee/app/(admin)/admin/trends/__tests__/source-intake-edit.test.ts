/** The new source clip's edit as data: what it opens on, and the cut asked of the platform. */
import { describe, expect, it } from "vitest"
import { CUT_MAX_SEC, cutRequest, evenCrop, initialEdit, isNoEdit, rangeFits } from "../components/source-intake/edit"

const SRC = "https://cdn.test/u/clip.mp4"

describe("initialEdit", () => {
  it("opens on the whole clip, or its first 30 s, uncropped", () => {
    expect(initialEdit(12.34)).toEqual({ startSec: 0, endSec: 12.3, ratio: "original", crop: null })
    expect(initialEdit(95)).toEqual({ startSec: 0, endSec: 30, ratio: "original", crop: null })
  })
})

describe("cutRequest", () => {
  it("nothing to cut: the whole clip, uncropped, within 30 s", () => {
    expect(cutRequest(SRC, initialEdit(12), 12)).toBeNull()
    expect(cutRequest(SRC, initialEdit(30), 30)).toBeNull()
    expect(isNoEdit(initialEdit(12), 12)).toBe(true)
  })

  it("a range is sent as a trim, a crop as natural pixels", () => {
    expect(cutRequest(SRC, { startSec: 2, endSec: 9.5, ratio: "9:16", crop: { x: 10, y: 0, width: 600, height: 1080 } }, 20)).toEqual({
      sourceUrl: SRC,
      type: "video",
      trim: { startTime: 2, endTime: 9.5 },
      crop: { x: 10, y: 0, width: 600, height: 1080 },
    })
  })

  it("a crop of the whole clip sends no trim", () => {
    expect(cutRequest(SRC, { ...initialEdit(12), ratio: "1:1", crop: { x: 420, y: 0, width: 1080, height: 1080 } }, 12)).toEqual({
      sourceUrl: SRC,
      type: "video",
      crop: { x: 420, y: 0, width: 1080, height: 1080 },
    })
  })

  it("never asks for more than 29.9 s (the re-encode runs a few ms long)", () => {
    expect(CUT_MAX_SEC).toBeCloseTo(29.9)
    expect(cutRequest(SRC, initialEdit(45), 45)?.trim).toEqual({ startTime: 0, endTime: 29.9 })
    expect(cutRequest(SRC, { startSec: 5, endSec: 35, ratio: "original", crop: null }, 60)?.trim).toEqual({ startTime: 5, endTime: 34.9 })
    // A 30.0 s clip only cropped is still held under 30 s.
    expect(cutRequest(SRC, { ...initialEdit(30), ratio: "1:1", crop: { x: 0, y: 0, width: 1080, height: 1080 } }, 30)?.trim).toEqual({ startTime: 0, endTime: 29.9 })
  })
})

describe("evenCrop", () => {
  const natural = { width: 1920, height: 1080 }
  it("whole, even pixels inside the frame", () => {
    expect(evenCrop({ x: 655.6, y: -3, width: 607.4, height: 1081 }, natural)).toEqual({ x: 656, y: 0, width: 606, height: 1080 })
  })
  it("the whole frame is no crop", () => {
    expect(evenCrop({ x: 0, y: 0, width: 1920, height: 1080 }, natural)).toBeNull()
    expect(evenCrop(null, natural)).toBeNull()
  })
})

describe("rangeFits", () => {
  it("4–30 s", () => {
    expect(rangeFits({ startSec: 0, endSec: 3.9, ratio: "original", crop: null })).toBe(false)
    expect(rangeFits({ startSec: 1, endSec: 5, ratio: "original", crop: null })).toBe(true)
    expect(rangeFits({ startSec: 0, endSec: 30, ratio: "original", crop: null })).toBe(true)
    expect(rangeFits({ startSec: 0, endSec: 31, ratio: "original", crop: null })).toBe(false)
  })
})
