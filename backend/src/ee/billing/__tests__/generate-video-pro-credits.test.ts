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

import { computeGenerateVideoProPricing, computeGenerateVideoProContinuationPricing } from "../generate-video-pro-credits.js"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError, invalidateModelPricingCache } from "../credits.js"
import { GVP_EXTEND_PROVIDERS, MODEL_CATALOG } from "@nodaro/shared"

beforeEach(() => {
  invalidateModelPricingCache()
})

// Sanity: pin the seeded composites the golden table's hand-computed
// comments below are derived from, so a future re-price of these rows fails
// loudly here instead of silently invalidating the golden numbers.
describe("golden-table composite sanity (seedance-2 family, credits.ts)", () => {
  it("seedance-2 @ 720p 8s composites", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:720p"]).toBe(820)
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:720p-ref"]).toBe(500)
  })
  it("seedance-2 @ 4k 8s composites", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:4k"]).toBe(4160)
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:4k-ref"]).toBe(2560)
  })
  it("seedance-2-mini @ 720p 8s composites", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2-mini:8s:720p"]).toBe(410)
    expect(STATIC_CREDIT_COSTS["seedance-2-mini:8s:720p-ref"]).toBe(250)
  })
  it("generate-video-pro fee row", () => {
    expect(STATIC_CREDIT_COSTS["generate-video-pro"]).toBe(100)
  })
  it("nano-banana-pro anchor-image row (keyframes WIDE-aspect anchor reserve)", () => {
    expect(STATIC_CREDIT_COSTS["nano-banana-pro"]).toBe(45)
  })
  it("gpt-image-2:2K anchor-image row (keyframes default anchor reserve)", () => {
    // The COMPOSITE, not the bare id — bare gpt-image-2 is the 1K price (15)
    // and would under-reserve every anchor by half.
    expect(STATIC_CREDIT_COSTS["gpt-image-2:2K"]).toBe(30)
    expect(STATIC_CREDIT_COSTS["gpt-image-2"]).toBe(15)
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
    expect(result.reserveBase).toBe(820)
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
    expect(result.reserveBase).toBe(1540)
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
    expect(result.reserveBase).toBe(1888)
  })

  it("tailSec=4 raises the per-join overlap: D=16 reserveBase 189 -> 202; window is now [2,15] (9 passes, 16→15, 1→2)", async () => {
    // Same D=16 split as above; only the (n-1)×tailSec term moves:
    // 10 + 154 + ceil(6.25 × (1×4 + 2)) = 10 + 154 + ceil(37.5) = 202
    const r4 = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, tailSec: 4,
    })
    expect(r4.tailSec).toBe(4)
    expect(r4.reserveBase).toBe(2013)
    // Window raised to [2,15] (2026-07-22): 9 now passes through unclamped.
    const r9 = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, tailSec: 9,
    })
    expect(r9.tailSec).toBe(9)
    // Above the new ceiling clamps to 15.
    const r16 = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, tailSec: 16,
    })
    expect(r16.tailSec).toBe(15)
    const r1 = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, tailSec: 1,
    })
    expect(r1.tailSec).toBe(2)
    expect(r1.reserveBase).toBe(1888)
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
    expect(result.reserveBase).toBe(3701)
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
    expect(result.reserveBase).toBe(4215)
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
    expect(result.reserveBase).toBe(1153)
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
    expect(result.reserveBase).toBe(5076)
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
    expect(result.reserveBase).toBe(9388)
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
    // Clamped to mini's top tier 720p: noRefPerSec = 410/8, refPerSec = 250/8
    // (NOT an unpriced 1080p lookup).
    expect(result.noRefPerSec).toBeCloseTo(410 / 8)
    expect(result.refPerSec).toBeCloseTo(250 / 8)
    // 100 + ceil((410/8)×15) + ceil((250/8)×((5-1)×2+(62-15)))
    // = 100 + ceil(768.75) + ceil(31.25×55) = 100 + 769 + ceil(1718.75)
    // = 100 + 769 + 1719 = 2588
    expect(result.reserveBase).toBe(2588)
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
    expect(result.reserveBase).toBe(9180)
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

// Continuation reserve (stop/continue, 2026-07-21). TWIN of the plugin
// engine's continuation-aware commitBase — reserve == commit for a fully
// completed continuation, so refund is 0 by construction. Durations are the
// classic D=60 split [14,12,12,12,12] (Σ=62).
describe("computeGenerateVideoProContinuationPricing — golden table (seedance-2 @ 720p)", () => {
  const base = {
    provider: "seedance-2", resolution: "720p",
    segmentDurations: [14, 12, 12, 12, 12], // parent plan, money-authoritative
  }

  it("fromSegment=4 (regenerate 4-5): fee + ref×(2 tails + 24s) = 10 + ceil(6.25×28) = 185", async () => {
    const r = await computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 4 })
    expect(r.mode).toBe("multi")
    expect(r.segmentCount).toBe(5)
    expect(r.segmentDurations).toEqual([14, 12, 12, 12, 12])
    expect(r.billFromSegment).toBe(4)
    expect(r.tailSec).toBe(2)
    expect(r.reserveBase).toBe(1850)
  })

  it("fromSegment=5 (tail re-roll of a completed run): 10 + ceil(6.25×(1×2+12)) = 98", async () => {
    const r = await computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 5 })
    expect(r.billFromSegment).toBe(5)
    expect(r.reserveBase).toBe(975)
  })

  it("fromSegment=1 degenerates to the fresh-run formula over the SAME fixed durations: 10 + ceil(10.25×14) + ceil(6.25×(4×2+48)) = 504", async () => {
    const r = await computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 1 })
    expect(r.billFromSegment).toBe(1)
    expect(r.reserveBase).toBe(5035)
  })

  it("tailSec lever moves the per-join term: fromSegment=4 @ tail 4 → 10 + ceil(6.25×(2×4+24)) = 210", async () => {
    const r = await computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 4, tailSec: 4 })
    expect(r.tailSec).toBe(4)
    expect(r.reserveBase).toBe(2100)
  })

  it("rejects out-of-range fromSegment and corrupt parent durations (never a silent misprice)", async () => {
    await expect(computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 0 })).rejects.toThrow(/fromSegment/)
    await expect(computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 6 })).rejects.toThrow(/fromSegment/)
    await expect(
      computeGenerateVideoProContinuationPricing({ ...base, segmentDurations: [99, 12], fromSegment: 1 }),
    ).rejects.toThrow(/invalid parent segment durations/)
    await expect(
      computeGenerateVideoProContinuationPricing({ ...base, segmentDurations: [], fromSegment: 1 }),
    ).rejects.toThrow(/invalid parent segment durations/)
  })
})

