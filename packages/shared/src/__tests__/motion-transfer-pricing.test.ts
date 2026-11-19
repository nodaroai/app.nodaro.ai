import { describe, expect, it } from "vitest"
import {
  checkMotionTransferLength,
  motionTransferBilledSeconds,
  motionTransferEstimatePrice,
  motionTransferEstimateSeconds,
  motionTransferMaxSec,
  motionTransferPrice,
  motionTransferRateOf,
  motionTransferBaseCharge,
  motionTransferChargedPrice,
  MOTION_TRANSFER_FLOOR_IDS,
  MOTION_TRANSFER_RATE_IDS,
  MOTION_TRANSFER_SECOND_RATES,
} from "../motion-transfer-pricing.js"
import { motionTransferResolution } from "../credit-identifiers.js"

/** The rows as they are seeded (migrations 668 and 670, and the flat Wan Animate rows they never change). */
const ROWS: Record<string, number> = {
  "motion-transfer:720p:per-4s": 126,
  "motion-transfer:1080p:per-4s": 203,
  "kling-3.0-motion:720p:per-4s": 228,
  "kling-3.0-motion:1080p:per-4s": 302,
  "wan-animate-replace:480p:per-4s": 60,
  "wan-animate-replace:580p:per-4s": 95,
  "wan-animate-replace:720p:per-4s": 125,
  "wan-animate-move:720p:per-4s": 125,
  "wan-animate-move": 255,
  "wan-animate-move:580p": 330,
  "wan-animate-move:720p": 410,
  "wan-animate-replace": 255,
  "wan-animate-replace:580p": 330,
  "wan-animate-replace:720p": 410,
}
/** The base credits and the row a run of `seconds` billed seconds is charged at the seeded rows. */
const charge = (provider: string, resolution: string, seconds: number) => motionTransferBaseCharge(motionTransferPrice(provider, resolution, seconds), (id) => ROWS[id])

