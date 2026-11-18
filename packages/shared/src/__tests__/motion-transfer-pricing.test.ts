import { describe, expect, it } from "vitest"
import {
  checkMotionTransferLength,
  motionTransferBilledSeconds,
  motionTransferEstimatePrice,
  motionTransferEstimateSeconds,
  motionTransferMaxSec,
  motionTransferPrice,
  motionTransferRateOf,
  MOTION_TRANSFER_RATE_IDS,
} from "../motion-transfer-pricing.js"

describe("Motion Transfer pricing from the measured driving video", () => {
  describe("billed seconds", () => {
    it("rounds the measured length up to a whole second", () => {
      expect(motionTransferBilledSeconds(3)).toBe(3)
      expect(motionTransferBilledSeconds(3.2)).toBe(4)
      expect(motionTransferBilledSeconds(9.5)).toBe(10)
    })
    it("forgives up to 0.05 s past a whole second", () => {
      expect(motionTransferBilledSeconds(10.05)).toBe(10)
      expect(motionTransferBilledSeconds(10.04)).toBe(10)
      expect(motionTransferBilledSeconds(10.06)).toBe(11)
    })
  })

  describe("limits", () => {
    it("Kling 2.6 and Kling 3.0 take 10 s keeping the image's orientation (the default), 30 s following the video's", () => {
      for (const provider of ["kling", "kling-3.0"]) {
        expect(motionTransferMaxSec(provider, undefined)).toBe(10)
        expect(motionTransferMaxSec(provider, "image")).toBe(10)
        expect(motionTransferMaxSec(provider, "bogus")).toBe(10)
        expect(motionTransferMaxSec(provider, "video")).toBe(30)
      }
    })
    it("Wan Animate takes 30 s whatever the orientation", () => {
      expect(motionTransferMaxSec("wan-animate-move", "image")).toBe(30)
      expect(motionTransferMaxSec("wan-animate-replace", undefined)).toBe(30)
    })
    it("refuses a clip under 3 s", () => {
      const r = checkMotionTransferLength("kling", "image", 2.9)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.code).toBe("video_too_short")
        expect(r.message).toContain("at least 3 seconds")
      }
    })
    it("refuses a clip past the limit, naming it and asking to trim", () => {
      const r = checkMotionTransferLength("kling-3.0", "image", 12)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.code).toBe("video_too_long")
        expect(r.message).toContain("at most 10 seconds")
        expect(r.message).toContain("Trim the video first")
      }
      const v = checkMotionTransferLength("kling-3.0", "video", 31)
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.message).toContain("at most 30 seconds")
      expect(checkMotionTransferLength("wan-animate-move", "image", 30.5).ok).toBe(false)
    })
    it("accepts a clip within 0.05 s past the limit and bills it at the limit", () => {
      expect(checkMotionTransferLength("kling", "image", 10.05)).toEqual({ ok: true, billedSeconds: 10 })
      expect(checkMotionTransferLength("kling", "image", 10.06).ok).toBe(false)
      expect(checkMotionTransferLength("kling-3.0", "video", 30.04)).toEqual({ ok: true, billedSeconds: 30 })
    })
    it("accepts 3 s exactly", () => {
      expect(checkMotionTransferLength("kling", "image", 3)).toEqual({ ok: true, billedSeconds: 3 })
    })
  })

  describe("Kling 3.0 at 720p: a per-second rate", () => {
    it("is charged its four-second row × billed seconds ÷ 4", () => {
      expect(motionTransferPrice("kling-3.0", "720p", 10)).toEqual({ creditId: "kling-3.0-motion:720p:per-4s", units: 2.5 })
      expect(motionTransferPrice("kling-3.0", "720p", 3)).toEqual({ creditId: "kling-3.0-motion:720p:per-4s", units: 0.75 })
    })
    it("worked examples: 10 s → 570 base credits, 3 s → 171 (the 228 row)", () => {
      const row = 228
      const base = (sec: number) => Math.ceil(row * (motionTransferPrice("kling-3.0", "720p", sec).units ?? 1))
      expect(base(10)).toBe(570)
      expect(base(3)).toBe(171)
    })
    it("any size but 1080p is charged as 720p, so it is on the rate too", () => {
      expect(motionTransferRateOf("kling-3.0", "480p")?.rateId).toBe("kling-3.0-motion:720p:per-4s")
      expect(motionTransferRateOf("kling-3.0", "580p")?.rateId).toBe("kling-3.0-motion:720p:per-4s")
      expect(motionTransferRateOf("kling-3.0", undefined)?.rateId).toBe("kling-3.0-motion:720p:per-4s")
    })
    it("lists its row", () => {
      expect(MOTION_TRANSFER_RATE_IDS).toEqual(["kling-3.0-motion:720p:per-4s"])
    })
  })

  describe("every other model and size keeps its rows, read from the measured length", () => {
    it("Kling 3.0 at 1080p: its tiers", () => {
      expect(motionTransferRateOf("kling-3.0", "1080p")).toBeUndefined()
      expect(motionTransferPrice("kling-3.0", "1080p", 4)).toEqual({ creditId: "kling-3.0-motion:1080p:5s" })
      expect(motionTransferPrice("kling-3.0", "1080p", 6)).toEqual({ creditId: "kling-3.0-motion:1080p:10s" })
      expect(motionTransferPrice("kling-3.0", "1080p", 30)).toEqual({ creditId: "kling-3.0-motion:1080p:30s" })
    })
    it("Kling 2.6: its tiers at both sizes", () => {
      expect(motionTransferRateOf("kling", "720p")).toBeUndefined()
      expect(motionTransferPrice("kling", "720p", 5)).toEqual({ creditId: "motion-transfer:5s" })
      expect(motionTransferPrice("kling", "720p", 11)).toEqual({ creditId: "motion-transfer:15s" })
      expect(motionTransferPrice("kling", "1080p", 10)).toEqual({ creditId: "motion-transfer:1080p:10s" })
    })
    it("a measured 10.5 s clip is billed 11 s, so a tiered model reads its 15 s tier", () => {
      expect(motionTransferPrice("kling", "720p", motionTransferBilledSeconds(10.5))).toEqual({ creditId: "motion-transfer:15s" })
    })
    it("Wan Animate: flat by size, whatever the length", () => {
      expect(motionTransferPrice("wan-animate-move", "480p", 30)).toEqual({ creditId: "wan-animate-move" })
      expect(motionTransferPrice("wan-animate-replace", "720p", 3)).toEqual({ creditId: "wan-animate-replace:720p" })
      expect(motionTransferPrice("wan-animate-move", "1080p", 5)).toEqual({ creditId: "wan-animate-move:720p" })
    })
  })

  describe("estimates", () => {
    it("quote the known length, billed as a run bills it, at most the limit", () => {
      expect(motionTransferEstimateSeconds("kling-3.0", "image", 6.2)).toBe(7)
      expect(motionTransferEstimateSeconds("kling-3.0", "image", 25)).toBe(10)
      expect(motionTransferEstimateSeconds("kling-3.0", "video", 25)).toBe(25)
    })
    it("quote the orientation's limit when the length is unknown", () => {
      expect(motionTransferEstimateSeconds("kling-3.0", undefined, undefined)).toBe(10)
      expect(motionTransferEstimateSeconds("kling-3.0", "video", null)).toBe(30)
      expect(motionTransferEstimatePrice("kling-3.0", "720p", "image", undefined)).toEqual({
        creditId: "kling-3.0-motion:720p:per-4s",
        units: 2.5,
        lengthKnown: false,
      })
      expect(motionTransferEstimatePrice("kling", "720p", "video", undefined)).toEqual({ creditId: "motion-transfer:30s", lengthKnown: false })
    })
    it("never quotes below a run of the same clip", () => {
      for (let tenth = 30; tenth <= 300; tenth++) {
        const sec = tenth / 10
        for (const orientation of ["image", "video"]) {
          const run = checkMotionTransferLength("kling-3.0", orientation, sec)
          if (!run.ok) continue
          expect(motionTransferEstimateSeconds("kling-3.0", orientation, sec)).toBeGreaterThanOrEqual(run.billedSeconds)
        }
      }
    })
  })
})
