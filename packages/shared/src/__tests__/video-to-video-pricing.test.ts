import { describe, expect, it } from "vitest"
import {
  checkVideoToVideoClipLength,
  isClipPricedV2vProvider,
  V2V_CLIP_RATE_IDS,
  videoToVideoBilledSeconds,
  videoToVideoClipPrice,
  videoToVideoClipRateOf,
  videoToVideoEstimatePrice,
  videoToVideoSentResolution,
  wanVideoEditRateFromSeconds,
} from "../video-to-video-pricing.js"

/** The rows as seeded (STATIC_CREDIT_COSTS / migration 671), base credits. */
const ROWS: Readonly<Record<string, number>> = {
  "wan-videoedit": 320,
  "wan-videoedit:1080p:per-4s": 240,
  "happyhorse-edit:720p:per-4s": 560,
  "happyhorse-edit:1080p:per-4s": 960,
}
const rowOf = (id: string) => ROWS[id]
/** The base a price stands for, as every lane charges it: a rate × units rounded up once, else the flat row. */
const base = (p: { creditId: string; units?: number }) => (p.units === undefined ? ROWS[p.creditId]! : Math.ceil(ROWS[p.creditId]! * p.units))

const priceOf = (provider: "happyhorse-edit" | "wan-videoedit", resolution: unknown, clipSec: number, videoEditDuration?: unknown) => {
  const check = checkVideoToVideoClipLength(provider, clipSec, videoEditDuration)
  if (!check.ok) throw new Error(check.message)
  return videoToVideoClipPrice(provider, resolution, check.billedSeconds, rowOf)
}