// KEYFRAMES render method (2026-08-03). Scene-decomposed rendering: each
// segment is generated from its own start/end anchor frames instead of
// chaining a continuation tail off the previous segment, so (a) EVERY segment
// bills at the NO-ref per-second rate, (b) the `refPerSec × tailSec × (n−1)`
// continuation term disappears entirely, and (c) the run reserves worst-case
// 2 anchor images per segment at the anchor model's base credit (the engine
// commits actuals — metered down). Extend mode with the key absent must stay
// byte-identical: the regression block below locks that.
describe("computeGenerateVideoProPricing — keyframes render method (seedance-2 @ 720p)", () => {
  const NO_REF_PER_SEC = STATIC_CREDIT_COSTS["seedance-2:8s:720p"]! / 8 // 102.5
  const FEE = STATIC_CREDIT_COSTS["generate-video-pro"]!
  // No `aspectRatio` in these calls — that is the OLD-PLUGIN path, which still
  // generates every anchor on nano-banana-pro, so the reserve stays the
  // fallback unit and this whole golden block is byte-identical to pre-2026-08-04.
  const ANCHOR = STATIC_CREDIT_COSTS["nano-banana-pro"]!
  /** The default unit, used once an aspect the engine can render on GPT Image 2 rides along. */
  const ANCHOR_GPT2 = STATIC_CREDIT_COSTS["gpt-image-2:2K"]!
  const expected = (durations: number[]): number =>
    FEE +
    durations.reduce((sum, d) => sum + Math.ceil(d * NO_REF_PER_SEC), 0) +
    durations.length * 2 * ANCHOR

  // ── anchor unit follows the aspect (2026-08-04: nano-banana-pro → GPT Image 2) ──

  it("prices anchors at the GPT Image 2 2K unit for every ratio it can render", async () => {
    for (const aspectRatio of ["16:9", "9:16", "1:1", "4:3", "3:4"]) {
      const r = await computeGenerateVideoProPricing({
        provider: "seedance-2", resolution: "720p", durationSec: 16,
        renderMethod: "keyframes", aspectRatio,
      })
      expect(r.anchorReserve).toBe(2 * 2 * ANCHOR_GPT2)
    }
  })

  it("prices a 21:9 run's anchors at the nano-banana-pro fallback — GPT Image 2 cannot render it", async () => {
    // TWIN of the plugin's `resolveAnchorModel`: 21:9 generates on
    // nano-banana-pro, so it must RESERVE nano-banana-pro. Pricing it at the
    // cheaper unit would under-reserve every ultra-wide keyframes run.
    const r = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16,
      renderMethod: "keyframes", aspectRatio: "21:9",
    })
    expect(r.anchorReserve).toBe(2 * 2 * ANCHOR)
    expect(ANCHOR).toBeGreaterThan(ANCHOR_GPT2)
  })

  it("an absent aspect reserves the FALLBACK unit — an older plugin still spends nano-banana-pro", async () => {
    const withAspect = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16,
      renderMethod: "keyframes", aspectRatio: "16:9",
    })
    const without = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, renderMethod: "keyframes",
    })
    expect(without.anchorReserve).toBe(2 * 2 * ANCHOR)
    // Never cheaper than what the old plugin actually spends.
    expect(without.anchorReserve!).toBeGreaterThan(withAspect.anchorReserve!)
  })

  it("the aspect lever is inert outside keyframes — extend reserves no anchors at all", async () => {
    const wide = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, aspectRatio: "21:9",
    })
    const narrow = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, aspectRatio: "16:9",
    })
    expect(wide.anchorReserve).toBeUndefined()
    expect(wide.reserveBase).toBe(narrow.reserveBase)
  })

  it("D=16 multi: every segment at the no-ref rate, no continuation tail, + 2 anchors/segment", async () => {
    const r = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 16, renderMethod: "keyframes",
    })
    expect(r.mode).toBe("multi")
    expect(r.segmentDurations).toEqual([9, 8])
    expect(r.renderMethod).toBe("keyframes")
    expect(r.anchorReserve).toBe(2 * 2 * ANCHOR)
    // 100 + (ceil(9×102.5)=923 + ceil(8×102.5)=820) + 180
    expect(r.reserveBase).toBe(expected([9, 8]))
    expect(r.reserveBase).toBe(2023)
  })

  it("D=60 multi: n=5 split priced entirely at the no-ref rate + 10 anchors", async () => {
    const r = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60, renderMethod: "keyframes",
    })
    expect(r.segmentDurations).toEqual([14, 12, 12, 12, 12])
    expect(r.anchorReserve).toBe(5 * 2 * ANCHOR)
    expect(r.reserveBase).toBe(expected([14, 12, 12, 12, 12]))
    expect(r.reserveBase).toBe(6905)
  })

  // ── ANCHORS ALREADY BOUGHT (interactive mode S2) ────────────────────────
  it("a run rendering from stills it was GIVEN reserves no anchor budget", async () => {
    const seeded = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60, renderMethod: "keyframes", anchorsSeeded: true,
    })
    // The field is ABSENT, not zero: `commitBase` derives the per-anchor unit
    // from it, and a 0 would make it divide an empty budget rather than bill
    // nothing.
    expect(seeded.anchorReserve).toBeUndefined()
    const normal = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60, renderMethod: "keyframes",
    })
    // …and the whole difference is exactly the budget it did not hold — on a
    // 5-scene run that is 10 stills; on a 14-scene one it is what makes the
    // difference between finishing and a 402 at the finish line.
    expect(normal.reserveBase - seeded.reserveBase).toBe(5 * 2 * ANCHOR)
  })

  it("is inert on an EXTEND run, which has no anchors to seed", async () => {
    const withFlag = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60, anchorsSeeded: true,
    })
    const without = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60,
    })
    expect(withFlag.reserveBase).toBe(without.reserveBase)
  })

  it("the tail lever is inert under keyframes (no continuation-tail term to move)", async () => {
    const t2 = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60, renderMethod: "keyframes",
    })
    const t15 = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60, renderMethod: "keyframes", tailSec: 15,
    })
    expect(t15.reserveBase).toBe(t2.reserveBase)
  })

  it("keyframes is strictly the no-ref shape: reserve differs from the extend reserve for the same split", async () => {
    const extend = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60,
    })
    const keyframes = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60, renderMethod: "keyframes",
    })
    expect(keyframes.segmentDurations).toEqual(extend.segmentDurations)
    expect(keyframes.reserveBase).not.toBe(extend.reserveBase)
    expect(extend.renderMethod).toBeUndefined()
    expect(extend.anchorReserve).toBeUndefined()
  })

  it("D=8 single: same formula over one segment + 2 anchors, and NO creditIdentifier (dynamic reserve path)", async () => {
    const r = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 8, renderMethod: "keyframes",
    })
    expect(r.mode).toBe("single")
    expect(r.segmentDurations).toEqual([8])
    expect(r.creditIdentifier).toBeUndefined() // dynamic reserve — never the flat composite path
    expect(r.renderMethod).toBe("keyframes")
    expect(r.anchorReserve).toBe(2 * ANCHOR)
    expect(r.reserveBase).toBe(expected([8]))
    expect(r.reserveBase).toBe(1010)
  })

  it("explicit scene-aligned durations price verbatim under keyframes too", async () => {
    const SCENE_PACK_79 = [8, 10, 6, 6, 5, 6, 4, 4, 4, 5, 5, 5, 7, 8]
    const r = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 79.3,
      segmentDurations: SCENE_PACK_79, renderMethod: "keyframes",
    })
    expect(r.segmentDurations).toEqual(SCENE_PACK_79)
    expect(r.anchorReserve).toBe(14 * 2 * ANCHOR)
    expect(r.reserveBase).toBe(expected(SCENE_PACK_79))
  })

  it("keeps the hard-fail policy: an unseeded provider still throws PriceNotConfiguredError", async () => {
    await expect(
      computeGenerateVideoProPricing({
        provider: "totally-unseeded-provider-xyz", resolution: "720p", durationSec: 16, renderMethod: "keyframes",
      }),
    ).rejects.toThrow(PriceNotConfiguredError)
  })
})

