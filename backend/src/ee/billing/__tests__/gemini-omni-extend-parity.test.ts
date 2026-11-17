// @test-units-by-name prices only the Extend Video provider it names (Gemini Omni Flash 1.2 Extend); extend-video is a legacy node
/**
 * Gemini Omni Flash 1.2 Extend (decided 2026-11-17): one run, one price,
 * wherever it is read. The route's hold, a workflow run's hold, the whole-run
 * quote id (`geminiOmniExtendQuoteCreditId`) through the single GET and the
 * batch table, and the server's run estimate of a graph that knows the
 * source all come to the same figure — each priced from the two
 * admin-editable rows by the one rule, so a change to either row moves every
 * one of them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { rows, settings } = vi.hoisted(() => ({
  rows: new Map<string, number>(),
  settings: { current: { cost_markup_percent: 15, service_margin_percent: {} as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, config: { ...orig.config, FAL_KEY: "test-fal-key" }, hasCredits: () => true, speechLengthPricingEnabled: () => true }
})
// The workflow run's probe of the source: its picture's length and size.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeVideoSource: vi.fn(),
}))
// model_pricing as an administrator left it: the single lookup (`.eq().single()`) and the paged read (`.range()`).
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      let id: string | undefined
      const query = {
        select: () => query,
        order: () => query,
        eq: (_col: string, value: string) => {
          id = value
          return query
        },
        single: async () => {
          const credit = id === undefined ? undefined : rows.get(id)
          return credit === undefined
            ? { data: null, error: { code: "PGRST116" } }
            : { data: { credit_cost: credit, is_enabled: true, tier_restriction: null }, error: null }
        },
        range: async (from: number) => ({
          data: from > 0 ? [] : [...rows].map(([model_identifier, credit_cost]) => ({ model_identifier, credit_cost })),
          error: null,
        }),
      }
      return query
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings.current }))

import { geminiOmniExtendQuoteCreditId } from "@nodaro/shared/credits"
import { CreditsService, chargedCredits, getChargedPriceTable, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { resolveExtendVideoIdentifier } from "../../../routes/extend-video.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { computeSeedanceExtendCreditOverride } from "../../../services/workflow-engine/node-executor.js"
import { sentChargedExtendBaseCredits, stampSeedanceExtendSource } from "../../../lib/seedance-extend-credits.js"
import { checkExtendSource } from "../../../routes/extend-video.js"
import { probeVideoSource } from "../../../providers/video/ffmpeg-utils.js"
import { geminiOmniExtendResolution } from "@nodaro/render-rules"

const P = "gemini-omni-flash-1-2-extend"

beforeEach(() => {
  settings.current = { cost_markup_percent: 15, service_margin_percent: {} }
  rows.clear()
  invalidateModelPricingCache()
})

/** A source's size: a 4K one unless a case names one (so no tier is capped). */
type Size = { width: number; height: number }
const UHD: Size = { width: 3840, height: 2160 }

/**
 * Every reading of one run on a source of `sourcePictureSec` seconds and
 * `size` pixels: [route hold, workflow hold, quote (single GET), quote (batch
 * table), run estimate]. The route and the workflow run measure the source
 * (the probe is mocked), cap the tier at the source's, and hold; the estimate
 * reads the upload's recorded length and size.
 */
async function readings(sourcePictureSec: number, duration: number, resolution: string, size: Size = UHD): Promise<number[]> {
  vi.mocked(probeVideoSource).mockResolvedValue({ ...size, durationSeconds: sourcePictureSec, videoDurationSeconds: sourcePictureSec })
  // The route: its source check's size caps the tier (the preHandler's rule),
  // then its guard's computed base, marked up once at the id it names.
  const checked = await checkExtendSource(P, "https://m.test/s.mp4")
  if (!checked.ok) throw new Error(checked.message)
  const tier = geminiOmniExtendResolution(resolution, checked.size)
  const body = { provider: P, duration, resolution: tier }
  const routeId = resolveExtendVideoIdentifier(body)
  const route = applyServiceMarkup(await sentChargedExtendBaseCredits({ provider: P, duration, resolution: tier, sourcePictureSec: checked.pictureSec }), settings.current as never, routeId)
  // A workflow run: the job the payload builder queues (at the asked tier),
  // its source stamped (length, capped tier and the id it is held at), held by node-executor.
  const asked = { provider: P, duration, resolution }
  const built = buildPayload({ id: "x", type: "extend-video", data: { ...asked, prompt: "she runs" } }, "job-1", { videoUrl: "https://m.test/s.mp4" })
  const stamp = await stampSeedanceExtendSource("extend-video", built.payload)
  if (!stamp.ok) throw new Error(stamp.message)
  const workflow = await computeSeedanceExtendCreditOverride("extend-video", { ...built.payload, ...stamp.patch }, stamp.modelIdentifier ?? built.modelIdentifier)
  // The whole-run quote id, through both price lookups.
  const quoteId = geminiOmniExtendQuoteCreditId({ sourcePictureSec, duration, resolution: tier })
  const single = await CreditsService.getModelCreditCost(quoteId)
  const batch = chargedCredits(await getChargedPriceTable(), quoteId)
  // The server's run estimate of a graph whose upload records the source's length and size.
  const nodes = [
    { id: "s", type: "upload-video", data: { url: "https://m.test/s.mp4", duration: sourcePictureSec, videoDurationSec: sourcePictureSec, metadata: { ...size } } },
    { id: "x", type: "extend-video", data: { ...asked, prompt: "she runs" } },
  ]
  const estimate = await CreditsService.estimateWorkflowCredits(nodes, [{ source: "s", target: "x", targetHandle: "video" }])
  return [route, workflow!, single, batch!, estimate]
}

