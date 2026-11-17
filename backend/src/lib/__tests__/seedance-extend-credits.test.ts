// @test-units-by-name names no node unit: it reads only the sent-priced extend rows of STATIC_CREDIT_COSTS (extend-video is a legacy node)
import { describe, it, expect, vi } from "vitest"

// The install's fal key (Gemini Omni Flash 1.2 Extend runs on fal): set unless a test removes it.
const falKey = vi.hoisted(() => ({ current: "test-fal-key" }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, config: new Proxy(orig.config, { get: (t, k) => (k === "FAL_KEY" ? falKey.current : (t as Record<string | symbol, unknown>)[k]) }) }
})

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
    baseCreditCostFor: async (id: string) => {
      const { STATIC_CREDIT_COSTS } = await import("@/ee/billing/credits.js")
      return STATIC_CREDIT_COSTS[id]!
    },
  }
})

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeVideoSource: vi.fn(),
}))

import { geminiOmniExtendRunBaseCredits, seedanceExtendSentPricedProviderOf, seedanceExtendStampedBaseCredits, stampSeedanceExtendSource } from "../seedance-extend-credits.js"
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

// Decided 2026-11-17: Gemini Omni Flash 1.2 Extend is held by a workflow run on
// the source it stamped, by its own rule (5 per second sent + its resolution's
// rate per second added, rounded up to 10) — the same base the route holds.
describe("Gemini Omni Flash 1.2 Extend in a workflow run", () => {
  const SOURCE = "https://cdn.example.com/source.mp4"
  const P = "gemini-omni-flash-1-2-extend"

  it.each([
    // [stamped source, seconds added, resolution, base]
    [10, 5, "360p", 130],
    [10, 5, "720p", 260],
    [10, 10, "720p", 470],
    [4, 3, "720p", 150],
    [10, 5, "1080p", 370],
    [10, 5, "4k", 680],
    [10, 8, "720p", 390],
    [undefined, 8, "720p", 390], // the whole window
    [4.37, 3, "720p", 150],
  ] as const)("holds a %s s source + %s s at %s at base %s, the route's own figure", async (sourcePictureSec, duration, resolution, base) => {
    const payload = { provider: P, duration, resolution, ...(sourcePictureSec !== undefined ? { sourcePictureSec } : {}) }
    expect(await seedanceExtendStampedBaseCredits("extend-video", payload)).toBe(base)
    expect(await geminiOmniExtendRunBaseCredits({ duration, resolution, sourcePictureSec })).toBe(base)
  })

  it("is named as the job's provider", () => {
    expect(seedanceExtendSentPricedProviderOf("extend-video", { provider: P })).toBe(P)
  })

  it("stamps the picture's length of a 16:9 or 9:16 source", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1080, height: 1920, durationSeconds: 6.2, videoDurationSeconds: 6 })
    expect(await stampSeedanceExtendSource("extend-video", { provider: P, video: SOURCE })).toEqual({ ok: true, patch: { sourcePictureSec: 6 } })
  })

  it.each([[640, 640], [1440, 1080], [2560, 1080]])("refuses a %s×%s source before the hold", async (width, height) => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width, height, durationSeconds: 10, videoDurationSeconds: 10 })
    const stamp = await stampSeedanceExtendSource("extend-video", { provider: P, video: SOURCE })
    expect(stamp).toMatchObject({ ok: false, code: "video_aspect_unsupported" })
    expect(stamp.ok === false && stamp.message).toMatch(/16:9 or 9:16/)
  })

  it("takes a nominal 4 s clip measuring 3.96 s (about 4 s)", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 3.96, videoDurationSeconds: 3.96 })
    expect(await stampSeedanceExtendSource("extend-video", { provider: P, video: SOURCE })).toEqual({ ok: true, patch: { sourcePictureSec: 3.96 } })
  })

  it("refuses a source under about 4 s (3.5 s) before the hold", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 3.5, videoDurationSeconds: 3.5 })
    expect(await stampSeedanceExtendSource("extend-video", { provider: P, video: SOURCE })).toMatchObject({ ok: false, code: "video_too_short" })
  })
})

// Decided 2026-11-17: the workflow run caps the tier at the source's and holds
// at that tier's row; an install with no fal key is refused before the hold.
describe("Gemini Omni Flash 1.2 Extend in a workflow run: the tier and the fal key", () => {
  const SOURCE = "https://cdn.example.com/source.mp4"
  const P = "gemini-omni-flash-1-2-extend"

  it("a 1280×720 source asked for 4k is stamped at 720p and held at its row", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 10, videoDurationSeconds: 10 })
    expect(await stampSeedanceExtendSource("extend-video", { provider: P, video: SOURCE, resolution: "4k" })).toEqual({
      ok: true,
      patch: { sourcePictureSec: 10, resolution: "720p" },
      modelIdentifier: "gemini-omni-flash-1-2-extend:720p:per-second",
    })
  })

  it("a tier at or below the source's is left as asked", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 10, videoDurationSeconds: 10 })
    expect(await stampSeedanceExtendSource("extend-video", { provider: P, video: SOURCE, resolution: "720p" })).toEqual({ ok: true, patch: { sourcePictureSec: 10 } })
  })

  it("an anamorphic source is judged by its display shape", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1440, height: 1080, sampleAspectRatio: 4 / 3, durationSeconds: 10, videoDurationSeconds: 10 })
    const stamp = await stampSeedanceExtendSource("extend-video", { provider: P, video: SOURCE, resolution: "4k" })
    expect(stamp).toMatchObject({ ok: true, patch: { resolution: "1080p" } })
  })

  it("an install with no fal key is refused before the source is probed", async () => {
    falKey.current = ""
    try {
      vi.mocked(probeVideoSource).mockClear()
      const stamp = await stampSeedanceExtendSource("extend-video", { provider: P, video: SOURCE })
      expect(stamp).toMatchObject({ ok: false, code: "provider_unavailable" })
      expect(stamp.ok === false && stamp.message).toMatch(/FAL_KEY/)
      expect(probeVideoSource).not.toHaveBeenCalled()
      // Seedance's extends do not need it.
      vi.mocked(probeVideoSource).mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 6, videoDurationSeconds: 6 })
      expect((await stampSeedanceExtendSource("extend-video", { provider: "seedance-2-5-extend", video: SOURCE })).ok).toBe(true)
    } finally {
      falKey.current = "test-fal-key"
    }
  })
})