// ADDITIVE-ONLY guard: `renderMethod` absent (or explicitly "extend") must
// leave every pre-existing reserve byte-identical — these lock the exact
// golden numbers from the table above through the new code path.
describe("renderMethod absent/extend — byte-identical regression", () => {
  it("D=60 multi keeps reserveBase 5076 and emits no keyframes fields", async () => {
    const absent = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60,
    })
    expect(absent.reserveBase).toBe(5076)
    expect(absent.segmentDurations).toEqual([14, 12, 12, 12, 12])
    expect("renderMethod" in absent).toBe(false)
    expect("anchorReserve" in absent).toBe(false)
    const extend = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60, renderMethod: "extend",
    })
    expect(extend).toEqual(absent)
  })

  it("D=8 single keeps reserveBase 820 + its flat creditIdentifier", async () => {
    const absent = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 8,
    })
    expect(absent.reserveBase).toBe(820)
    expect(absent.creditIdentifier).toBe("seedance-2:8s:720p")
    expect("renderMethod" in absent).toBe(false)
    expect("anchorReserve" in absent).toBe(false)
    const extend = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 8, renderMethod: "extend",
    })
    expect(extend).toEqual(absent)
  })

  it("continuation fromSegment=4 keeps reserveBase 1850 and emits no keyframes fields", async () => {
    const absent = await computeGenerateVideoProContinuationPricing({
      provider: "seedance-2", resolution: "720p",
      segmentDurations: [14, 12, 12, 12, 12], fromSegment: 4,
    })
    expect(absent.reserveBase).toBe(1850)
    expect(absent.billFromSegment).toBe(4)
    expect("renderMethod" in absent).toBe(false)
    expect("anchorReserve" in absent).toBe(false)
    const extend = await computeGenerateVideoProContinuationPricing({
      provider: "seedance-2", resolution: "720p",
      segmentDurations: [14, 12, 12, 12, 12], fromSegment: 4, renderMethod: "extend",
    })
    expect(extend).toEqual(absent)
  })
})

// Keyframes CONTINUATION: the child re-renders scenes ≥ fromSegment from
// their own anchors, so each bills at the no-ref rate with no continuation
// tail — and NO anchor reserve, since the parent already generated (and paid
// for) the anchors this continuation reuses.
describe("computeGenerateVideoProContinuationPricing — keyframes render method", () => {
  const NO_REF_PER_SEC = STATIC_CREDIT_COSTS["seedance-2:8s:720p"]! / 8 // 102.5
  const FEE = STATIC_CREDIT_COSTS["generate-video-pro"]!
  const base = {
    provider: "seedance-2", resolution: "720p",
    segmentDurations: [14, 12, 12, 12, 12],
    renderMethod: "keyframes" as const,
  }

  it("fromSegment=4: fee + the no-ref seconds of segments 4-5 only, no tails, no anchors", async () => {
    const r = await computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 4 })
    expect(r.renderMethod).toBe("keyframes")
    expect(r.billFromSegment).toBe(4)
    expect(r.anchorReserve).toBeUndefined() // parent's anchors are reused
    expect(r.reserveBase).toBe(FEE + 2 * Math.ceil(12 * NO_REF_PER_SEC))
    expect(r.reserveBase).toBe(2560)
  })

  it("fromSegment=1 bills every segment at the no-ref rate (matches the fresh keyframes run minus anchors)", async () => {
    const r = await computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 1 })
    const fresh = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 60, renderMethod: "keyframes",
    })
    expect(r.billFromSegment).toBe(1)
    expect(r.reserveBase).toBe(fresh.reserveBase - fresh.anchorReserve!)
  })

  it("the tail lever is inert under keyframes continuations", async () => {
    const t2 = await computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 4 })
    const t15 = await computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 4, tailSec: 15 })
    expect(t15.reserveBase).toBe(t2.reserveBase)
  })

  it("keeps the parent-durations / fromSegment validation (never a silent misprice)", async () => {
    await expect(
      computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 6 }),
    ).rejects.toThrow(/fromSegment/)
    await expect(
      computeGenerateVideoProContinuationPricing({ ...base, segmentDurations: [99, 12], fromSegment: 1 }),
    ).rejects.toThrow(/invalid parent segment durations/)
  })

  // ── SCENE-SET continue (2026-08-04) ────────────────────────────────────────

  it("segments [2,5]: fee + exactly those members' no-ref seconds; billSegments echoes the set, billFromSegment carries min(set)", async () => {
    const r = await computeGenerateVideoProContinuationPricing({ ...base, segments: [2, 5] })
    expect(r.renderMethod).toBe("keyframes")
    expect(r.billSegments).toEqual([2, 5])
    expect(r.billFromSegment).toBe(2)
    expect(r.anchorReserve).toBeUndefined()
    expect(r.reserveBase).toBe(FEE + 2 * Math.ceil(12 * NO_REF_PER_SEC))
  })

  it("a suffix-shaped set prices byte-identically to the same fromSegment (one formula, two spellings)", async () => {
    const set = await computeGenerateVideoProContinuationPricing({ ...base, segments: [4, 5] })
    const suffix = await computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 4 })
    expect(set.reserveBase).toBe(suffix.reserveBase)
    expect(set.billFromSegment).toBe(4)
  })

  it("the set arrives wire-shaped: duplicates dropped, order normalized", async () => {
    const r = await computeGenerateVideoProContinuationPricing({ ...base, segments: [5, 2, 2] })
    expect(r.billSegments).toEqual([2, 5])
  })

  it("a set REQUIRES keyframes (extend chains segments — a mid-run member cannot re-render without cascading), bounds its members, and needs at least one lever", async () => {
    await expect(
      computeGenerateVideoProContinuationPricing({ ...base, renderMethod: "extend", segments: [2] }),
    ).rejects.toThrow(/requires renderMethod "keyframes"/)
    await expect(
      computeGenerateVideoProContinuationPricing({ ...base, segments: [0, 2] }),
    ).rejects.toThrow(/segments outside/)
    await expect(
      computeGenerateVideoProContinuationPricing({ ...base, segments: [6] }),
    ).rejects.toThrow(/segments outside/)
    await expect(
      computeGenerateVideoProContinuationPricing({ ...base, segments: [] }),
    ).rejects.toThrow(/segments outside/)
    await expect(
      computeGenerateVideoProContinuationPricing({ provider: "seedance-2", resolution: "720p", segmentDurations: [14, 12], renderMethod: "keyframes" }),
    ).rejects.toThrow(/one of fromSegment or segments/)
  })

  it("suffix continuations stay byte-identical: no billSegments key without the lever", async () => {
    const r = await computeGenerateVideoProContinuationPricing({ ...base, fromSegment: 4 })
    expect(r.billSegments).toBeUndefined()
  })
})

