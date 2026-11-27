// @test-units-by-name looks up only the magi-2 credit rows it names
/**
 * Generate Video Pro prices MAGI-2 on its own per-second rows at 1080p (its one
 * resolution), keyframes only — the same `magi-2:<N>s:1080p` rows a single run
 * holds. model_pricing reads are mocked to MISS, so the real
 * STATIC_CREDIT_COSTS decide (as in generate-video-pro-credits.test.ts).
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

import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { computeGenerateVideoProPricing } from "../generate-video-pro-credits.js"
import { STATIC_CREDIT_COSTS, invalidateModelPricingCache } from "../credits.js"

const P = "magi-2"

beforeEach(() => {
  invalidateModelPricingCache()
})

describe("Generate Video Pro on MAGI-2", () => {
  it("prices each keyframes segment at the row a single run of that length holds", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: P,
      resolution: "1080p",
      // 23 s delivered as 3 segments: sum(10, 8, 6) == ceil(23 + 0.3 x 2).
      durationSec: 23,
      segmentDurations: [10, 8, 6],
      renderMethod: "keyframes",
      aspectRatio: "16:9",
    })
    expect(p.segmentCosts).toEqual([
      STATIC_CREDIT_COSTS["magi-2:10s:1080p"]!,
      STATIC_CREDIT_COSTS["magi-2:8s:1080p"]!,
      STATIC_CREDIT_COSTS["magi-2:6s:1080p"]!,
    ])
    expect(p.segmentCosts).toEqual([440, 360, 270])
    expect(STATIC_CREDIT_COSTS["magi-2:8s:1080p"]).toBe(STATIC_CREDIT_COSTS[buildVideoCreditModelIdentifier(P, 8, undefined, undefined, undefined, "1080p")])
    expect(p.noRefPerSec).toBe(0)
    expect(p.refPerSec).toBe(0)
    expect(p.resolution).toBe("1080p")
  })

  it("a resolution it does not render is priced and rendered at 1080p", async () => {
    const p = await computeGenerateVideoProPricing({
      provider: P,
      resolution: "720p",
      durationSec: 23,
      segmentDurations: [10, 8, 6],
      renderMethod: "keyframes",
      aspectRatio: "16:9",
    })
    expect(p.resolution).toBe("1080p")
    expect(p.segmentCosts).toEqual([440, 360, 270])
  })

  it("the extend render is refused: MAGI-2 is keyframes only", async () => {
    await expect(computeGenerateVideoProPricing({ provider: P, resolution: "1080p", durationSec: 30 })).rejects.toThrow(/renderMethod "keyframes" only/)
  })
})
