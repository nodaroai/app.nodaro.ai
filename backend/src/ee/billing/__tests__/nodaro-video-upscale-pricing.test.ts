// @test-units-by-name reads only the Nodaro Video Upscale rows and catalog entry it names
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import {
  NODARO_VIDEO_UPSCALE_CREDIT_IDS,
  NODARO_VIDEO_UPSCALE_RATE_SECONDS,
  nodaroVideoUpscaleBilledSec,
  nodaroVideoUpscaleEstimateUnits,
  nodaroVideoUpscaleRefusesLength,
  nodaroVideoUpscaleUnits,
} from "@nodaro/render-rules"
import { STATIC_CREDIT_COSTS, chargedCredits, chargedPriceTableFrom } from "../credits.js"
import { parseRateQuoteCreditId } from "../../../lib/unit-quote-rates.js"

/**
 * Nodaro Video Upscale's price (decided 2026-11-11): 3.75 / 7.5 / 15 base
 * credits a second of the clip at 1080p / 2K / 4K, the clip's length rounded
 * up to a whole second, the total rounded up ONCE and marked up once by the
 * deployment's pricing settings. The figures below are what those rules give
 * with the fixture's settings.
 */

// A 10% markup fixture, with no model_pricing rows: the static rows price it.
const prices = chargedPriceTableFrom(new Map(), { cost_markup_percent: 10 } as never)
const charged = (tier: keyof typeof NODARO_VIDEO_UPSCALE_CREDIT_IDS, clipSec: number): number | undefined =>
  chargedCredits(prices, NODARO_VIDEO_UPSCALE_CREDIT_IDS[tier], nodaroVideoUpscaleUnits(nodaroVideoUpscaleBilledSec(clipSec)))

describe("Nodaro Video Upscale pricing", () => {
  it("each tier's row prices four seconds, so the per-second rate is exact", () => {
    expect(NODARO_VIDEO_UPSCALE_RATE_SECONDS).toBe(4)
    expect(STATIC_CREDIT_COSTS[NODARO_VIDEO_UPSCALE_CREDIT_IDS["1080p"]]! / 4).toBe(3.75)
    expect(STATIC_CREDIT_COSTS[NODARO_VIDEO_UPSCALE_CREDIT_IDS["2k"]]! / 4).toBe(7.5)
    expect(STATIC_CREDIT_COSTS[NODARO_VIDEO_UPSCALE_CREDIT_IDS["4k"]]! / 4).toBe(15)
  })

  it.each([
    ["1080p", 10, 42], ["2k", 10, 83], ["4k", 10, 165],
    ["1080p", 60, 248], ["2k", 60, 495], ["4k", 60, 990],
  ] as const)("%s, a %i s clip is charged %i", (tier, sec, credits) => {
    expect(charged(tier, sec)).toBe(credits)
  })

  it("rounds the clip up to a whole second, and never rounds per second before multiplying", () => {
    // 10.01 s is billed as 11 s.
    expect(nodaroVideoUpscaleBilledSec(10.01)).toBe(11)
    expect(charged("1080p", 10.01)).toBe(charged("1080p", 11))
    // 5 s at 1080p: 18.75 → 19 base → 21 charged (rounding each second first would give 20 → 22).
    expect(charged("1080p", 5)).toBe(21)
  })

  it("the catalog's pricing rows are the static rows", () => {
    const rows = MODEL_CATALOG["nodaro-video-upscale"]!.pricing
    for (const id of Object.values(NODARO_VIDEO_UPSCALE_CREDIT_IDS)) {
      expect(rows.find((r) => r.identifier === id)?.credits).toBe(STATIC_CREDIT_COSTS[id])
    }
  })

  it("a whole-run quote id prices a quarter-unit per second, up to the 60 s clip", () => {
    const id = NODARO_VIDEO_UPSCALE_CREDIT_IDS["2k"]
    expect(parseRateQuoteCreditId(`${id}:2.5u`)).toEqual({ rateId: id, units: 2.5 })
    expect(parseRateQuoteCreditId(`${id}:15u`)).toEqual({ rateId: id, units: 15 })
    expect(parseRateQuoteCreditId(`${id}:16u`)).toBeUndefined()
  })

  it("an estimate with no known length prices a 10 s clip; a known one is billed as a run bills it", () => {
    expect(nodaroVideoUpscaleEstimateUnits(undefined)).toBe(2.5)
    expect(nodaroVideoUpscaleEstimateUnits(null)).toBe(2.5)
    expect(nodaroVideoUpscaleEstimateUnits(8.2)).toBe(2.25)
  })

  it("a known length past 60 s is refused (the callers leave it out, so no estimate prices it); a planned one is quoted at the 60 s a run bills at most; 60 s itself and an unknown length are priced", () => {
    expect(nodaroVideoUpscaleRefusesLength(75)).toBe(true)
    expect(nodaroVideoUpscaleRefusesLength(60.02)).toBe(true)
    // The units read any length, planned ones included, at most the limit: the run bills at most that, or refuses and charges nothing.
    expect(nodaroVideoUpscaleEstimateUnits(75)).toBe(15)
    expect(nodaroVideoUpscaleEstimateUnits(60.17)).toBe(15)
    expect(nodaroVideoUpscaleRefusesLength(60)).toBe(false)
    expect(nodaroVideoUpscaleEstimateUnits(60)).toBe(15)
    for (const unknown of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nodaroVideoUpscaleRefusesLength(unknown), String(unknown)).toBe(false)
      expect(nodaroVideoUpscaleEstimateUnits(unknown), String(unknown)).toBe(2.5)
    }
  })
})
