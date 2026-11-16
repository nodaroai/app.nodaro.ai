// @test-units-by-name names no node unit: it reads only the sent-priced extend rows of STATIC_CREDIT_COSTS (extend-video is a legacy node)
import { describe, it, expect, vi } from "vitest"

// The price rows a hold reads, from the static table (no database here). The
// table is read when a price is asked for, never while the mock is built.
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/credit-base-cost.js")>()
  return {
    ...actual,
    unitRateBaseCredits: async (id: string, units: number) => {
      const { STATIC_CREDIT_COSTS } = await import("@/ee/billing/credits.js")
      return actual.quoteBaseCredits(STATIC_CREDIT_COSTS[id]!, units)
    },
  }
})

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeVideoSource: vi.fn(),
}))

import { seedanceExtendSentPricedProviderOf, seedanceExtendStampedBaseCredits, stampSeedanceExtendSource } from "../seedance-extend-credits.js"
import { probeVideoSource } from "@/providers/video/ffmpeg-utils.js"

// A workflow run holds a sent-priced extend on the source length it stamped
// (`sourcePictureSec`), the whole 10 s window when none: (sent + added) ÷ 2 of
// the provider's own two-second row (decided 2026-11-16 for Seedance 2.5 Flash).
describe("the workflow run's hold of a sent-priced extend", () => {
  it.each([
    // [provider, stamped source, seconds added, resolution, base]
    ["seedance-2-5-flash-extend", 6, 8, "720p", 896], // (6 + 8) ÷ 2 × 128
    ["seedance-2-5-flash-extend", undefined, 8, "720p", 1152], // the whole window: (10 + 8) ÷ 2 × 128
    ["seedance-2-5-flash-extend", 25, 8, "480p", 522], // (10 + 8) ÷ 2 × 58
    ["seedance-2-5-flash-extend", 6, 8, "1080p", 896], // 1080p is held, and runs, at 720p
    ["seedance-2-5-extend", 6, 8, "720p", 1330], // (6 + 8) ÷ 2 × 190
  ] as const)("%s on a %s s source + %s s at %s holds base %s", async (provider, sourcePictureSec, duration, resolution, base) => {
    const payload = { provider, duration, resolution, ...(sourcePictureSec !== undefined ? { sourcePictureSec } : {}) }
    expect(await seedanceExtendStampedBaseCredits("extend-video", payload)).toBe(base)
  })

  it("names the provider a job runs, the retired id as the provider it became; any other job none", () => {
    expect(seedanceExtendSentPricedProviderOf("extend-video", { provider: "seedance-2-5-flash-extend" })).toBe("seedance-2-5-flash-extend")
    expect(seedanceExtendSentPricedProviderOf("extend-video", { provider: "seedance-2-extend" })).toBe("seedance-2-5-extend")
    expect(seedanceExtendSentPricedProviderOf("extend-video", { provider: "seedance-2-0-extend" })).toBeUndefined()
    expect(seedanceExtendSentPricedProviderOf("image-to-video", { provider: "seedance-2-5-flash-extend" })).toBeUndefined()
  })
})

// Decided 2026-11-16: the workflow run refuses a Flash source whose shape Flash
// does not take, as the route does, before anything is held.
describe("the workflow run's measurement of the source", () => {
  const SOURCE = "https://cdn.example.com/source.mp4"
  const payload = (provider: string) => ({ provider, video: SOURCE, duration: 8, resolution: "720p" })

  it("stamps the picture's length", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 6.2, videoDurationSeconds: 6 })
    expect(await stampSeedanceExtendSource("extend-video", payload("seedance-2-5-flash-extend"))).toEqual({ ok: true, patch: { sourcePictureSec: 6 } })
  })

  it("refuses a Flash source outside 1:2.5–2.5:1; Seedance 2.5 takes it", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 3840, height: 1080, durationSeconds: 10, videoDurationSeconds: 10 })
    const refused = await stampSeedanceExtendSource("extend-video", payload("seedance-2-5-flash-extend"))
    expect(refused).toMatchObject({ ok: false, code: "video_aspect_unsupported" })
    expect(await stampSeedanceExtendSource("extend-video", payload("seedance-2-5-extend"))).toEqual({ ok: true, patch: { sourcePictureSec: 10 } })
  })

  // Decided 2026-11-16: a Flash source under its documented 2 s is refused here,
  // before the hold; Seedance 2.5's workflow run keeps leaving its 1.8 s to the worker.
  it("refuses a Flash source under 2 s before the hold; Seedance 2.5 stamps a 1.7 s source as it always has", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 1.9, videoDurationSeconds: 1.9 })
    expect(await stampSeedanceExtendSource("extend-video", payload("seedance-2-5-flash-extend"))).toMatchObject({
      ok: false,
      code: "video_too_short",
      message: expect.stringContaining("at least 2s"),
    })
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 2, videoDurationSeconds: 2 })
    expect(await stampSeedanceExtendSource("extend-video", payload("seedance-2-5-flash-extend"))).toEqual({ ok: true, patch: { sourcePictureSec: 2 } })
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 1.7, videoDurationSeconds: 1.7 })
    expect(await stampSeedanceExtendSource("extend-video", payload("seedance-2-5-extend"))).toEqual({ ok: true, patch: { sourcePictureSec: 1.7 } })
  })

  it("a probe that fails stamps nothing and refuses nothing", async () => {
    vi.mocked(probeVideoSource).mockRejectedValue(new Error("unreachable"))
    expect(await stampSeedanceExtendSource("extend-video", payload("seedance-2-5-flash-extend"))).toEqual({ ok: true, patch: { sourcePictureSec: undefined } })
    expect(await stampSeedanceExtendSource("image-to-video", payload("seedance-2-5-flash-extend"))).toEqual({ ok: true, patch: {} })
  })
})