describe("computeGenerateVideoProPricing — minimax-h3 (two-rate resolution lever, refPerSec == noRefPerSec per tier)", () => {
  // minimax-h3:8s = 730 → perSec 91.25 @2K; minimax-h3:8s:768p = 450 → perSec
  // 56.25 @768P (lever added 2026-08-03). No -ref composites — the r2v rate
  // equals the base rate of the selected tier, per minimax-h3-credits.ts. The
  // per-image surcharge (inputs beyond 5) deliberately rides the provider
  // margin, not user credits.
  it("both per-second rates derive from the one 2K composite for non-768P resolutions", async () => {
    const r = await computeGenerateVideoProPricing({ provider: "minimax-h3", resolution: "720p", durationSec: 60 })
    expect(r.noRefPerSec).toBe(730 / 8)
    expect(r.refPerSec).toBe(730 / 8)
  })

  it("both per-second rates derive from the one :768p composite when 768P is selected", async () => {
    const r = await computeGenerateVideoProPricing({ provider: "minimax-h3", resolution: "768P", durationSec: 60 })
    expect(r.noRefPerSec).toBe(450 / 8)
    expect(r.refPerSec).toBe(450 / 8)
  })

  it("D=8 -> single, priced off the standard duration composite (reserveBase 730)", async () => {
    const r = await computeGenerateVideoProPricing({ provider: "minimax-h3", resolution: "720p", durationSec: 8 })
    expect(r.mode).toBe("single")
    expect(r.creditIdentifier).toMatch(/^minimax-h3/)
    expect(r.reserveBase).toBe(730)
  })

  it("D=8 @768P -> single, priced off the :768p composite (reserveBase 450)", async () => {
    const r = await computeGenerateVideoProPricing({ provider: "minimax-h3", resolution: "768P", durationSec: 8 })
    expect(r.mode).toBe("single")
    expect(r.creditIdentifier).toBe("minimax-h3:8s:768p")
    expect(r.reserveBase).toBe(450)
  })

  it("D=60 -> multi, n=5, s=62: 100 (fee) + ceil(91.25×15) + ceil(91.25×(4×2+47)) = 6488", async () => {
    const r = await computeGenerateVideoProPricing({ provider: "minimax-h3", resolution: "720p", durationSec: 60 })
    expect(r.mode).toBe("multi")
    expect(r.segmentDurations).toEqual([14, 12, 12, 12, 12])
    expect(r.reserveBase).toBe(r.feeBase + Math.ceil(91.25 * 15) + Math.ceil(91.25 * (4 * 2 + 47)))
    expect(r.reserveBase).toBe(6488)
  })

  it("D=60 @768P -> same split at the 768P rate: 100 + ceil(56.25×15) + ceil(56.25×55) = 4038", async () => {
    const r = await computeGenerateVideoProPricing({ provider: "minimax-h3", resolution: "768P", durationSec: 60 })
    expect(r.mode).toBe("multi")
    expect(r.segmentDurations).toEqual([14, 12, 12, 12, 12])
    expect(r.reserveBase).toBe(r.feeBase + Math.ceil(56.25 * 15) + Math.ceil(56.25 * (4 * 2 + 47)))
    expect(r.reserveBase).toBe(4038)
  })

  it("non-H3 resolutions collapse to the 2K rate: 480p / 720p / 1080p / 4k price identically", async () => {
    const at = async (resolution: string) =>
      (await computeGenerateVideoProPricing({ provider: "minimax-h3", resolution, durationSec: 60 })).reserveBase
    const base = await at("720p")
    expect(await at("480p")).toBe(base)
    expect(await at("1080p")).toBe(base)
    expect(await at("4k")).toBe(base)
    // ...and the 768P tier is strictly cheaper than the 2K collapse.
    const r768 = await computeGenerateVideoProPricing({ provider: "minimax-h3", resolution: "768P", durationSec: 60 })
    expect(r768.reserveBase).toBeLessThan(base)
  })
})

