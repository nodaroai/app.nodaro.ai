import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * An AUTO-duration run with no reference video is reserved at the model's
 * longest clip; once delivered it must cost exactly what a fixed-duration
 * request of that length costs — same identifier builder, same price lookup.
 */
const probe = vi.hoisted(() => ({ probeMediaDuration: vi.fn(async (_url: string) => 5) }))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe.probeMediaDuration }))

const pricing = vi.hoisted(() => ({
  getModelCreditBaseCost: vi.fn(async (id: string) => ({ creditCost: id.length, isEnabled: true, tierRestriction: null })),
}))
vi.mock("../credits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credits.js")>()),
  getModelCreditBaseCost: pricing.getModelCreditBaseCost,
}))

import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { seedance2AutoDurationActualBaseCredits } from "../seedance2-ref-video-credits.js"

const OUT = "https://kie.example/out.mp4"
const pricedId = () => pricing.getModelCreditBaseCost.mock.calls.at(-1)![0]

beforeEach(() => {
  probe.probeMediaDuration.mockReset()
  pricing.getModelCreditBaseCost.mockClear()
})

describe("seedance2AutoDurationActualBaseCredits", () => {
  it.each([
    [5.04, 5, "container overhang is not an extra second"],
    [5.0, 5, "exact"],
    [5.3, 6, "a genuinely in-between clip pays the next tier, never the cheaper one"],
    [29.97, 30, "the ceiling"],
  ])("a %ss delivery is priced as a %ss request (%s)", async (measured, seconds) => {
    probe.probeMediaDuration.mockResolvedValue(measured)
    await seedance2AutoDurationActualBaseCredits({ provider: "seedance-2-5", resolution: "480p", outputUrl: OUT })
    expect(pricedId()).toBe(buildVideoCreditModelIdentifier("seedance-2-5", seconds, undefined, undefined, undefined, "480p", false))
    expect(pricedId()).toBe(`seedance-2-5:${seconds}s:480p`)
  })

  it("the 2.0 family lands on its coarser ladder, like a fixed request", async () => {
    probe.probeMediaDuration.mockResolvedValue(6.02)
    await seedance2AutoDurationActualBaseCredits({ provider: "seedance-2", resolution: "720p", outputUrl: OUT })
    expect(pricedId()).toBe("seedance-2:8s:720p")
  })

  it("never the -ref composite — nothing was wired", async () => {
    probe.probeMediaDuration.mockResolvedValue(8)
    await seedance2AutoDurationActualBaseCredits({ provider: "seedance-2-5", resolution: undefined, outputUrl: OUT })
    expect(pricedId()).not.toContain("-ref")
  })

  it("throws on an unusable measurement so the caller commits the reservation", async () => {
    for (const bad of [NaN, 0, -1]) {
      probe.probeMediaDuration.mockResolvedValue(bad)
      await expect(
        seedance2AutoDurationActualBaseCredits({ provider: "seedance-2-5", resolution: "480p", outputUrl: OUT }),
      ).rejects.toThrow(/unusable/)
    }
    expect(pricing.getModelCreditBaseCost).not.toHaveBeenCalled()
  })
})
