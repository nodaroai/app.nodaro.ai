import { describe, expect, it } from "vitest"
import { maskCompositeUnits } from "../mask-composite.js"
import { pricedClipSeconds } from "../priced-clip-seconds.js"
import { VIDEO_DEPTH_LIMITS, checkVideoDepthLength, videoDepthCreditId } from "../video-depth.js"
import { videoFaceMeshCreditId } from "../video-face-mesh.js"
import { videoMaskBilledSeconds, videoMaskCreditId } from "../video-mask.js"

/**
 * A whole-second cut of a 29.97 or 23.976 fps clip can come out a little long:
 * 12 s is 360 frames, a 12.012 s file. Video Depth (both providers), Video Mask,
 * Mask Composite and the face mesh ignore up to 0.05 s past a whole second before
 * they price a clip, so that cut costs what a 12 s clip costs.
 */
const FAL = "video-depth-anything"
const FRAMES = "depth-anything-frames"
const CUTS = [
  [4.004, 4],
  [5.005, 5],
  [10.01, 10],
  [12.012, 12],
  [15.015, 15],
] as const

describe("pricedClipSeconds", () => {
  it.each([
    [4.004, 4],
    [4.05, 4],
    [4.051, 5],
    [12.012, 12],
    [0.02, 1],
    [0.05, 1],
    [0.051, 1],
    [1.05, 1],
    [1.051, 2],
    [9.2, 10],
  ])("%s s is priced as %i", (sec, whole) => {
    expect(pricedClipSeconds(sec)).toBe(whole)
  })

  it("exact whole seconds are unchanged", () => {
    for (let n = 1; n <= 300; n++) expect(pricedClipSeconds(n), `${n}`).toBe(n)
  })

  it("the edge holds at every length: n + 0.05 is n, n + 0.051 is the next second", () => {
    for (let n = 1; n < 300; n++) {
      expect(pricedClipSeconds(n + 0.05), `${n} + 0.05`).toBe(n)
      expect(pricedClipSeconds(n + 0.051), `${n} + 0.051`).toBe(n + 1)
    }
  })

  it("float noise past the edge does not round up: arithmetic can land a hair above n + 0.05", () => {
    // 1.35 s at 90 fps, priced at the 30 fps basis, is 4.050000000000001.
    expect(videoMaskBilledSeconds(1.35, 90)).toBeGreaterThan(4.05)
    expect(pricedClipSeconds(videoMaskBilledSeconds(1.35, 90))).toBe(4)
    expect(32 + 0.02 + 0.03).toBeGreaterThan(32.05)
    expect(pricedClipSeconds(32 + 0.02 + 0.03)).toBe(32)
    expect(videoDepthCreditId(FAL, 32 + 0.02 + 0.03)).toBe(`${FAL}:32s`)
  })
})

describe("Video Depth Anything", () => {
  it.each(CUTS)("a %s s cut is priced at its whole seconds", (sec, whole) => {
    expect(videoDepthCreditId(FAL, sec)).toBe(`${FAL}:${whole}s`)
  })

  it("past the grace is the next second; under a second is one second; whole seconds are unchanged", () => {
    expect(videoDepthCreditId(FAL, 4.051)).toBe(`${FAL}:5s`)
    expect(videoDepthCreditId(FAL, 0.02)).toBe(`${FAL}:1s`)
    for (const n of [1, 4, 15, 60, 300]) expect(videoDepthCreditId(FAL, n)).toBe(`${FAL}:${n}s`)
  })

  it("the 300 s ceiling behaves as before: the top row prices past it and when unknown, and a clip past it is refused", () => {
    expect(videoDepthCreditId(FAL, 300.02)).toBe(`${FAL}:300s`)
    expect(videoDepthCreditId(FAL, 900)).toBe(`${FAL}:300s`)
    expect(videoDepthCreditId(FAL, undefined)).toBe(`${FAL}:300s`)
    expect(checkVideoDepthLength(FAL, { durationSec: 300, fps: 7 }).ok).toBe(true)
    // At 7 fps it is 2,101 frames, under the frame cap: only the 300 s limit can refuse it.
    expect(checkVideoDepthLength(FAL, { durationSec: 300.02, fps: 7 })).toMatchObject({ ok: false, message: expect.stringContaining("at most 300 s") })
  })
})