// EXPLICIT segmentDurations (scene-aligned split, 2026-08-03). The array is
// produced by the plugin's `packScenesToSegments` and passed VERBATIM on the
// wire; this side validates + prices it — never re-derives — so quote,
// reserve, and plan cannot drift (spec caveat 4). The wire fixture below is
// the strict min-pack of the 79.3s probe clip's 24 analysis scene ends
// (spans [7,9,5,5,5,6,4,4,4,5,5,5,7,8] + seam extra 4 on the earliest
// parts) — the SAME golden case pinned in the plugin's split.test.ts.
describe("computeGenerateVideoProPricing — explicit segmentDurations (seedance-2 @ 720p)", () => {
  const SCENE_PACK_79 = [8, 10, 6, 6, 5, 6, 4, 4, 4, 5, 5, 5, 7, 8] // n=14, Σ=83 = ceil(79 + 0.3×13)

  it("79.3s scene pack: priced verbatim, clampedDurationSec stays the DELIVERED d (79, never Σ)", async () => {
    const r = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 79.3,
      segmentDurations: SCENE_PACK_79,
    })
    expect(r.mode).toBe("multi")
    expect(r.clampedDurationSec).toBe(79) // delivered d — node-executor rewrites payload.duration from this
    expect(r.segmentCount).toBe(14)
    expect(r.totalRawSec).toBe(83)
    expect(r.segmentDurations).toEqual(SCENE_PACK_79) // echoed verbatim (old-app detection relies on this)
    expect(r.segmentDurations).not.toBe(SCENE_PACK_79) // defensive copy, never an alias
    // 100 + ceil(102.5×8) + ceil(62.5×((14-1)×2 + (83-8))) = 100 + 820 + ceil(62.5×101) = 100+820+6313
    expect(r.reserveBase).toBe(7233)
  })

  it("quote==reserve parity: an explicit array equal to the preferred split prices byte-identically", async () => {
    const preferred = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 45, preferredSegmentSec: 6,
    })
    const explicit = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 45, segmentDurations: [...preferred.segmentDurations],
    })
    expect(explicit).toEqual(preferred)
  })

  it("explicit takes precedence over preferredSegmentSec when both are present", async () => {
    const r = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 45,
      segmentDurations: [6, 6, 6, 6, 6, 6, 6, 6], preferredSegmentSec: 15,
    })
    expect(r.segmentCount).toBe(8)
    expect(r.reserveBase).toBe(4215)
  })

  it("n=1 explicit [d] is byte-identical to the classic single path (tier-snapped identifier and all)", async () => {
    const classic = await computeGenerateVideoProPricing({ provider: "seedance-2", resolution: "720p", durationSec: 10 })
    const explicit = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 10, segmentDurations: [10],
    })
    expect(explicit).toEqual(classic)
  })

  it("rejects sum mismatch, non-integers, and >24 segments (never a silent misprice)", async () => {
    const at = (durationSec: number, segmentDurations: number[]) =>
      computeGenerateVideoProPricing({ provider: "seedance-2", resolution: "720p", durationSec, segmentDurations })
    // A pack that needs NO snap is still priced verbatim, so the sum equality
    // remains the drift guard between quote, reserve and plan.
    await expect(at(16, [9, 9])).rejects.toThrow(/sum 18 != /) // expected 17
    // Count and integrality stay hard failures: the snap below corrects a
    // duration the provider does not offer, never a caller bug.
    await expect(at(16, [8.5, 9])).rejects.toThrow(/integer/)
    await expect(at(100, new Array<number>(25).fill(4))).rejects.toThrow(/1\.\.24 integer entries/)
  })

  it("snaps an off-menu entry rather than rejecting it, and says that it snapped", async () => {
    // WAS a rejection until 2026-08-06. The invariant that mattered — the
    // provider is never handed a duration it does not offer — now holds by
    // CORRECTING the entry instead of refusing the run, because the caller
    // producing this array cannot read the menu (its @nodaro/shared pin lags
    // this repo's catalog by whole releases).
    const at = (durationSec: number, segmentDurations: number[]) =>
      computeGenerateVideoProPricing({ provider: "seedance-2", resolution: "720p", durationSec, segmentDurations })
    const low = await at(16, [3, 14])
    expect(low.segmentDurations).toEqual([4, 14]) // 3 is below seedance-2's floor of 4
    expect(low.segmentDurationsSnapped).toBe(true)
    const high = await at(16, [16, 4])
    expect(high.segmentDurations).toEqual([15, 4]) // 16 is above its ceiling of 15
    expect(high.segmentDurationsSnapped).toBe(true)
  })

  it("never prices a duration the provider does not offer, even inside its own range", async () => {
    // The regression the membership rule exists for: veo3 renders 4/6/8s, so a
    // 5s segment sits inside [4,8] and would pass a range check — then be
    // rejected by the provider mid-run, after the reserve was taken. It is now
    // corrected onto a real tier instead of failing the quote outright.
    const p = await computeGenerateVideoProPricing({
      provider: "veo3",
      resolution: "720p",
      durationSec: 12,
      segmentDurations: [5, 8],
      renderMethod: "keyframes",
    })
    expect(p.segmentDurations).toEqual([4, 8])
    for (const d of p.segmentDurations) expect([4, 6, 8]).toContain(d)
    expect(p.segmentDurationsSnapped).toBe(true)
  })
})

/**
 * FLAT-PRICED PROVIDERS (2026-08-05, the pro node opening past the Seedance-2
 * family). These SKUs have no linear `${id}:8s:${res}` composite to divide, so
 * the per-second closed-form cannot price them. A keyframes segment IS one
 * plain image-to-video generation, so each one prices through the canonical
 * identifier builder and the costs ride back as `segmentCosts`.
 *
 * The load-bearing property of this whole change is in the FIRST test: the
 * per-second providers must be untouched.
 */
