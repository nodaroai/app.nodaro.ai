/**
 * The server's run estimate prices a Dubbing node as the editor quotes it: its
 * language's per-minute row × the started minutes of the span (the window,
 * else the source length the graph tells), marked up once — the dubbing
 * route's charge for that span. One minute when nothing tells the span.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { settings } = vi.hoisted(() => ({
  settings: { current: { cost_markup_percent: 15, service_margin_percent: { "elevenlabs-dubbing": 12 } as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true }
})
function modelPricingQuery() {
  const query = {
    select: () => query,
    order: () => query,
    eq: () => query,
    single: async () => ({ data: null, error: { code: "PGRST116" } }),
    range: async () => ({ data: [], error: null }),
  }
  return query
}
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      return modelPricingQuery()
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings.current }))

import { CreditsService, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { dubbingBaseCredits } from "../../../lib/dubbing-span.js"

const charge = async (language: string, rateId: string, seconds: number) =>
  applyServiceMarkup(await dubbingBaseCredits(language, seconds), settings.current as never, rateId)

const dub = (data: Record<string, unknown> = {}) => ({ id: "x", type: "dubbing", data: { targetLanguage: "es", ...data } })

beforeEach(() => invalidateModelPricingCache())

describe("a Dubbing node in the server's run estimate", () => {
  it("is the route's charge for the started minutes of a wired upload", async () => {
    const video = { id: "v", type: "upload-video", data: { url: "https://m.test/v.mp4", duration: 290 } }
    expect(await CreditsService.estimateWorkflowCredits([dub(), video], [{ source: "v", target: "x", targetHandle: "video" }])).toBe(
      await charge("es", "elevenlabs-dubbing", 290),
    )
  })

  it("reads an uploaded AUDIO source's recorded length, as the editor does", async () => {
    const audio = { id: "a", type: "upload-audio", data: { url: "https://m.test/a.mp3", metadata: { durationSeconds: 61 } } }
    expect(await CreditsService.estimateWorkflowCredits([dub(), audio], [{ source: "a", target: "x", targetHandle: "audio" }])).toBe(
      await charge("es", "elevenlabs-dubbing", 120),
    )
  })

  it("is the window when one is set, on the language's row (Hebrew on the project API's)", async () => {
    expect(await CreditsService.estimateWorkflowCredits([dub({ startTime: 0, endTime: 400 })], [])).toBe(await charge("es", "elevenlabs-dubbing", 400))
    expect(await CreditsService.estimateWorkflowCredits([dub({ targetLanguage: "he", startTime: 0, endTime: 130 })], [])).toBe(
      await charge("he", "elevenlabs-dubbing-v2", 130),
    )
  })

  it("is one minute when nothing tells the span (the run measures the source before it reserves)", async () => {
    expect(await CreditsService.estimateWorkflowCredits([dub({ sourceUrl: "https://m.test/watch?v=1" })], [])).toBe(await charge("es", "elevenlabs-dubbing", 60))
  })
})