describe("Gemini Omni Flash 1.2 Extend: hold == workflow hold == quote id == run estimate", () => {
  // [source, seconds added, resolution, base] — the decided examples, and a fractional source.
  const CASES = [
    [10, 5, "360p", 130],
    [10, 5, "720p", 260],
    [10, 10, "720p", 470],
    [4, 3, "720p", 150],
    [10, 5, "1080p", 370],
    [10, 5, "4k", 680],
    [10, 8, "720p", 390],
    [4.37, 3, "720p", 150],
    [25, 8, "4k", 1050],
    [6.3, 10, "1080p", 670],
  ] as const

  it.each(CASES)("a %s s source + %s s at %s (base %s) reads the same everywhere", async (sec, duration, resolution, base) => {
    const all = await readings(sec, duration, resolution)
    const expected = applyServiceMarkup(base, settings.current as never, `${P}:${resolution}:per-second`)
    expect(all).toEqual([expected, expected, expected, expected, expected])
  })

  it("a grid of sources, lengths and resolutions reads the same everywhere", async () => {
    for (const sec of [3.8, 4, 5.55, 9.25, 10, 12]) {
      for (const duration of [3, 7, 10]) {
        for (const resolution of ["360p", "720p", "1080p", "4k"]) {
          const all = await readings(sec, duration, resolution)
          expect(new Set(all).size, `${sec}s + ${duration}s at ${resolution}: ${all.join(", ")}`).toBe(1)
        }
      }
    }
  })

  it("an admin change to either row moves every reading together", async () => {
    const before = await readings(4.37, 3, "720p")
    rows.set(`${P}:source:per-second`, 9)
    rows.set(`${P}:720p:per-second`, 50)
    invalidateModelPricingCache()
    const after = await readings(4.37, 3, "720p")
    // 4.37 × 9 + 3 × 50 = 189.33 → 190 (it was 150 at the code's rows).
    const expected = applyServiceMarkup(190, settings.current as never, `${P}:720p:per-second`)
    expect(after).toEqual([expected, expected, expected, expected, expected])
    expect(after[0]).not.toBe(before[0])
  })

  // Decided 2026-11-17: a tier above the source's runs, and is charged, at the source's.
  it.each([
    // [size, asked, the tier that runs, base for a 10 s source + 5 s]
    [{ width: 1280, height: 720 }, "4k", "720p", 260],
    [{ width: 1920, height: 1080 }, "4k", "1080p", 370],
    [{ width: 1080, height: 1920 }, "4k", "1080p", 370],
    [{ width: 854, height: 480 }, "1080p", "720p", 260],
    // A source a few lines over a tier is that tier.
    [{ width: 1920, height: 1088 }, "4k", "1080p", 370],
    [{ width: 1296, height: 736 }, "4k", "720p", 260],
    [{ width: 640, height: 360 }, "720p", "360p", 130],
    [{ width: 480, height: 270 }, "720p", "360p", 130],
    // A tier below the source's runs as asked.
    [{ width: 1920, height: 1080 }, "360p", "360p", 130],
  ] as const)("a %j source asked for %s runs at %s, every reading at base %s", async (size, asked, tier, base) => {
    expect(geminiOmniExtendResolution(asked, size)).toBe(tier)
    const all = await readings(10, 5, asked, size)
    const expected = applyServiceMarkup(base, settings.current as never, `${P}:${tier}:per-second`)
    expect(all).toEqual([expected, expected, expected, expected, expected])
  })

  it("a per-row margin on the route's id applies to the quote too", async () => {
    settings.current = { cost_markup_percent: 15, service_margin_percent: { [`${P}:4k:per-second`]: 40 } }
    const all = await readings(10, 5, "4k")
    expect(new Set(all).size).toBe(1)
    expect(all[0]).toBe(applyServiceMarkup(680, settings.current as never, `${P}:4k:per-second`))
  })

  it("a quote id the engine cannot run lands in missing", async () => {
    const table = await getChargedPriceTable()
    for (const id of [
      `${P}:480p:sent-10s:added-8s`, // a resolution it does not render
      `${P}:720p:sent-10s:added-11s`, // a length outside 3–10
      `${P}:720p:sent-12s:added-8s`, // more than the 10 s window
      `${P}:720p:sent-3.5s:added-8s`, // under its shortest source
    ]) expect(table.base(id), id).toBeUndefined()
    // About 4 s: a nominal 4 s clip that measures 3.96 s is priced.
    expect(table.base(`${P}:720p:sent-3.96s:added-3s`)).toBe(150)
  })
})