describe("Video to Video priced by the clip's length", () => {
  it("only HappyHorse Edit and Wan 2.7 VideoEdit are priced by their clip", () => {
    expect(isClipPricedV2vProvider("happyhorse-edit")).toBe(true)
    expect(isClipPricedV2vProvider("wan-videoedit")).toBe(true)
    for (const other of ["wan", "wan-flash", "runway-aleph", "luma-modify", "seedance-2-5", undefined]) {
      expect(isClipPricedV2vProvider(other)).toBe(false)
      expect(videoToVideoClipRateOf(other, "720p")).toBeUndefined()
    }
    expect(V2V_CLIP_RATE_IDS).toEqual(["happyhorse-edit:720p:per-4s", "happyhorse-edit:1080p:per-4s", "wan-videoedit:1080p:per-4s"])
  })

  describe("HappyHorse Edit", () => {
    it("bills every started half-second of the clip, forgiving float noise only", () => {
      expect(videoToVideoBilledSeconds("happyhorse-edit", 3)).toBe(3)
      expect(videoToVideoBilledSeconds("happyhorse-edit", 3.0000000001)).toBe(3)
      expect(videoToVideoBilledSeconds("happyhorse-edit", 3.01)).toBe(3.5)
      expect(videoToVideoBilledSeconds("happyhorse-edit", 10.04)).toBe(10.5)
      expect(videoToVideoBilledSeconds("happyhorse-edit", 10.5)).toBe(10.5)
    })

    it("worked examples: 3.00 s at 720p = 420, 10.04 s at 720p = 1,470, 3.00 s at 1080p = 720 (base)", () => {
      const a = priceOf("happyhorse-edit", "720p", 3)
      expect(a).toEqual({ creditId: "happyhorse-edit:720p:per-4s", units: 0.75 })
      expect(base(a)).toBe(420)
      const b = priceOf("happyhorse-edit", undefined, 10.04)
      expect(b).toEqual({ creditId: "happyhorse-edit:720p:per-4s", units: 2.625 })
      expect(base(b)).toBe(1470)
      const c = priceOf("happyhorse-edit", "1080p", 3)
      expect(c).toEqual({ creditId: "happyhorse-edit:1080p:per-4s", units: 0.75 })
      expect(base(c)).toBe(720)
      expect(base(priceOf("happyhorse-edit", "720p", 60))).toBe(8400)
    })

    it("prices and sends 720p unless the request says 1080p", () => {
      expect(videoToVideoSentResolution("happyhorse-edit", undefined)).toBe("720p")
      expect(videoToVideoSentResolution("happyhorse-edit", "480p")).toBe("720p")
      expect(videoToVideoSentResolution("happyhorse-edit", "720p")).toBe("720p")
      expect(videoToVideoSentResolution("happyhorse-edit", "1080p")).toBe("1080p")
      expect(videoToVideoClipRateOf("happyhorse-edit", "480p")?.rateId).toBe("happyhorse-edit:720p:per-4s")
      // Every other model's resolution is left as sent.
      expect(videoToVideoSentResolution("wan", "1080p")).toBe("1080p")
      expect(videoToVideoSentResolution("wan-videoedit", undefined)).toBeUndefined()
    })

    it("refuses a clip shorter than 3 s or longer than 60 s, with no grace", () => {
      expect(checkVideoToVideoClipLength("happyhorse-edit", 2.99)).toMatchObject({ ok: false, code: "video_too_short" })
      expect(checkVideoToVideoClipLength("happyhorse-edit", 3)).toEqual({ ok: true, billedSeconds: 3 })
      expect(checkVideoToVideoClipLength("happyhorse-edit", 60)).toEqual({ ok: true, billedSeconds: 60 })
      const long = checkVideoToVideoClipLength("happyhorse-edit", 60.02)
      expect(long).toMatchObject({ ok: false, code: "video_too_long" })
      expect(long.ok ? "" : long.message).toMatch(/at most 60 seconds\. Trim the video first\./)
    })
  })

  describe("Wan 2.7 VideoEdit", () => {
    it("bills the clip it delivers: the clip's length, or the shorter length asked for, whole seconds after 0.05 s", () => {
      expect(videoToVideoBilledSeconds("wan-videoedit", 6, "0")).toBe(6)
      expect(videoToVideoBilledSeconds("wan-videoedit", 6, undefined)).toBe(6)
      expect(videoToVideoBilledSeconds("wan-videoedit", 6.05)).toBe(6)
      expect(videoToVideoBilledSeconds("wan-videoedit", 6.06)).toBe(7)
      expect(videoToVideoBilledSeconds("wan-videoedit", 9, "5")).toBe(5)
      expect(videoToVideoBilledSeconds("wan-videoedit", 3, "5")).toBe(3)
      expect(videoToVideoBilledSeconds("wan-videoedit", 10.04, "10")).toBe(10)
    })

    it("is charged the larger of its flat row and its rate: 3 s stays 320, 5 s 320, 6 s 360, 10 s 600 (base)", () => {
      expect(priceOf("wan-videoedit", "1080p", 3)).toEqual({ creditId: "wan-videoedit" })
      expect(base(priceOf("wan-videoedit", "1080p", 3))).toBe(320)
      expect(base(priceOf("wan-videoedit", "1080p", 5))).toBe(320)
      expect(priceOf("wan-videoedit", "1080p", 6)).toEqual({ creditId: "wan-videoedit:1080p:per-4s", units: 1.5 })
      expect(base(priceOf("wan-videoedit", "1080p", 6))).toBe(360)
      expect(base(priceOf("wan-videoedit", undefined, 10))).toBe(600)
      // Asked for 5 s of a 10 s clip: 5 billed seconds, the flat row.
      expect(base(priceOf("wan-videoedit", "1080p", 10, "5"))).toBe(320)
    })

    it("never costs less than the flat row, at any length it takes", () => {
      for (let tenths = 20; tenths <= 100; tenths++) {
        const p = priceOf("wan-videoedit", "1080p", tenths / 10)
        expect(base(p)).toBeGreaterThanOrEqual(320)
        expect(base(p)).toBe(Math.max(320, Math.ceil((240 * videoToVideoBilledSeconds("wan-videoedit", tenths / 10)) / 4)))
      }
    })

    it("follows the live rows: a repriced row moves where the rate takes over", () => {
      expect(wanVideoEditRateFromSeconds("1080p", rowOf)).toBe(6)
      expect(wanVideoEditRateFromSeconds("1080p", (id) => (id === "wan-videoedit" ? 100 : ROWS[id]))).toBe(2)
      expect(wanVideoEditRateFromSeconds("1080p", (id) => (id === "wan-videoedit" ? 10_000 : ROWS[id]))).toBeUndefined()
      // A rate the table does not price never wins.
      expect(videoToVideoClipPrice("wan-videoedit", "1080p", 10, (id) => (id === "wan-videoedit" ? 320 : undefined))).toEqual({ creditId: "wan-videoedit" })
    })

    it("720p is charged at the 1080p rate for now", () => {
      expect(videoToVideoClipRateOf("wan-videoedit", "720p")?.rateId).toBe("wan-videoedit:1080p:per-4s")
      expect(base(priceOf("wan-videoedit", "720p", 10))).toBe(600)
    })

    it("refuses a clip shorter than 2 s or past 10 s by more than 0.05 s (a clip within it is billed at 10 s)", () => {
      expect(checkVideoToVideoClipLength("wan-videoedit", 1.9)).toMatchObject({ ok: false, code: "video_too_short" })
      expect(checkVideoToVideoClipLength("wan-videoedit", 2)).toEqual({ ok: true, billedSeconds: 2 })
      expect(checkVideoToVideoClipLength("wan-videoedit", 10.05)).toEqual({ ok: true, billedSeconds: 10 })
      expect(checkVideoToVideoClipLength("wan-videoedit", 10.06)).toMatchObject({ ok: false, code: "video_too_long" })
    })
  })

  describe("estimates", () => {
    it("quote the known length as a run bills it", () => {
      expect(videoToVideoEstimatePrice("happyhorse-edit", "720p", undefined, 10.04, rowOf)).toEqual({ creditId: "happyhorse-edit:720p:per-4s", units: 2.625, lengthKnown: true })
      expect(videoToVideoEstimatePrice("wan-videoedit", "1080p", "0", 4, rowOf)).toEqual({ creditId: "wan-videoedit", lengthKnown: true })
    })

    it("quote the longest clip the model takes when the length is not known — never below the hold", () => {
      const hh = videoToVideoEstimatePrice("happyhorse-edit", "720p", undefined, undefined, rowOf)
      expect(hh).toEqual({ creditId: "happyhorse-edit:720p:per-4s", units: 15, lengthKnown: false })
      const wan = videoToVideoEstimatePrice("wan-videoedit", "1080p", "0", null, rowOf)
      expect(wan).toEqual({ creditId: "wan-videoedit:1080p:per-4s", units: 2.5, lengthKnown: false })
      for (let tenths = 30; tenths <= 600; tenths += 7) expect(base(hh)).toBeGreaterThanOrEqual(base(priceOf("happyhorse-edit", "720p", tenths / 10)))
      for (let tenths = 20; tenths <= 100; tenths++) expect(base(wan)).toBeGreaterThanOrEqual(base(priceOf("wan-videoedit", "1080p", tenths / 10)))
    })
  })
})