describe("computeGenerateVideoProPricing — flat-priced providers", () => {
  it("per-second providers are UNCHANGED — no segmentCosts, rates still populated", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 40,
      renderMethod: "keyframes",
    })
    expect(p.segmentCosts).toBeUndefined()
    expect(p.noRefPerSec).toBe(STATIC_CREDIT_COSTS["seedance-2:8s:720p"]! / 8)
    expect(p.refPerSec).toBe(STATIC_CREDIT_COSTS["seedance-2:8s:720p-ref"]! / 8)
  })

  it("veo3 keyframes prices each segment at its own flat per-generation cost", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "veo3",
      resolution: "720p",
      durationSec: 24,
      segmentDurations: [8, 8, 8],
      renderMethod: "keyframes",
      aspectRatio: "16:9",
    })
    // Delivered duration is DERIVED from the pack (24 raw − 0.3×2 seam loss),
    // not forced to equal the request: veo3's 4/6/8 are all even, so the
    // classic ceil(d + 0.3(n−1)) target is unreachable for odd sums.
    expect(p.clampedDurationSec).toBe(23)
    // VEO is flat per generation regardless of duration, so all three segments
    // cost the same seeded row and the rates carry no meaning.
    const unit = STATIC_CREDIT_COSTS["veo3"]!
    expect(p.segmentCosts).toEqual([unit, unit, unit])
    expect(p.noRefPerSec).toBe(0)
    expect(p.refPerSec).toBe(0)
    // reserve = fee + Σ segment costs + worst-case anchors (2 per segment).
    const anchorUnit = STATIC_CREDIT_COSTS["gpt-image-2:2K"]!
    expect(p.reserveBase).toBe(
      STATIC_CREDIT_COSTS["generate-video-pro"]! + unit * 3 + 3 * 2 * anchorUnit,
    )
  })

  it("wan-3 prices each keyframes segment at its own (duration x resolution) row", async () => {
    // Wan is per-second priced but has no `-ref` twin, so it takes the FLAT
    // segmentCost path — each segment resolves the same composite a normal
    // single-shot i2v run would. This is also the probe that segmentCost
    // forwards `resolution`: a 720p answer here means the 1080p lever is
    // being dropped and every 1080p pro run under-reserves by 2x.
    const p = await computeGenerateVideoProPricing({
      provider: "wan-3",
      resolution: "1080p",
      // 23s delivered as 3 segments: sum(10,8,6) == ceil(23 + 0.3 x 2), the
      // stitch-loss identity explicitSplit enforces.
      durationSec: 23,
      segmentDurations: [10, 8, 6],
      renderMethod: "keyframes",
      aspectRatio: "16:9",
    })
    expect(p.segmentCosts).toEqual([
      STATIC_CREDIT_COSTS["wan-3:10s:1080p"]!,
      STATIC_CREDIT_COSTS["wan-3:8s:1080p"]!,
      STATIC_CREDIT_COSTS["wan-3:6s:1080p"]!,
    ])
    expect(p.segmentCosts).toEqual([800, 640, 480])
    expect(p.noRefPerSec).toBe(0)
    expect(p.refPerSec).toBe(0)
  })

  it("gemini-omni-flash prices per DURATION TIER, like its sibling", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "gemini-omni-flash",
      resolution: "720p",
      durationSec: 24,
      segmentDurations: [10, 8, 6],
      renderMethod: "keyframes",
      aspectRatio: "16:9",
    })
    expect(p.segmentCosts).toEqual([
      STATIC_CREDIT_COSTS["gemini-omni-flash:10"]!,
      STATIC_CREDIT_COSTS["gemini-omni-flash:8"]!,
      STATIC_CREDIT_COSTS["gemini-omni-flash:6"]!,
    ])
    expect(p.segmentCosts).toEqual([320, 270, 210])
  })

  it("gemini-omni-video prices per DURATION TIER, not flat", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "gemini-omni-video",
      resolution: "720p",
      durationSec: 24,
      segmentDurations: [10, 8, 6],
      renderMethod: "keyframes",
      aspectRatio: "16:9",
    })
    expect(p.segmentCosts).toEqual([
      STATIC_CREDIT_COSTS["gemini-omni-video:10"]!,
      STATIC_CREDIT_COSTS["gemini-omni-video:8"]!,
      STATIC_CREDIT_COSTS["gemini-omni-video:6"]!,
    ])
  })

  it("a single-segment flat-priced keyframes run still reserves anchors", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "grok-i2v",
      resolution: "720p",
      durationSec: 6,
      renderMethod: "keyframes",
      aspectRatio: "16:9",
    })
    expect(p.mode).toBe("single")
    expect(p.segmentDurations).toEqual([6])
    expect(p.segmentCosts).toEqual([STATIC_CREDIT_COSTS["grok-i2v:6s"]!])
  })

  it("snaps a single-segment duration the provider cannot render", async () => {
    // veo3 offers 4/6/8 — a requested 5s delivers 4s (nearest, ties down), and
    // clampedDurationSec reports what the user actually gets.
    const p = await computeGenerateVideoProPricing({
      provider: "veo3",
      resolution: "720p",
      durationSec: 5,
      renderMethod: "keyframes",
      aspectRatio: "16:9",
    })
    expect(p.clampedDurationSec).toBe(4)
    expect(p.segmentDurations).toEqual([4])
  })

  it("refuses to price EXTEND on a provider with no reference-video transport", async () => {
    // The money-side backstop for the render-method gate: reserving credits for
    // a run whose transport does not exist is worse than a 400.
    for (const provider of ["veo3", "gemini-omni-video", "gemini-omni-flash", "wan-3", "wan-3-prime", "kling-3-omni", "grok-i2v", "happyhorse-ref2v"]) {
      await expect(
        computeGenerateVideoProPricing({ provider, resolution: "720p", durationSec: 30 }),
      ).rejects.toThrow(/renderMethod "keyframes" only/)
    }
  })

  it("every extend-eligible SKU really has a per-second axis at every catalog resolution", async () => {
    // The durable twin of the literal list above. GVP_EXTEND_PROVIDERS is
    // DERIVED from the catalog's "video-reference" feature, so a catalog edit
    // alone can open the multi-segment arm for a model that has no
    // `<id>:8s:<res>-ref` row. When that happens `hasPerSecRate` is false, both
    // rates are 0, and reserveBase collapses to the plan fee — a plausible
    // successful quote for a run that can cost thousands of credits, which
    // commit_credits can only refund, never top up.
    for (const provider of GVP_EXTEND_PROVIDERS) {
      const resolutions = MODEL_CATALOG[provider]?.resolutions ?? []
      expect(resolutions.length, `${provider} declares no catalog resolutions`).toBeGreaterThan(0)
      for (const resolution of resolutions) {
        const p = await computeGenerateVideoProPricing({ provider, resolution, durationSec: 60 })
        expect(p.mode, `${provider}@${resolution}`).toBe("multi")
        expect(p.noRefPerSec, `${provider}@${resolution} has no no-ref 8s anchor`).toBeGreaterThan(0)
        expect(p.refPerSec, `${provider}@${resolution} has no -ref 8s anchor`).toBeGreaterThan(0)
        expect(p.reserveBase, `${provider}@${resolution}`).toBeGreaterThan(
          STATIC_CREDIT_COSTS["generate-video-pro"]!,
        )
      }
    }
  })

  it("still prices EXTEND for the r2v family (gate is not over-broad)", async () => {
    for (const provider of ["seedance-2", "seedance-2-fast", "seedance-2-mini", "minimax-h3"]) {
      const p = await computeGenerateVideoProPricing({ provider, resolution: "720p", durationSec: 30 })
      expect(p.mode).toBe("multi")
      expect(p.reserveBase).toBeGreaterThan(0)
    }
  })

  it("packs a sparse provider's own lengths without explicit segmentDurations", async () => {
    // The app owns the sparse packer: the plugin's pinned @nodaro/shared lags
    // (the deployed copy has no minimax-h3 in MODEL_CATALOG at all), so it
    // cannot read a trustworthy duration set. It plans against
    // pricing.segmentDurations, which is produced here.
    const p = await computeGenerateVideoProPricing({
      provider: "veo3",
      resolution: "720p",
      durationSec: 30,
      renderMethod: "keyframes",
      aspectRatio: "16:9",
    })
    expect(p.mode).toBe("multi")
    // Every entry must be a length veo3 actually renders.
    for (const d of p.segmentDurations) expect([4, 6, 8]).toContain(d)
    // ...and the delivered duration lands as close to 30s as that menu allows.
    expect(Math.abs(p.clampedDurationSec - 30)).toBeLessThanOrEqual(1)
  })

  it("packs every blessed sparse provider to lengths it can render", async () => {
    for (const [provider, allowed] of [
      ["veo3", [4, 6, 8]],
      ["veo3.1", [4, 6, 8]],
      ["veo3_lite", [4, 6, 8]],
      ["gemini-omni-video", [4, 6, 8, 10]],
      ["grok-i2v", [6, 10]],
    ] as const) {
      for (const durationSec of [20, 30, 45, 60]) {
        const p = await computeGenerateVideoProPricing({
          provider, resolution: "720p", durationSec, renderMethod: "keyframes", aspectRatio: "16:9",
        })
        for (const d of p.segmentDurations) {
          expect(allowed as readonly number[], `${provider} @${durationSec}s`).toContain(d)
        }
        expect(p.segmentCosts?.length).toBe(p.segmentDurations.length)
      }
    }
  })

  it("shortens rather than throwing when the segment ceiling binds before the duration cap", async () => {
    // veo3 tops out at 8s/segment, so the 24-segment ceiling delivers ~185s
    // while GENERATE_VIDEO_PRO_MAX_DURATION is already 300 in both deployed
    // environments. Before this clamp, nMin (ceil(300/8) = 38) exceeded nMax
    // (24), the candidate loop never ran, and a reachable request threw
    // "cannot pack 300s" at reserve time.
    // Both deployed environments run GENERATE_VIDEO_PRO_MAX_DURATION=300; the
    // suite's default is the code default of 120, under which the cap binds
    // first and the ceiling is never reached. Pin the deployed value so this
    // exercises the case that actually exists in production.
    const prevCap = process.env.GENERATE_VIDEO_PRO_MAX_DURATION
    process.env.GENERATE_VIDEO_PRO_MAX_DURATION = "300"
    try {
      const p = await computeGenerateVideoProPricing({
        provider: "veo3",
        resolution: "720p",
        durationSec: 300,
        renderMethod: "keyframes",
        aspectRatio: "16:9",
      })
      expect(p.segmentCount).toBeLessThanOrEqual(24)
      for (const d of p.segmentDurations) expect([4, 6, 8]).toContain(d)
      // Delivered is what actually fits, and it is REPORTED, not silently padded.
      expect(p.clampedDurationSec).toBeLessThan(300)
      expect(p.clampedDurationSec).toBeGreaterThan(180)
      expect(p.segmentCosts?.length).toBe(p.segmentCount)
    } finally {
      if (prevCap === undefined) delete process.env.GENERATE_VIDEO_PRO_MAX_DURATION
      else process.env.GENERATE_VIDEO_PRO_MAX_DURATION = prevCap
    }
  })

  it("never throws for any blessed sparse provider across the whole cap range", async () => {
    for (const provider of ["veo3", "veo3.1", "veo3_lite", "gemini-omni-video", "gemini-omni-flash", "grok-i2v"]) {
      for (const durationSec of [4, 10, 60, 120, 185, 240, 300]) {
        const p = await computeGenerateVideoProPricing({
          provider, resolution: "720p", durationSec, renderMethod: "keyframes", aspectRatio: "16:9",
        })
        expect(p.segmentCount, `${provider} @${durationSec}s`).toBeGreaterThan(0)
        expect(p.segmentCount, `${provider} @${durationSec}s`).toBeLessThanOrEqual(24)
        expect(p.reserveBase, `${provider} @${durationSec}s`).toBeGreaterThan(0)
      }
    }
  })

  it("the preferred-segment lever snaps to a length the sparse provider offers", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "veo3",
      resolution: "720p",
      durationSec: 40,
      preferredSegmentSec: 5, // not on veo3's menu — snaps to 4 (nearest, ties down)
      renderMethod: "keyframes",
      aspectRatio: "16:9",
    })
    expect(new Set(p.segmentDurations)).toEqual(new Set([4]))
  })

  it("reports end-anchor capability so the plugin need not read a stale catalog", async () => {
    const withEnd = await computeGenerateVideoProPricing({
      provider: "minimax-h3", resolution: "2K", durationSec: 30, renderMethod: "keyframes", aspectRatio: "16:9",
    })
    // The bug this fixes: minimax-h3 carries "end-frame" but the plugin's
    // wantEndAnchor was gated on the Seedance family by name.
    expect(withEnd.endAnchors).toBe(true)
    const without = await computeGenerateVideoProPricing({
      provider: "grok-i2v", resolution: "720p", durationSec: 30, renderMethod: "keyframes", aspectRatio: "16:9",
    })
    expect(without.endAnchors).toBe(false)
  })

  it("a flat-priced continuation bills only its own segments, from segmentCosts", async () => {
    const p = await computeGenerateVideoProContinuationPricing({
      provider: "veo3",
      resolution: "720p",
      segmentDurations: [8, 8, 8],
      fromSegment: 3,
      renderMethod: "keyframes",
    })
    const unit = STATIC_CREDIT_COSTS["veo3"]!
    expect(p.segmentCosts).toEqual([unit, unit, unit]) // parent-aligned, full array
    expect(p.billFromSegment).toBe(3)
    expect(p.reserveBase).toBe(STATIC_CREDIT_COSTS["generate-video-pro"]! + unit)
  })
})

