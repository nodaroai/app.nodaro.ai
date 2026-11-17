// @test-units-by-name looks up only the seedance-2-5-flash credit rows it names
/**
 * Generate Video Pro prices Seedance 2.5 Flash on Flash's own rows, at 480p and
 * 720p, under both render methods — never Seedance 2.5's rows, never 1080p.
 * model_pricing reads are mocked to MISS, so the real STATIC_CREDIT_COSTS
 * decide (as in generate-video-pro-credits.test.ts).
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
import { STATIC_CREDIT_COSTS, invalidateModelPricingCache } from "../credits.js"

const P = "seedance-2-5-flash"

beforeEach(() => {
  invalidateModelPricingCache()
})

describe("Generate Video Pro on Seedance 2.5 Flash", () => {
  it("a single segment is priced on Flash's own row", async () => {
    const r = await computeGenerateVideoProPricing({ provider: P, resolution: "720p", durationSec: 8 })
    expect(r.mode).toBe("single")
    expect(r.creditIdentifier).toBe("seedance-2-5-flash:8s:720p")
    expect(r.reserveBase).toBe(STATIC_CREDIT_COSTS["seedance-2-5-flash:8s:720p"])
  })

  for (const resolution of ["480p", "720p"]) {
    it(`extend render at ${resolution}: per-second rates are Flash's 8 s rows (plain and -ref)`, async () => {
      const r = await computeGenerateVideoProPricing({ provider: P, resolution, durationSec: 50, renderMethod: "extend" })
      expect(r.mode).toBe("multi")
      expect(r.noRefPerSec).toBe(STATIC_CREDIT_COSTS[`${P}:8s:${resolution}`]! / 8)
      expect(r.refPerSec).toBe(STATIC_CREDIT_COSTS[`${P}:8s:${resolution}-ref`]! / 8)
      expect(r.noRefPerSec).not.toBe(STATIC_CREDIT_COSTS[`seedance-2-5:8s:${resolution}`]! / 8)
    })

    it(`keyframes render at ${resolution}: every segment at Flash's plain rate`, async () => {
      const r = await computeGenerateVideoProPricing({ provider: P, resolution, durationSec: 50, renderMethod: "keyframes", aspectRatio: "16:9" })
      expect(r.mode).toBe("multi")
      expect(r.noRefPerSec).toBe(STATIC_CREDIT_COSTS[`${P}:8s:${resolution}`]! / 8)
    })
  }

  it("a 1080p request renders and is priced at 720p", async () => {
    const r = await computeGenerateVideoProPricing({ provider: P, resolution: "1080p", durationSec: 50, renderMethod: "extend" })
    expect(r.resolution).toBe("720p")
    expect(r.noRefPerSec).toBe(STATIC_CREDIT_COSTS[`${P}:8s:720p`]! / 8)
  })
})
