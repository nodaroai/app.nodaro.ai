/**
 * generate-video-pro pricing helper — THE GOLDEN TABLE.
 *
 * `computeGenerateVideoProPricing` is the money-authoritative closed-form for
 * the generate-video-pro node: it clamps (resolution, duration), runs the
 * segment-split closed-form (module-local `computeSplit` twin — copied
 * verbatim from the plan's Task 2 function body, since plugin code is not
 * importable from ee/), and derives the BASE (0%-markup) reserve amount.
 *
 * - `mode: "single"` (requested duration <= 15s after clamping): behaves like
 *   a normal single-segment t2v run — the credit identifier + BASE cost come
 *   from the SAME path every other video node uses
 *   (`buildVideoCreditModelIdentifier` + `getModelCreditBaseCost`, which is
 *   DB-aware and falls back to STATIC_CREDIT_COSTS on a DB miss).
 * - `mode: "multi"` (> 15s): the node stitches N segments together. There is
 *   no per-duration DB row for a synthetic multi-segment run, so this path
 *   reads STATIC_CREDIT_COSTS directly for all three quantities (feeBase,
 *   noRefPerSec, refPerSec) rather than going through the DB-aware getter —
 *   and hard-fails via PriceNotConfiguredError when a composite is missing
 *   (never silently under-reserve).
 *
 * model_pricing DB lookups are mocked to MISS so getModelCreditBaseCost falls
 * back to the real (un-mocked) STATIC_CREDIT_COSTS — mirrors
 * seedance2-ref-video-billing.test.ts — so the asserted numbers below track
 * the seeded reality in credits.ts, not a test double.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
        }),
      }),
    }),
  },
}))

import { computeGenerateVideoProPricing } from "../generate-video-pro-credits.js"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError, invalidateModelPricingCache } from "../credits.js"

beforeEach(() => {
  invalidateModelPricingCache()
})

// Sanity: pin the seeded composites the golden table's hand-computed
// comments below are derived from, so a future re-price of these rows fails
// loudly here instead of silently invalidating the golden numbers.
describe("golden-table composite sanity (seedance-2 family, credits.ts)", () => {
  it("seedance-2 @ 720p 8s composites", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:720p"]).toBe(82)
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:720p-ref"]).toBe(50)
  })
  it("seedance-2 @ 4k 8s composites", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:4k"]).toBe(416)
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:4k-ref"]).toBe(256)
  })
  it("seedance-2-mini @ 720p 8s composites", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2-mini:8s:720p"]).toBe(41)
    expect(STATIC_CREDIT_COSTS["seedance-2-mini:8s:720p-ref"]).toBe(25)
  })
  it("generate-video-pro fee row", () => {
    expect(STATIC_CREDIT_COSTS["generate-video-pro"]).toBe(10)
  })
})

describe("computeGenerateVideoProPricing — golden table (seedance-2 @ 720p unless noted)", () => {
  it("D=8 -> mode single, creditIdentifier for 8s, reserveBase 82", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 8,
    })
    expect(result.mode).toBe("single")
    expect(result.clampedDurationSec).toBe(8)
    expect(result.segmentCount).toBe(1)
    expect(result.totalRawSec).toBe(8)
    expect(result.segmentDurations).toEqual([8])
    expect(result.feeBase).toBe(0)
    expect(result.creditIdentifier).toBe("seedance-2:8s:720p")
    expect(result.reserveBase).toBe(82)
  })

  it("D=15 -> single, reserveBase 154", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 15,
    })
    expect(result.mode).toBe("single")
    expect(result.clampedDurationSec).toBe(15)
    expect(result.segmentCount).toBe(1)
    expect(result.segmentDurations).toEqual([15])
    expect(result.feeBase).toBe(0)
    expect(result.creditIdentifier).toBe("seedance-2:15s:720p")
    expect(result.reserveBase).toBe(154)
  })

  it("D=16 -> multi, n=2, s=17, durations [9,8], reserveBase 189", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 16,
    })
    expect(result.mode).toBe("multi")
    expect(result.clampedDurationSec).toBe(16)
    expect(result.segmentCount).toBe(2)
    expect(result.totalRawSec).toBe(17)
    expect(result.segmentDurations).toEqual([9, 8])
    expect(result.creditIdentifier).toBeUndefined()
    // feeBase(10) + ceil(noRefPerSec(10.25) × maxSeg(15)) + ceil(refPerSec(6.25) × ((n-1)×tailSec(2) + (s-maxSeg)))
    // = 10 + ceil(153.75) + ceil(6.25 × (1×2 + 2)) = 10 + 154 + ceil(25) = 10 + 154 + 25 = 189
    expect(result.reserveBase).toBe(189)
  })

  it("tailSec=4 raises the per-join overlap: D=16 reserveBase 189 -> 202; clamps 9->5 and 1->2", async () => {
    // Same D=16 split as above; only the (n-1)×tailSec term moves:
    // 10 + 154 + ceil(6.25 × (1×4 + 2)) = 10 + 154 + ceil(37.5) = 202
    const r4 = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, tailSec: 4,
    })
    expect(r4.tailSec).toBe(4)
    expect(r4.reserveBase).toBe(202)
    // Out-of-range clamps to [2,5]:
    const r9 = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, tailSec: 9,
    })
    expect(r9.tailSec).toBe(5)
    const r1 = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, tailSec: 1,
    })
    expect(r1.tailSec).toBe(2)
    expect(r1.reserveBase).toBe(189)
  })

  it("D=43 -> multi, n=3, s=44, durations [15,15,14], reserveBase 371", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 43,
    })
    expect(result.mode).toBe("multi")
    expect(result.clampedDurationSec).toBe(43)
    expect(result.segmentCount).toBe(3)
    expect(result.totalRawSec).toBe(44)
    expect(result.segmentDurations).toEqual([15, 15, 14])
    // 10 + ceil(10.25×15) + ceil(6.25×((3-1)×2+(44-15))) = 10 + 154 + ceil(6.25×33) = 10+154+207 = 371
    expect(result.reserveBase).toBe(371)
  })

  it("preferredSegmentSec=6 @ D=45 -> even 6s segments; the reserve follows the levered split (never the default's)", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 45,
      preferredSegmentSec: 6,
    })
    expect(result.mode).toBe("multi")
    expect(result.segmentCount).toBe(8)
    expect(result.totalRawSec).toBe(48)
    expect(result.segmentDurations).toEqual([6, 6, 6, 6, 6, 6, 6, 6])
    // 10 + ceil(10.25×6) + ceil(6.25×((8-1)×2+(48-6))) = 10 + 62 + ceil(6.25×56) = 10+62+350 = 422
    // (default split for D=45 reserves 388 — shorter segments cost MORE; the
    // twin split keeps reserve and plan in lock-step)
    expect(result.reserveBase).toBe(422)
  })

  it("preferredSegmentSec=4 turns a ≤15s request into a multi split (D=10 -> [6,5])", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 10,
      preferredSegmentSec: 4,
    })
    expect(result.mode).toBe("multi")
    expect(result.segmentDurations).toEqual([6, 5])
    // 10 + ceil(10.25×6) + ceil(6.25×((2-1)×2+(11-6))) = 10 + 62 + ceil(6.25×7) = 10+62+44 = 116
    expect(result.reserveBase).toBe(116)
  })

  it("preferredSegmentSec clamps into [4,15] (3 behaves as 4, 20 as 15)", async () => {
    const low = await computeGenerateVideoProPricing({ provider: "seedance-2", resolution: "720p", durationSec: 45, preferredSegmentSec: 3 })
    const four = await computeGenerateVideoProPricing({ provider: "seedance-2", resolution: "720p", durationSec: 45, preferredSegmentSec: 4 })
    expect(low.segmentDurations).toEqual(four.segmentDurations)
    const high = await computeGenerateVideoProPricing({ provider: "seedance-2", resolution: "720p", durationSec: 45, preferredSegmentSec: 20 })
    const fifteen = await computeGenerateVideoProPricing({ provider: "seedance-2", resolution: "720p", durationSec: 45, preferredSegmentSec: 15 })
    expect(high.segmentDurations).toEqual(fifteen.segmentDurations)
  })

  it("D=60 -> multi, n=5, s=62, durations [14,12,12,12,12], reserveBase 508", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 60,
    })
    expect(result.mode).toBe("multi")
    expect(result.clampedDurationSec).toBe(60)
    expect(result.segmentCount).toBe(5)
    expect(result.totalRawSec).toBe(62)
    expect(result.segmentDurations).toEqual([14, 12, 12, 12, 12])
    // 10 + ceil(10.25×15) + ceil(6.25×((5-1)×2+(62-15))) = 10 + 154 + ceil(6.25×55) = 10+154+344 = 508
    expect(result.reserveBase).toBe(508)
  })

  it("D=120 -> multi, n=9, s=123, durations [15,15,15,13,13,13,13,13,13], reserveBase 939", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 120,
    })
    expect(result.mode).toBe("multi")
    expect(result.clampedDurationSec).toBe(120)
    expect(result.segmentCount).toBe(9)
    expect(result.totalRawSec).toBe(123)
    expect(result.segmentDurations).toEqual([15, 15, 15, 13, 13, 13, 13, 13, 13])
    // 10 + ceil(10.25×15) + ceil(6.25×((9-1)×2+(123-15))) = 10 + 154 + ceil(6.25×124) = 10+154+775 = 939
    expect(result.reserveBase).toBe(939)
  })
})

describe("resolution clamp", () => {
  it("seedance-2-mini @ 1080p (unsupported) snaps to mini's top tier (720p) rates, no throw", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2-mini",
      resolution: "1080p",
      durationSec: 60,
    })
    expect(result.mode).toBe("multi")
    // Same split as the D=60 seedance-2 row (split math doesn't depend on provider/resolution).
    expect(result.segmentCount).toBe(5)
    expect(result.totalRawSec).toBe(62)
    expect(result.segmentDurations).toEqual([14, 12, 12, 12, 12])
    // Clamped to mini's top tier 720p: noRefPerSec = 41/8, refPerSec = 25/8 (NOT an unpriced 1080p lookup).
    expect(result.noRefPerSec).toBeCloseTo(41 / 8)
    expect(result.refPerSec).toBeCloseTo(25 / 8)
    // 10 + ceil((41/8)×15) + ceil((25/8)×((5-1)×2+(62-15))) = 10 + ceil(76.875) + ceil(3.125×55)
    // = 10 + 77 + ceil(171.875) = 10 + 77 + 172 = 259
    expect(result.reserveBase).toBe(259)
  })

  it("seedance-2 @ 4k uses 4k rates", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "4k",
      durationSec: 16,
    })
    expect(result.mode).toBe("multi")
    expect(result.segmentCount).toBe(2)
    expect(result.totalRawSec).toBe(17)
    expect(result.noRefPerSec).toBeCloseTo(STATIC_CREDIT_COSTS["seedance-2:8s:4k"]! / 8)
    expect(result.refPerSec).toBeCloseTo(STATIC_CREDIT_COSTS["seedance-2:8s:4k-ref"]! / 8)
    // reserveBase = 10 + ceil((STATIC["seedance-2:8s:4k"]/8)×15) + ceil((STATIC["seedance-2:8s:4k-ref"]/8)×(2+2))
    //             = 10 + ceil((416/8)×15) + ceil((256/8)×4)
    //             = 10 + ceil(52×15) + ceil(32×4)
    //             = 10 + 780 + 128
    //             = 918
    expect(result.reserveBase).toBe(918)
  })
})

describe("cap clamp", () => {
  it("durationSec 300 clamps to clampedDurationSec 120, n 9 (same split as D=120)", async () => {
    const result = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 300,
    })
    expect(result.clampedDurationSec).toBe(120)
    expect(result.segmentCount).toBe(9)
    expect(result.mode).toBe("multi")
  })
})

describe("missing composite", () => {
  it("throws PriceNotConfiguredError for a provider with no seeded 8s composites", async () => {
    await expect(
      computeGenerateVideoProPricing({
        provider: "totally-unseeded-provider-xyz",
        resolution: "720p",
        durationSec: 16,
      }),
    ).rejects.toThrow(PriceNotConfiguredError)
  })
})
