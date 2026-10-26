import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { VIDEO_REF_VIDEO_DURATION_LIMITS } from "@nodaro/shared/models"

/**
 * POST /v1/credits/seedance-ref-estimate — the price of a Seedance 2 run with
 * reference video(s), read without creating a job or reserving anything.
 *
 * The provider bills `unit × (input + output)` seconds, so the price depends on
 * the reference clips' real lengths. The estimate probes them exactly as the
 * reservation does and prices them through the reservation's own function, so
 * the number IS what a run of the same request reserves. A clip whose URL is
 * not known yet (its upstream has not produced it) is quoted as the provider's
 * worst case (`credits`, never below the reserve) with the shortest clip as
 * the floor (`min`), and `exact: false`.
 */

const probe = vi.hoisted(() => ({ durations: new Map<string, number>(), calls: [] as string[] }))
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  probeMediaDuration: async (url: string) => {
    probe.calls.push(url)
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error("ffprobe failed")
    return d
  },
}))
// No model_pricing rows: every id prices from STATIC_CREDIT_COSTS.
vi.mock("../../../lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "order", "range", "limit"]) chain[m] = () => chain
  chain.single = async () => ({ data: null, error: { code: "PGRST116", message: "no rows" } })
  return { supabase: { from: () => chain } }
})
const settings = vi.hoisted(() => ({ value: { cost_markup_percent: 0 } as Record<string, unknown> }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => settings.value }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => true,
}))

import { registerSeedanceRefEstimate } from "../seedance-ref-estimate.js"
import { STATIC_CREDIT_COSTS } from "../../billing/credits.js"
import { seedance2RefVideoBaseCreditsFromDurations } from "../../billing/seedance2-ref-video-credits.js"
import { applyServiceMarkup } from "../../billing/service-margin.js"

const URL_ = "/v1/credits/seedance-ref-estimate"
const CLIP_10 = "https://cdn.example/clip-10.mp4"
const CLIP_4 = "https://cdn.example/clip-4.mp4"
const perSec = (res: string) => STATIC_CREDIT_COSTS[`seedance-2-5:8s:${res}-ref`]! / 8

describe("POST /v1/credits/seedance-ref-estimate", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    probe.durations = new Map([[CLIP_10, 10.04], [CLIP_4, 4]])
    probe.calls = []
    settings.value = { cost_markup_percent: 0 }
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const user = req.headers["x-test-user"]
      if (typeof user === "string") req.userId = user
    })
    registerSeedanceRefEstimate(app)
    await app.ready()
  })
  afterEach(async () => { await app.close() })

  const post = (payload: Record<string, unknown>, user: string | null = "user-a") =>
    app.inject({ method: "POST", url: URL_, payload, headers: user ? { "x-test-user": user } : {} })

  it("requires authentication", async () => {
    const res = await post({ provider: "seedance-2-5", referenceVideoUrls: [CLIP_10] }, null)
    expect(res.statusCode).toBe(401)
  })

  it("an Auto edit of a probed clip: unit × (clip + the clip rounded up plus a second), exact", async () => {
    const res = await post({ provider: "seedance-2-5", resolution: "720p", duration: VIDEO_DURATION_AUTO, referenceVideoUrls: [CLIP_10] })
    expect(res.statusCode).toBe(200)
    // 10.04 s → 11 s, + 1 s margin = 12 s held out (not the model's 30 s).
    const expected = Math.ceil(perSec("720p") * (10.04 + 12))
    expect(res.json().data).toEqual({ credits: expected, min: expected, exact: true })
    expect(probe.calls).toEqual([CLIP_10])
  })

  it("an Auto run with a clip not produced yet: the worst case (the model's longest clip) as credits, the shortest clip's hold as min", async () => {
    const res = await post({ provider: "seedance-2-5", resolution: "720p", duration: VIDEO_DURATION_AUTO, referenceVideoUrls: [], unknownReferenceVideos: 1 })
    const { minSec, maxSec } = VIDEO_REF_VIDEO_DURATION_LIMITS["seedance-2-5"]!
    expect(res.json().data).toEqual({
      credits: Math.ceil(perSec("720p") * (maxSec + 30)),
      min: Math.ceil(perSec("720p") * (minSec + Math.ceil(minSec) + 1)),
      exact: false,
    })
  })

  it("an 8 s run with a 10 s clip bills the output at the longer of the two", async () => {
    const res = await post({ provider: "seedance-2-5", resolution: "720p", duration: 8, referenceVideoUrls: [CLIP_10] })
    expect(res.json().data.credits).toBe(Math.ceil(perSec("720p") * (10.04 + 10.04)))
  })

  it("equals the reservation's own arithmetic, markup applied once at the run's identifier", async () => {
    settings.value = { cost_markup_percent: 40 }
    const res = await post({ provider: "seedance-2-5", resolution: "1080p", duration: 8, referenceVideoUrls: [CLIP_4, CLIP_10] })
    const base = seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 8, requestedDuration: 8, durationsSec: [4, 10.04] })
    expect(res.json().data.credits).toBe(applyServiceMarkup(base, settings.value as never, "seedance-2-5:8s:1080p-ref"))
  })

  it("prices an omitted resolution at the model's UI fill and a draft at 480p, as the run sends", async () => {
    const unset = await post({ provider: "seedance-2-5", duration: 8, referenceVideoUrls: [CLIP_4] })
    const draft = await post({ provider: "seedance-2-5", resolution: "1080p", draft: true, duration: 8, referenceVideoUrls: [CLIP_4] })
    const at480 = Math.ceil(perSec("480p") * (4 + 8))
    expect(unset.json().data.credits).toBe(at480)
    expect(draft.json().data.credits).toBe(at480)
  })

  it("a clip the probe cannot read counts as the provider's worst case — what the reservation holds", async () => {
    const res = await post({ provider: "seedance-2-5", resolution: "720p", duration: 8, referenceVideoUrls: ["https://cdn.example/broken.mp4"] })
    const cap = VIDEO_REF_VIDEO_DURATION_LIMITS["seedance-2-5"]!.maxSec
    expect(res.json().data).toEqual({ credits: Math.ceil(perSec("720p") * (cap + cap)), min: Math.ceil(perSec("720p") * (cap + cap)), exact: true })
  })

  it("a clip not produced yet: worst case as credits, the shortest clip as min, not exact", async () => {
    const res = await post({ provider: "seedance-2-5", resolution: "720p", duration: 8, referenceVideoUrls: [], unknownReferenceVideos: 1 })
    const { minSec, maxSec } = VIDEO_REF_VIDEO_DURATION_LIMITS["seedance-2-5"]!
    expect(res.json().data).toEqual({
      credits: Math.ceil(perSec("720p") * (maxSec + maxSec)),
      min: Math.ceil(perSec("720p") * (minSec + 8)),
      exact: false,
    })
    expect(probe.calls).toEqual([])
  })

  it("refuses an out-of-bounds clip with the run's own 400", async () => {
    probe.durations.set(CLIP_10, 45)
    const res = await post({ provider: "seedance-2-5", duration: 8, referenceVideoUrls: [CLIP_10] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
  })

  it("refuses a provider whose reference-video runs are not priced this way, and an empty request", async () => {
    expect((await post({ provider: "kling", referenceVideoUrls: [CLIP_10] })).statusCode).toBe(400)
    expect((await post({ provider: "seedance-2-5", referenceVideoUrls: [] })).statusCode).toBe(400)
  })
})
