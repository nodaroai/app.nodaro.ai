import { describe, it, expect } from "vitest"
import {
  VIDEO_OVERLAY_PRICING,
  VIDEO_OVERLAY_REMEASURE_SLACK_SEC,
  videoOverlayBaseTooLong,
  videoOverlayCreditId,
  videoOverlayVideoUnits,
} from "../credit-estimators/video-overlay.js"
import { VIDEO_OVERLAY_VIDEO_MAX_BASE_SEC } from "../video-overlay.js"

describe("Video Overlay pricing", () => {
  it("an image-only run is the flat row; a run with a video layer is the per-5-second row", () => {
    expect(videoOverlayCreditId(false)).toBe("video-overlay")
    expect(videoOverlayCreditId(true)).toBe("video-overlay:video")
    expect(VIDEO_OVERLAY_PRICING.IMAGE_CREDIT_ID).toBe("video-overlay")
    expect(VIDEO_OVERLAY_PRICING.VIDEO_CREDIT_ID).toBe("video-overlay:video")
    expect(VIDEO_OVERLAY_PRICING.UNIT_SEC).toBe(5)
    expect(VIDEO_OVERLAY_PRICING.MAX_BASE_SEC).toBe(VIDEO_OVERLAY_VIDEO_MAX_BASE_SEC)
  })

  it("one unit per started 5 seconds of the base, at least one", () => {
    expect(videoOverlayVideoUnits(0.5)).toBe(1)
    expect(videoOverlayVideoUnits(5)).toBe(1)
    expect(videoOverlayVideoUnits(5.5)).toBe(2)
    expect(videoOverlayVideoUnits(10)).toBe(2)
    expect(videoOverlayVideoUnits(23)).toBe(5)
    expect(videoOverlayVideoUnits(60)).toBe(12)
  })

  it("a cut a hair past a whole second is priced as that second (the clip rule)", () => {
    expect(videoOverlayVideoUnits(10.012)).toBe(2)
    expect(videoOverlayVideoUnits(60.04)).toBe(12)
  })

  it("an unknown length is quoted at the 60 s cap — 12 units, never below a run", () => {
    expect(videoOverlayVideoUnits(undefined)).toBe(12)
    expect(videoOverlayVideoUnits(null)).toBe(12)
    expect(videoOverlayVideoUnits(Number.NaN)).toBe(12)
    expect(videoOverlayVideoUnits(0)).toBe(12)
    expect(videoOverlayVideoUnits(-3)).toBe(12)
  })

  it("a length past the cap counts the cap (such a base is refused before anything is reserved)", () => {
    expect(videoOverlayVideoUnits(61)).toBe(12)
    expect(videoOverlayVideoUnits(600)).toBe(12)
  })

  it("the cap reads the priced seconds: 60.04 s is in, 60.06 s and 61 s are out", () => {
    expect(videoOverlayBaseTooLong(10)).toBe(false)
    expect(videoOverlayBaseTooLong(60)).toBe(false)
    expect(videoOverlayBaseTooLong(60.04)).toBe(false)
    expect(videoOverlayBaseTooLong(60.06)).toBe(true)
    expect(videoOverlayBaseTooLong(61)).toBe(true)
  })
})

describe("the worker's re-measure slack", () => {
  it("is half a second, on the seconds", () => {
    expect(VIDEO_OVERLAY_REMEASURE_SLACK_SEC).toBe(0.5)
  })
})