/**
 * OFF-GRID SEGMENT DURATIONS SNAP (2026-08-06).
 *
 * The caller that produces an explicit `segmentDurations` array cannot know the
 * provider's duration menu: `nodaro-cloud-plugins` builds against a PUBLISHED
 * `@nodaro/shared` whose MODEL_CATALOG lags this repo's by whole releases (the
 * installed 2.1.0 has no `minimax-h3` entry at all, for a model that has been a
 * shipping GVP SKU since 2026-08-02). So the side WITH the fresh catalog does
 * the grid-aware step — and declares that it did, because the plugin's echo
 * guard exists to catch an app that silently IGNORED the field and only an
 * explicit declaration tells that apart from a deliberate snap.
 *
 * Before this, recast's scene-aligned pack (arbitrary ints 4..15, packed
 * provider-blind) could never satisfy a sparse menu, so every model outside the
 * seedance/minimax-h3 families failed to price and the run could not start.
 */
describe("explicit segmentDurations — off-grid entries snap onto the provider's menu", () => {
  it("snaps a scene-aligned pack onto veo3's 4/6/8 menu instead of throwing", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "veo3",
      resolution: "720p",
      durationSec: 26,
      renderMethod: "keyframes",
      segmentDurations: [10, 9, 8],
    })
    expect(p.segmentDurations).toEqual([8, 8, 8])
    for (const d of p.segmentDurations) expect([4, 6, 8]).toContain(d)
    expect(p.segmentDurationsSnapped).toBe(true)
  })

  it("preserves entry COUNT and order — the scene count never moves", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "gemini-omni-video",
      resolution: "720p",
      durationSec: 30,
      renderMethod: "keyframes",
      segmentDurations: [5, 11, 15],
    })
    expect(p.segmentDurations).toHaveLength(3)
    // 5 -> 4 (tie 4/6 rounds down), 11 -> 10, 15 -> 10
    expect(p.segmentDurations).toEqual([4, 10, 10])
    expect(p.segmentCount).toBe(3)
    expect(p.segmentDurationsSnapped).toBe(true)
  })

  it("leaves a grid-VALID sparse pack alone and does not flag a snap", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "veo3",
      resolution: "720p",
      durationSec: 18,
      renderMethod: "keyframes",
      segmentDurations: [8, 6, 4],
    })
    expect(p.segmentDurations).toEqual([8, 6, 4])
    expect(p.segmentDurationsSnapped).toBeUndefined()
  })

  it("a snapped CONTIGUOUS pack skips the sum-equality guard rather than throwing", async () => {
    // happyhorse-i2v is contiguous 3..15, so 16 is off-grid and snaps to 15.
    // The sum-equality drift guard is the check for an array priced VERBATIM;
    // a snapped array was not, so its delivered duration derives from the pack.
    const p = await computeGenerateVideoProPricing({
      provider: "happyhorse-i2v",
      resolution: "720p",
      durationSec: 30,
      renderMethod: "keyframes",
      segmentDurations: [16, 15],
    })
    expect(p.segmentDurations).toEqual([15, 15])
    expect(p.segmentDurationsSnapped).toBe(true)
  })

  it("REGRESSION BAR: an in-grid seedance-2 pack is byte-identical and unflagged", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 30,
      renderMethod: "keyframes",
      segmentDurations: [11, 10, 10],
    })
    expect(p.segmentDurations).toEqual([11, 10, 10])
    expect(p.segmentDurationsSnapped).toBeUndefined()
  })

  it("a non-integer entry is still a hard failure — snapping is for the MENU, not for garbage", async () => {
    await expect(
      computeGenerateVideoProPricing({
        provider: "veo3",
        resolution: "720p",
        durationSec: 20,
        renderMethod: "keyframes",
        segmentDurations: [7.5, 8],
      }),
    ).rejects.toThrow(/integer/)
  })
})