describe("Motion Transfer pricing from the driving video's length", () => {
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
      expect(charge("kling-3.0", "720p", 10)).toEqual({ creditId: "kling-3.0-motion:720p:per-4s", units: 2.5, baseCredits: 570 })
      expect(charge("kling-3.0", "720p", 3).baseCredits).toBe(171)
    })
    it("any size but 1080p is charged as 720p, so it is on the rate too", () => {
      expect(motionTransferRateOf("kling-3.0", "480p").rateId).toBe("kling-3.0-motion:720p:per-4s")
      expect(motionTransferRateOf("kling-3.0", "580p").rateId).toBe("kling-3.0-motion:720p:per-4s")
      expect(motionTransferRateOf("kling-3.0", undefined).rateId).toBe("kling-3.0-motion:720p:per-4s")
    })
  })

  describe("every model and size is charged per second (decided 2026-11-18)", () => {
    it("lists every rate row once and every floor row once", () => {
      expect([...MOTION_TRANSFER_RATE_IDS].sort()).toEqual([
        "kling-3.0-motion:1080p:per-4s",
        "kling-3.0-motion:720p:per-4s",
        "motion-transfer:1080p:per-4s",
        "motion-transfer:720p:per-4s",
        "wan-animate-move:720p:per-4s",
        "wan-animate-replace:480p:per-4s",
        "wan-animate-replace:580p:per-4s",
        "wan-animate-replace:720p:per-4s",
      ])
      expect([...MOTION_TRANSFER_FLOOR_IDS].sort()).toEqual([
        "wan-animate-move:720p",
        "wan-animate-replace",
        "wan-animate-replace:580p",
        "wan-animate-replace:720p",
      ])
    })
    it("every size a model runs at has a rate, and no rate is a length tier", () => {
      for (const provider of ["kling", "kling-3.0", "wan-animate-move", "wan-animate-replace"]) {
        for (const size of ["480p", "580p", "720p", "1080p", undefined]) {
          const sized = motionTransferResolution(provider, size ?? "720p").resolution
          const rate = motionTransferRateOf(provider, size)
          expect(rate.rateId).toMatch(/:per-4s$/)
          if (provider.startsWith("wan-")) expect(Object.prototype.hasOwnProperty.call(MOTION_TRANSFER_SECOND_RATES, `${provider}:${sized}`)).toBe(true)
        }
      }
    })
    it("a model Motion Transfer does not have is priced as its default, Kling 2.6", () => {
      expect(motionTransferRateOf("bogus", "720p").rateId).toBe("motion-transfer:720p:per-4s")
      expect(motionTransferRateOf(undefined, "1080p").rateId).toBe("motion-transfer:1080p:per-4s")
    })
    it("Kling 2.6: 126 base credits per 4 s at 720p, 203 at 1080p, no floor", () => {
      expect(charge("kling", "720p", 10)).toEqual({ creditId: "motion-transfer:720p:per-4s", units: 2.5, baseCredits: 315 })
      expect(charge("kling", "720p", 3).baseCredits).toBe(95)
      expect(charge("kling", "1080p", 10)).toEqual({ creditId: "motion-transfer:1080p:per-4s", units: 2.5, baseCredits: 508 })
      expect(charge("kling", "1080p", 30).baseCredits).toBe(1523)
      expect(charge("kling", "480p", 5).creditId).toBe("motion-transfer:720p:per-4s")
    })
    it("Kling 3.0 at 1080p: 302 base credits per 4 s, no floor", () => {
      expect(charge("kling-3.0", "1080p", 10)).toEqual({ creditId: "kling-3.0-motion:1080p:per-4s", units: 2.5, baseCredits: 755 })
      expect(charge("kling-3.0", "1080p", 3).baseCredits).toBe(227)
    })
    it("a 10.5 s clip is billed 11 s", () => {
      expect(charge("kling", "720p", motionTransferBilledSeconds(10.5)).baseCredits).toBe(Math.ceil((126 * 11) / 4))
    })
  })

  describe("Wan Animate: per second, never below today's flat price for the size", () => {
    it("Replace 720p: 3 s stays at today's 410; 30 s is ceil(125 × 30 ÷ 4) = 938", () => {
      expect(charge("wan-animate-replace", "720p", 3)).toEqual({ creditId: "wan-animate-replace:720p", baseCredits: 410 })
      expect(charge("wan-animate-replace", "720p", 30)).toEqual({ creditId: "wan-animate-replace:720p:per-4s", units: 7.5, baseCredits: 938 })
    })
    // Each floored row on both sides of the length where the rate passes it.
    it.each([
      ["wan-animate-replace", "480p", 17, "wan-animate-replace", 255, 18, 270],
      ["wan-animate-replace", "580p", 13, "wan-animate-replace:580p", 330, 14, 333],
      ["wan-animate-replace", "720p", 13, "wan-animate-replace:720p", 410, 14, 438],
      ["wan-animate-move", "720p", 13, "wan-animate-move:720p", 410, 14, 438],
      ["wan-animate-move", "480p", 13, "wan-animate-move:720p", 410, 14, 438],
      ["wan-animate-move", "580p", 13, "wan-animate-move:720p", 410, 14, 438],
    ] as const)("%s %s: %d s is the floor row, %d s past it the rate", (provider, size, onFloor, floorId, floorBase, past, pastBase) => {
      expect(charge(provider, size, onFloor)).toEqual({ creditId: floorId, baseCredits: floorBase })
      expect(charge(provider, size, past)).toMatchObject({ creditId: motionTransferRateOf(provider, size).rateId, units: past / 4, baseCredits: pastBase })
    })
    it("a tie goes to the floor row: Replace 480p at 17 s is 255 either way", () => {
      expect(Math.ceil((60 * 17) / 4)).toBe(255)
      expect(charge("wan-animate-replace", "480p", 17).creditId).toBe("wan-animate-replace")
    })
    it("Move runs at 720p only: any size it names is sent and charged as 720p, floored at the 720p row", () => {
      for (const size of ["480p", "580p", "720p", "1080p"]) {
        expect(motionTransferResolution("wan-animate-move", size).resolution).toBe("720p")
        expect(motionTransferRateOf("wan-animate-move", size)).toEqual({ rateId: "wan-animate-move:720p:per-4s", rateSeconds: 4, floorId: "wan-animate-move:720p" })
      }
      expect(charge("wan-animate-move", "480p", 30)).toMatchObject({ creditId: "wan-animate-move:720p:per-4s", baseCredits: 938 })
      expect(charge("wan-animate-move", "480p", 5)).toEqual({ creditId: "wan-animate-move:720p", baseCredits: 410 })
    })
    it("Replace keeps its three sizes", () => {
      for (const size of ["480p", "580p", "720p"]) expect(motionTransferResolution("wan-animate-replace", size).resolution).toBe(size)
    })
    it("a 1080p request runs, and is charged, as 720p", () => {
      expect(motionTransferRateOf("wan-animate-replace", "1080p")).toEqual({ rateId: "wan-animate-replace:720p:per-4s", rateSeconds: 4, floorId: "wan-animate-replace:720p" })
    })
    it("the floor rule reads charged figures the same way (the editor's)", () => {
      const price = motionTransferPrice("wan-animate-replace", "720p", 10)
      expect(motionTransferChargedPrice(price, { perSecond: 360, floor: 472 })).toEqual({ creditId: "wan-animate-replace:720p" })
      expect(motionTransferChargedPrice(price, { perSecond: 500, floor: 472 })).toEqual({ creditId: "wan-animate-replace:720p:per-4s", units: 2.5 })
    })
    it("a row priced nowhere leaves the rate, whose own lookup refuses it", () => {
      const price = motionTransferPrice("wan-animate-replace", "720p", 3)
      expect(motionTransferChargedPrice(price, { perSecond: undefined, floor: 410 })).toEqual({ creditId: "wan-animate-replace:720p:per-4s", units: 0.75 })
      expect(motionTransferChargedPrice(price, { perSecond: 94, floor: undefined })).toEqual({ creditId: "wan-animate-replace:720p:per-4s", units: 0.75 })
    })
    it("the charge never falls as the clip grows, and is never below the floor", () => {
      for (const [provider, size] of [["wan-animate-replace", "480p"], ["wan-animate-replace", "580p"], ["wan-animate-replace", "720p"], ["wan-animate-move", "480p"], ["wan-animate-move", "720p"]] as const) {
        const floor = ROWS[motionTransferRateOf(provider, size).floorId!]!
        let last = 0
        for (let sec = 3; sec <= 30; sec++) {
          const base = charge(provider, size, sec).baseCredits!
          expect(base).toBeGreaterThanOrEqual(Math.max(last, floor))
          last = base
        }
      }
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
      expect(motionTransferEstimatePrice("kling", "720p", "video", undefined)).toEqual({ creditId: "motion-transfer:720p:per-4s", units: 7.5, lengthKnown: false })
      expect(motionTransferEstimatePrice("wan-animate-move", "480p", "image", undefined)).toEqual({
        creditId: "wan-animate-move:720p:per-4s",
        units: 7.5,
        floorId: "wan-animate-move:720p",
        lengthKnown: false,
      })
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