describe("Depth Anything per frame", () => {
  it.each([
    [4.004, 4],
    [4.1, 5],
    [15, 15],
    [15.015, 15],
    [15.05, 15],
    [15.051, 16],
    [30, 30],
    [30.03, 30],
    [30.05, 30],
    [30.051, 31],
    [60, 60],
    [60.0266, 60],
    [60.05, 60],
    [60.051, 61],
    [61, 61],
    [80, 80],
    [0.02, 1],
  ])("%s s is the %i s price row", (sec, whole) => {
    expect(videoDepthCreditId(FRAMES, sec)).toBe(`${FRAMES}:${whole}s`)
  })

  it("the rule is the one every step has: 60.06 s is 0.06 s past 60, so it is the next second", () => {
    expect(videoDepthCreditId(FRAMES, 60.06)).toBe(`${FRAMES}:61s`)
  })

  it("whole seconds are unchanged, at every length it accepts", () => {
    for (let n = 1; n <= VIDEO_DEPTH_LIMITS.REPLICATE_MAX_SECONDS; n++) {
      expect(videoDepthCreditId(FRAMES, n), `${n}`).toBe(`${FRAMES}:${n}s`)
    }
  })

  it("its limit still reads the file: 80 s is taken, 80.02 s is refused; unknown or past it is the highest reachable row", () => {
    expect(checkVideoDepthLength(FRAMES, { durationSec: 80 }).ok).toBe(true)
    expect(checkVideoDepthLength(FRAMES, { durationSec: 80.02 }).ok).toBe(false)
    expect(videoDepthCreditId(FRAMES, 80.02)).toBe(`${FRAMES}:80s`)
    expect(videoDepthCreditId(FRAMES, undefined)).toBe(`${FRAMES}:80s`)
  })
})

describe("Video Mask", () => {
  it.each([
    [4.004, 5],
    [5.005, 5],
    [10.01, 10],
    [12.012, 15],
    [15.015, 15],
    [5.051, 10],
    [10.051, 15],
    [15.051, 30],
    [0.02, 5],
  ])("%s s is the %i s row, on either model", (sec, row) => {
    expect(videoMaskCreditId(sec)).toBe(`sam-3.1-video:${row}s`)
    expect(videoMaskCreditId(sec, "sam-3")).toBe(`sam-3-video:${row}s`)
  })

  it("the ceiling behaves as before: the top row prices past it and when unknown", () => {
    expect(videoMaskCreditId(300)).toBe("sam-3.1-video:300s")
    expect(videoMaskCreditId(300.02)).toBe("sam-3.1-video:300s")
    expect(videoMaskCreditId(900)).toBe("sam-3.1-video:300s")
    expect(videoMaskCreditId(undefined)).toBe("sam-3.1-video:300s")
  })
})

describe("the face mesh", () => {
  it.each([
    [4.004, 5],
    [5.005, 5],
    [10.01, 10],
    [12.012, 15],
    [15.015, 15],
    [5.051, 10],
    [10.051, 15],
    [15.051, 30],
    [0.02, 5],
  ])("%s s is the %i s row", (sec, row) => {
    expect(videoFaceMeshCreditId(sec)).toBe(`video-face-mesh:${row}s`)
  })

  it("the ceiling behaves as before: the top row prices past it and when unknown", () => {
    expect(videoFaceMeshCreditId(300)).toBe("video-face-mesh:300s")
    expect(videoFaceMeshCreditId(300.02)).toBe("video-face-mesh:300s")
    expect(videoFaceMeshCreditId(undefined)).toBe("video-face-mesh:300s")
  })
})

describe("Mask Composite", () => {
  it.each([
    [4.004, 1],
    [5, 1],
    [5.005, 1],
    [10, 2],
    [10.01, 2],
    [12.012, 3],
    [15, 3],
    [15.015, 3],
    [5.051, 2],
    [10.051, 3],
    [15.051, 4],
    [0.02, 1],
  ])("%s s is %i unit(s)", (sec, units) => {
    expect(maskCompositeUnits(sec)).toBe(units)
  })

  it("the ceiling behaves as before: 60 units at 300 s, past it and when unknown", () => {
    expect(maskCompositeUnits(300)).toBe(60)
    expect(maskCompositeUnits(300.02)).toBe(60)
    expect(maskCompositeUnits(900)).toBe(60)
    expect(maskCompositeUnits(undefined)).toBe(60)
  })
})