/**
 * UNSUPPORTED RESOLUTIONS SNAP TO THE NEAREST TIER (2026-08-06).
 *
 * The clamp used to snap to the model's HIGHEST supported tier, so a request
 * for the CHEAPEST resolution on a model that lacks it quoted the priciest one
 * — 480p on veo3 (720p/1080p/4k) priced and reserved 4k. Nobody asking for
 * 480p wants to be charged for 4k.
 *
 * Nearest is only safe because the clamped value is now ECHOED and the render
 * uses it: a run priced at 720p renders at 720p, so the reserve cannot come in
 * under what is delivered.
 */
describe("clampResolution — an unsupported tier snaps to the NEAREST, not the priciest", () => {
  it("prices 480p on veo3 as its lowest real tier, not 4k", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "veo3", resolution: "480p", durationSec: 8,
      renderMethod: "keyframes", segmentDurations: [8],
    })
    expect(p.resolution).toBe("720p")
  })

  it("snaps DOWN as readily as up — 4k on a 480p/720p model is 720p", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "seedance-2-fast", resolution: "4k", durationSec: 8,
    })
    expect(p.resolution).toBe("720p")
  })

  it("echoes a supported resolution untouched", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "1080p", durationSec: 8,
    })
    expect(p.resolution).toBe("1080p")
  })

  it("breaks a tie toward the CHEAPER tier", async () => {
    // 720p is equidistant from 480p and 1080p. Charging someone more than they
    // asked for is the worse error.
    const p = await computeGenerateVideoProPricing({
      provider: "happyhorse-ref2v", resolution: "480p", durationSec: 8,
      renderMethod: "keyframes", segmentDurations: [8],
    })
    expect(p.resolution).toBe("720p")
  })

  it("keeps Hailuo's own two-value space", async () => {
    // 768P/2K is not this vocabulary; its own normalizer still decides.
    const p = await computeGenerateVideoProPricing({
      provider: "minimax-h3", resolution: "768p", durationSec: 8,
    })
    expect(p.resolution).toBe("768P")
  })

  it("REGRESSION BAR: a supported request prices exactly as before", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: "seedance-2", resolution: "720p", durationSec: 8,
    })
    expect(p.reserveBase).toBe(820)
    expect(p.creditIdentifier).toBe("seedance-2:8s:720p")
  })
})
