// @test-units-by-name looks up only the seedance-2-5-flash credit rows it names
import { describe, it, expect } from "vitest"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { seedance2RefVideoBaseCredits } from "../seedance2-ref-video-credits.js"
import {
  SEEDANCE_25_FLASH_KIE_CREDITS_PER_SEC,
  SEEDANCE_25_KIE_CREDITS_PER_SEC,
  seedance25FlashCostUsd,
} from "../../../providers/kie/seedance-cost.js"
import { KIE_CREDIT_USD } from "../../../providers/kie/models.js"

/**
 * Seedance 2.5 Flash — one row per second (4-30 s) at 480p and 720p, without
 * and with a reference video, each derived from Flash's OWN KIE rates by the
 * Seedance 2.5 rule `ceil(rate × seconds / 4) × 10` — never scaled from
 * Seedance 2.5's rows.
 */
const ID = "seedance-2-5-flash"
/** Flash's KIE rates, KIE credits per second. */
const RATES: Record<string, number> = { "480p": 18.5, "480p-ref": 11.5, "720p": 41, "720p-ref": 25.5 }
/** The rule, in integer math (rates in half credits). */
const rule = (rate: number, sec: number) => Math.ceil((rate * 2 * sec) / 8) * 10

describe("seedance-2-5-flash credit rows", () => {
  it("has exactly 108 per-second rows plus the bare id, and nothing at 1080p", () => {
    const ids = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === ID || k.startsWith(`${ID}:`))
    expect(ids).toHaveLength(109)
    expect(ids.some((k) => k.includes("1080p"))).toBe(false)
  })

  it("derives every row from Flash's own rates", () => {
    for (const [tier, rate] of Object.entries(RATES)) {
      for (let s = 4; s <= 30; s++) {
        expect(STATIC_CREDIT_COSTS[`${ID}:${s}s:${tier}`], `${s}s ${tier}`).toBe(rule(rate, s))
      }
    }
  })

  it("matches the decided spot checks", () => {
    const spot: Record<string, number> = {
      "5s:480p": 240, "8s:480p": 370, "5s:720p": 520, "8s:720p": 820, "10s:720p": 1030,
      "30s:720p": 3080, "8s:480p-ref": 230, "8s:720p-ref": 510,
    }
    for (const [k, v] of Object.entries(spot)) expect(STATIC_CREDIT_COSTS[`${ID}:${k}`], k).toBe(v)
    // The bare id is the default run: 8 s at 720p.
    expect(STATIC_CREDIT_COSTS[ID]).toBe(820)
  })

  it("never reuses a Seedance 2.5 price", () => {
    for (const k of ["8s:480p", "8s:720p", "8s:720p-ref", "30s:720p"]) {
      expect(STATIC_CREDIT_COSTS[`${ID}:${k}`]).not.toBe(STATIC_CREDIT_COSTS[`seedance-2-5:${k}`])
    }
  })

  it("every catalog pricing row equals its static row", () => {
    for (const row of MODEL_CATALOG[ID]!.pricing) {
      expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
  })

  it("every id the identifier builder can make for Flash is priced", () => {
    for (const d of MODEL_CATALOG[ID]!.durations!) {
      for (const res of [undefined, "480p", "720p", "1080p", "4k"]) {
        for (const ref of [false, true]) {
          const id = buildVideoCreditModelIdentifier(ID, d, undefined, undefined, undefined, res, ref)
          expect(STATIC_CREDIT_COSTS[id], id).toBeTypeOf("number")
        }
      }
    }
  })
})

describe("seedance-2-5-flash Auto length", () => {
  it("an Auto run is held at Flash's longest clip and a delivered length is priced on Flash's own row", () => {
    expect(buildVideoCreditModelIdentifier(ID, -1, undefined, undefined, undefined, "720p", false)).toBe("seedance-2-5-flash:30s:720p")
    // The settlement re-prices the delivered seconds through the same builder (seedance2AutoDurationActualBaseCredits).
    expect(buildVideoCreditModelIdentifier(ID, 6, undefined, undefined, undefined, "720p", false)).toBe("seedance-2-5-flash:6s:720p")
    expect(STATIC_CREDIT_COSTS["seedance-2-5-flash:6s:720p"]).toBe(rule(41, 6))
  })
})

describe("seedance-2-5-flash reference-video billing", () => {
  it("bills input + output seconds at Flash's own -ref rate", () => {
    // 720p: the 8 s -ref row is 510, so 63.75 a second; 8 s out + 5 s in = 13 s.
    expect(seedance2RefVideoBaseCredits({ provider: ID, resolution: "720p", outputDurationSec: 8, inputVideoDurationSec: 5 }))
      .toBe(Math.ceil((510 / 8) * 13))
    // 480p: 230 / 8 = 28.75 a second.
    expect(seedance2RefVideoBaseCredits({ provider: ID, resolution: "480p", outputDurationSec: 8, inputVideoDurationSec: 0 })).toBe(230)
  })

  it("prices a stale 1080p at 720p, Flash's top tier", () => {
    expect(seedance2RefVideoBaseCredits({ provider: ID, resolution: "1080p", outputDurationSec: 8, inputVideoDurationSec: 0 })).toBe(510)
  })
})

describe("seedance-2-5-flash provider cost", () => {
  it("records Flash's own KIE rates, not Seedance 2.5's", () => {
    expect(SEEDANCE_25_FLASH_KIE_CREDITS_PER_SEC).toEqual({ "480p": { plain: 18.5, ref: 11.5 }, "720p": { plain: 41, ref: 25.5 } })
    expect(SEEDANCE_25_FLASH_KIE_CREDITS_PER_SEC["720p"].plain).not.toBe(SEEDANCE_25_KIE_CREDITS_PER_SEC["720p"].plain)
    expect(seedance25FlashCostUsd({ resolution: "720p", hasVideoRef: false, outputSec: 8, inputSec: 0 })).toBeCloseTo(41 * 8 * KIE_CREDIT_USD, 10)
    expect(seedance25FlashCostUsd({ resolution: "480p", hasVideoRef: true, outputSec: 8, inputSec: 5 })).toBeCloseTo(11.5 * 13 * KIE_CREDIT_USD, 10)
    // An unknown (or 1080p) resolution renders 720p.
    expect(seedance25FlashCostUsd({ resolution: "1080p", hasVideoRef: false, outputSec: 4, inputSec: 0 })).toBeCloseTo(41 * 4 * KIE_CREDIT_USD, 10)
  })
})
