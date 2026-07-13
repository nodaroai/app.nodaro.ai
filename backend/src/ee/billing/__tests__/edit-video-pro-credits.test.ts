/**
 * edit-video-pro pricing helper — THE GOLDEN TABLE.
 *
 * `computeEditVideoProPricing` is the money-authoritative reserve formula for
 * the edit-video-pro node (replace-span Seedance-2 bridge). Unlike its sibling
 * `generate-video-pro-credits.ts` (which trusts a user-declared duration), this
 * helper PROBES the source video server-side via `probeVideoSource` so the
 * resolution tier, the tail edge, and both MIN_REF floors are all knowable on
 * a successful probe — reserve == commit exactly in that case. On a failed (or
 * absent) probe it worst-cases: TOP catalog tier, both head/tail refs assumed
 * present — this can only ever OVER-reserve, mirroring the platform precedent
 * `seedance2RefVideoBaseCreditsFromUrls`'s "never under-reserve" discipline.
 *
 * `probeVideoSource` is mocked so every row is independent of ffmpeg/network
 * and of the mocked resolution/duration this file supplies as input.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  probeVideoSource: vi.fn(),
}))

import { probeVideoSource } from "../../../providers/video/ffmpeg-utils.js"
import { computeEditVideoProPricing, deriveBridgeResolution } from "../edit-video-pro-credits.js"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError } from "../credits.js"
import { MODEL_CATALOG } from "@nodaro/shared"

const probeMock = vi.mocked(probeVideoSource)

// `resolutions` is optional on the shared MODEL_CATALOG entry type (not every
// model kind has one), but seedance-2 (a video model) always seeds it.
const SEEDANCE_2_RESOLUTIONS: readonly string[] = MODEL_CATALOG["seedance-2"]!.resolutions!

beforeEach(() => {
  probeMock.mockReset()
})

// A 720p-bridging portrait probe (width < height, min(width,height) lands
// exactly on the 720p tier's height threshold) — used as the default probe
// result for every "golden table" row unless a row states otherwise.
const probe720 = (durationSeconds: number) => ({ width: 720, height: 1280, durationSeconds })

// ---------------------------------------------------------------------------
// Sanity: pin the seeded composites the golden table's hand-computed comments
// below are derived from, so a future re-price of these rows fails loudly
// here instead of silently invalidating the golden numbers (mirrors
// generate-video-pro-credits.test.ts's identical sanity block).
// ---------------------------------------------------------------------------

describe("golden-table composite sanity (seedance-2 ref family + edit-video-pro fee, credits.ts)", () => {
  it("seedance-2 8s -ref composites by tier", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:480p-ref"]).toBe(23) // 2.875/sec
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:720p-ref"]).toBe(50) // 6.25/sec
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:1080p-ref"]).toBe(124) // 15.5/sec
    expect(STATIC_CREDIT_COSTS["seedance-2:8s:4k-ref"]).toBe(256) // 32/sec
  })
  it("edit-video-pro fee row is seeded and matches the migration value (10)", () => {
    // Simplified stand-in for "fee missing -> PriceNotConfiguredError": rather
    // than reaching into module internals to delete the key, pin the seeded
    // value here so the migration-sync test (which reads this same export)
    // and this pricing helper can never silently drift apart.
    expect(STATIC_CREDIT_COSTS["edit-video-pro"]).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Golden table — successful probe, 720p bridge resolution (probe 720x1280,
// which floors to the 720p tier: min(720,1280) = 720 = the 720p threshold).
// ---------------------------------------------------------------------------

describe("computeEditVideoProPricing — golden table (seedance-2, 720p bridge unless noted)", () => {
  it("mid-video span 10 (A=2,B=12,D=20) -> reserveBase 92, reserveResolution 720p", async () => {
    probeMock.mockResolvedValue(probe720(20))
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 2,
      spanEnd: 12,
    })
    expect(probeMock).toHaveBeenCalledWith("https://cdn.example.com/src.mp4")
    expect(result.probe).toEqual({ width: 720, height: 1280, durationSec: 20 })
    expect(result.spanStartSec).toBe(2)
    expect(result.spanEndSec).toBe(12)
    expect(result.clampedSpanSec).toBe(10)
    // head exists (A=2>0) + tail exists (D-B=8>tolerance) -> outerSeamLossReserve = 0.3*2 = 0.6
    expect(result.outerSeamLossReserve).toBe(0.6)
    // computeSplit(10+0.6=10.6, 120) -> round to 11, single segment
    expect(result.segmentCount).toBe(1)
    expect(result.totalRawSec).toBe(11)
    // refOut=1 (A>=MIN_REF) + (n-1)=0 + refIn=1 (tail>=MIN_REF) = 2
    expect(result.refsSecReserve).toBe(2)
    expect(result.reserveResolution).toBe("720p")
    // feeBase(10) + ceil(6.25 × (11 + 2)) = 10 + ceil(81.25) = 10 + 82 = 92
    expect(result.reserveBase).toBe(92)
    expect(result.spanExceedsSource).toBe(false)
  })

  it("A=0 span 10 (A=0,B=10,D=20) -> reserveBase 79", async () => {
    probeMock.mockResolvedValue(probe720(20))
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 0,
      spanEnd: 10,
    })
    expect(result.clampedSpanSec).toBe(10)
    // no head (A=0) + tail exists -> outerSeamLossReserve = 0.3*1 = 0.3
    expect(result.outerSeamLossReserve).toBe(0.3)
    expect(result.segmentCount).toBe(1)
    expect(result.totalRawSec).toBe(10)
    // refOut=0 (A<MIN_REF) + (n-1)=0 + refIn=1 = 1
    expect(result.refsSecReserve).toBe(1)
    expect(result.reserveResolution).toBe("720p")
    // 10 + ceil(6.25 × (10 + 1)) = 10 + ceil(68.75) = 10 + 69 = 79
    expect(result.reserveBase).toBe(79)
  })

  it("B==D (A=10,B=20,D=20) -> reserveBase 79 (probe makes the tail edge knowable)", async () => {
    probeMock.mockResolvedValue(probe720(20))
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 10,
      spanEnd: 20,
    })
    expect(result.clampedSpanSec).toBe(10)
    // head exists (A=10>0), but tail does NOT exist (D-B=0, known exactly from the probe)
    expect(result.outerSeamLossReserve).toBe(0.3)
    expect(result.segmentCount).toBe(1)
    expect(result.totalRawSec).toBe(10)
    // refOut=1 (A>=MIN_REF) + (n-1)=0 + refIn=0 (no tail) = 1 -- SAME total as the A=0 row
    // above (which had refOut=0+refIn=1) despite a different reason, landing on the same 79.
    expect(result.refsSecReserve).toBe(1)
    expect(result.reserveBase).toBe(79)
    expect(result.spanExceedsSource).toBe(false)
  })

  it("A=0.5 (A=0.5,B=10.5,D=20) -> reserveBase 85 (refOut floors to 0 below MIN_REF)", async () => {
    probeMock.mockResolvedValue(probe720(20))
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 0.5,
      spanEnd: 10.5,
    })
    expect(result.clampedSpanSec).toBe(10)
    // head exists (0.5>0) + tail exists -> 0.6, same as the A=2 row -> split rounds to 11
    expect(result.outerSeamLossReserve).toBe(0.6)
    expect(result.segmentCount).toBe(1)
    expect(result.totalRawSec).toBe(11)
    // refOut=0 (0.5 < MIN_REF=1, the "floor") + (n-1)=0 + refIn=1 = 1
    expect(result.refsSecReserve).toBe(1)
    // 10 + ceil(6.25 × (11 + 1)) = 10 + ceil(75) = 10 + 75 = 85
    expect(result.reserveBase).toBe(85)
  })

  it("span 20 mid (A=10,B=30,D=40) -> reserveBase 167", async () => {
    probeMock.mockResolvedValue(probe720(40))
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 10,
      spanEnd: 30,
    })
    expect(result.clampedSpanSec).toBe(20)
    expect(result.outerSeamLossReserve).toBe(0.6)
    // computeSplit(20.6, 120) -> d=21 > maxSeg(15) -> multi, n=2, s=ceil(21+0.3)=22, durations [11,11]
    expect(result.segmentCount).toBe(2)
    expect(result.totalRawSec).toBe(22)
    expect(result.segmentDurations).toEqual([11, 11])
    // refOut=1 + (n-1)=1 + refIn=1 = 3
    expect(result.refsSecReserve).toBe(3)
    // 10 + ceil(6.25 × (22 + 3)) = 10 + ceil(156.25) = 10 + 157 = 167
    expect(result.reserveBase).toBe(167)
  })

  it("span 4, mid-video (A=8,B=12,D=20) -> reserveBase 54", async () => {
    probeMock.mockResolvedValue(probe720(20))
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 8,
      spanEnd: 12,
    })
    expect(result.clampedSpanSec).toBe(4)
    expect(result.outerSeamLossReserve).toBe(0.6)
    // computeSplit(4.6, 120) -> round to 5, single segment
    expect(result.segmentCount).toBe(1)
    expect(result.totalRawSec).toBe(5)
    // refOut=1 + (n-1)=0 + refIn=1 = 2
    expect(result.refsSecReserve).toBe(2)
    // 10 + ceil(6.25 × (5 + 2)) = 10 + ceil(43.75) = 10 + 44 = 54
    expect(result.reserveBase).toBe(54)
  })
})

// ---------------------------------------------------------------------------
// The money-side span clamp ([4, maxSpanSec] window from spanStart) is
// independent of the probe — it fires on the raw args before any source
// duration is known.
// ---------------------------------------------------------------------------

describe("span clamps to the money-side cap independent of the probe", () => {
  it("spanEnd - spanStart = 200 -> clampedSpanSec clamps to 120 (maxSpanSec)", async () => {
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      spanStart: 0,
      spanEnd: 200,
    })
    expect(probeMock).not.toHaveBeenCalled() // no sourceUrl supplied
    expect(result.spanEndSec).toBe(120)
    expect(result.clampedSpanSec).toBe(120)
    expect(result.maxSpanSec).toBe(120)
  })
})

// ---------------------------------------------------------------------------
// Worst-case fallback: probe rejects, or no sourceUrl was supplied at all.
// Both land on the SAME fallback path — TOP catalog tier, tail AND refIn
// assumed present (over-reserve only; never under-reserve).
// ---------------------------------------------------------------------------

describe("probe failure / missing sourceUrl -> worst-case fallback (over-reserve only)", () => {
  it("probe failure -> TOP catalog tier (4k), tail+refIn assumed, probe:null", async () => {
    probeMock.mockRejectedValue(new Error("ffprobe: connection reset"))
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 2,
      spanEnd: 12,
    })
    expect(probeMock).toHaveBeenCalled()
    expect(result.probe).toBeNull()
    // Same span/split math as the "mid-video span 10" golden row (A=2,B=12):
    // clampedSpanSec=10, outerSeamLossReserve=0.6 (head assumed via A>0, tail
    // ALWAYS assumed present on a failed probe), split single s=11.
    expect(result.clampedSpanSec).toBe(10)
    expect(result.outerSeamLossReserve).toBe(0.6)
    expect(result.totalRawSec).toBe(11)
    // refOut=1 (A>=MIN_REF) + (n-1)=0 + refIn=1 (assumed, probe is null) = 2
    expect(result.refsSecReserve).toBe(2)
    // TOP tier of MODEL_CATALOG["seedance-2"].resolutions by pixel height.
    const topTier = SEEDANCE_2_RESOLUTIONS[SEEDANCE_2_RESOLUTIONS.length - 1]
    expect(topTier).toBe("4k")
    expect(result.reserveResolution).toBe("4k")
    // feeBase(10) + ceil(rate_4k(32) × (S'=11 + refsSecReserve=2)) = 10 + ceil(32×13) = 10 + 416 = 426
    expect(result.reserveBase).toBe(426)
    expect(result.spanExceedsSource).toBe(false) // unknowable without a probe -- never flagged
  })

  it("no sourceUrl -> identical worst-case path, probe never called", async () => {
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      spanStart: 2,
      spanEnd: 12,
    })
    expect(probeMock).not.toHaveBeenCalled()
    expect(result.probe).toBeNull()
    expect(result.reserveResolution).toBe("4k")
    expect(result.reserveBase).toBe(426)
    expect(result.spanExceedsSource).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Source-duration clamp: once a probe succeeds, a requested spanEnd beyond
// the actual source duration is clamped (money can never reserve for content
// that doesn't exist), and flagged via spanExceedsSource -- UNLESS the
// overshoot is within SPAN_TOLERANCE_SEC (0.05s), a probe-jitter allowance.
// ---------------------------------------------------------------------------

describe("source-duration clamp (spanEnd vs probed duration)", () => {
  it("spanEnd > D + 0.05 (A=2,B=25,D=20) -> spanExceedsSource true, money clamped to D", async () => {
    probeMock.mockResolvedValue(probe720(20))
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 2,
      spanEnd: 25,
    })
    expect(result.spanExceedsSource).toBe(true)
    expect(result.spanEndSec).toBe(20) // clamped to the probed duration
    expect(result.clampedSpanSec).toBe(18)
    expect(result.reserveBase).toBe(142)
  })

  it("spanEnd within tolerance of D (A=2,B=19.98,D=20) -> tail treated absent, no flag", async () => {
    probeMock.mockResolvedValue(probe720(20))
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 2,
      spanEnd: 19.98,
    })
    expect(result.spanExceedsSource).toBe(false)
    expect(result.spanEndSec).toBe(19.98) // NOT clamped -- within tolerance, not an overshoot
    // tail treated absent (D-B=0.02 <= tolerance) -> only the head edge counts
    // toward outerSeamLossReserve (0.3*(1+0)=0.3, not 0.6).
    expect(result.outerSeamLossReserve).toBe(0.3)
    expect(result.reserveBase).toBe(142) // same split/refs as the row above -- rounds identically
  })
})

// ---------------------------------------------------------------------------
// Hard-fail policy: an unpriced provider/tier composite must never silently
// under-reserve.
// ---------------------------------------------------------------------------

describe("missing pricing configuration", () => {
  it("provider with no seeded 8s -ref composites -> PriceNotConfiguredError", async () => {
    await expect(
      computeEditVideoProPricing({
        provider: "totally-unseeded-provider-xyz",
        spanStart: 0,
        spanEnd: 10,
      }),
    ).rejects.toThrow(PriceNotConfiguredError)
    // Fails fast on the rate lookup, before ever attempting to probe.
    expect(probeMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// refPerSecByResolution must be seeded for EVERY tier the catalog advertises
// for the provider -- a partially-seeded rate map would silently produce
// `undefined` reserveBase math for an untested tier.
// ---------------------------------------------------------------------------

describe("refPerSecByResolution rate-map coverage", () => {
  it("covers every seedance-2 catalog resolution tier", async () => {
    probeMock.mockResolvedValue(probe720(20))
    const result = await computeEditVideoProPricing({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 2,
      spanEnd: 12,
    })
    expect(Object.keys(result.refPerSecByResolution).sort()).toEqual(
      [...SEEDANCE_2_RESOLUTIONS].sort(),
    )
  })
})

// ---------------------------------------------------------------------------
// deriveBridgeResolution: largest catalog tier whose pixel height <=
// min(width,height), floored at the smallest tier.
// ---------------------------------------------------------------------------

describe("deriveBridgeResolution", () => {
  it("picks the largest tier whose height <= min(width,height)", () => {
    expect(deriveBridgeResolution("seedance-2", 1920, 1080)).toBe("1080p")
    expect(deriveBridgeResolution("seedance-2", 720, 1280)).toBe("720p")
  })

  it("floors at the smallest tier when below every threshold", () => {
    expect(deriveBridgeResolution("seedance-2", 100, 100)).toBe("480p")
  })
})
