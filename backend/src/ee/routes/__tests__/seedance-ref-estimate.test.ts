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
import { generateOpenApiDoc } from "../../../lib/openapi-registry.js"

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
    const base = seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec: [4, 10.04] })
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

  // Seedance 2.5 `referenceTaskType` (optional): the quote prices the run the
  // declaration sends, by the run's own rule. An unknown value is ignored —
  // never a 400 that would break an editor that sends something new.
  it("an edit of a measured clip at a stored 5 s is quoted as the run sends it: the Auto edit's price", async () => {
    const edit = await post({ provider: "seedance-2-5", resolution: "720p", duration: 5, referenceTaskType: "edit", referenceVideoUrls: [CLIP_10] })
    const auto = await post({ provider: "seedance-2-5", resolution: "720p", duration: VIDEO_DURATION_AUTO, referenceVideoUrls: [CLIP_10] })
    expect(edit.statusCode).toBe(200)
    expect(edit.json()).toStrictEqual(auto.json())
    const stored = await post({ provider: "seedance-2-5", resolution: "720p", duration: 5, referenceVideoUrls: [CLIP_10] })
    expect(edit.json()).not.toStrictEqual(stored.json())
  })

  it("an extend at Auto with a 4 s clip is quoted at the 8 s it runs", async () => {
    const extend = await post({ provider: "seedance-2-5", resolution: "720p", duration: VIDEO_DURATION_AUTO, referenceTaskType: "extend", referenceVideoUrls: [CLIP_4] })
    const eight = await post({ provider: "seedance-2-5", resolution: "720p", duration: 8, referenceVideoUrls: [CLIP_4] })
    expect(extend.json()).toStrictEqual(eight.json())
  })

  it("the OpenAPI document shows referenceTaskType as an optional enum of the four values", () => {
    const doc = generateOpenApiDoc() as { paths: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: { properties?: Record<string, { enum?: unknown[] }>; required?: string[] } }> } } }> }
    const schema = doc.paths[URL_]?.post?.requestBody?.content?.["application/json"]?.schema
    expect(schema?.properties?.referenceTaskType?.enum).toStrictEqual(["auto", "reference", "edit", "extend"])
    expect(schema?.required ?? []).not.toContain("referenceTaskType")
  })

  it.each([["auto"], ["bogus"], [3], [null]])("referenceTaskType %j: accepted, and the body is the one without the field", async (value) => {
    const body = { provider: "seedance-2-5", resolution: "720p", duration: 5, referenceVideoUrls: [CLIP_10] }
    const asked = await post({ ...body, referenceTaskType: value })
    expect(asked.statusCode).toBe(200)
    expect(asked.json()).toStrictEqual((await post(body)).json())
  })

  it("refuses a provider whose reference-video runs are not priced this way, and an empty request", async () => {
    expect((await post({ provider: "kling", referenceVideoUrls: [CLIP_10] })).statusCode).toBe(400)
    expect((await post({ provider: "seedance-2-5", referenceVideoUrls: [] })).statusCode).toBe(400)
  })

  // A run that declares `reference` with an automatic length is reserved at the
  // model's longest output (Seedance picks a reference's length; only an edit
  // follows its clip), so the estimate prices it there too.
  describe("referenceTaskType", () => {
    const CLIP_5 = "https://cdn.example/clip-5.mp4"
    const CLIP_12 = "https://cdn.example/clip-12.mp4"
    beforeEach(() => {
      probe.durations.set(CLIP_5, 5)
      probe.durations.set(CLIP_12, 12)
    })
    const auto = { provider: "seedance-2-5", resolution: "720p", duration: VIDEO_DURATION_AUTO }
    const worst = (durationsSec: number[]) => seedance2RefVideoBaseCreditsFromDurations({
      provider: "seedance-2-5", resolution: "720p", outputDurationSec: 30, requestedDuration: VIDEO_DURATION_AUTO, referenceTaskType: "reference", durationsSec,
    })

    it("reference + Auto, one 5 s clip at 720p: the worst case, ceil(95 × 35) = 3325 — what the run reserves", async () => {
      const res = await post({ ...auto, referenceTaskType: "reference", referenceVideoUrls: [CLIP_5] })
      expect(res.statusCode).toBe(200)
      expect(worst([5])).toBe(Math.ceil(perSec("720p") * 35))
      expect(res.json().data).toStrictEqual({ credits: worst([5]), min: worst([5]), exact: true })
    })

    it("reference + Auto, two clips: the longest output, both clips as input", async () => {
      const res = await post({ ...auto, referenceTaskType: "reference", referenceVideoUrls: [CLIP_5, CLIP_12] })
      expect(res.json().data).toStrictEqual({ credits: worst([5, 12]), min: worst([5, 12]), exact: true })
    })

    it("reference + Auto with a clip not produced yet: the worst case, and the least is the longest output with the shortest clip", async () => {
      const res = await post({ ...auto, referenceTaskType: "reference", referenceVideoUrls: [], unknownReferenceVideos: 1 })
      const { minSec, maxSec } = VIDEO_REF_VIDEO_DURATION_LIMITS["seedance-2-5"]!
      expect(res.json().data).toStrictEqual({ credits: worst([maxSec]), min: worst([minSec]), exact: false })
      // Undeclared, the least is the edit hold of the shortest clip.
      const plain = await post({ ...auto, referenceVideoUrls: [], unknownReferenceVideos: 1 })
      expect(plain.json().data).toStrictEqual({ credits: worst([maxSec]), min: Math.ceil(perSec("720p") * (minSec + Math.ceil(minSec) + 1)), exact: false })
    })

    it("anything else answers exactly what the request without the field answers", async () => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ ...auto, referenceVideoUrls: [CLIP_5] }, "edit"],
        [{ ...auto, referenceVideoUrls: [CLIP_5] }, "auto"],
        [{ ...auto, duration: 8, referenceVideoUrls: [CLIP_5] }, "extend"],
        [{ ...auto, duration: 8, referenceVideoUrls: [CLIP_5] }, "reference"],
        [{ ...auto, provider: "seedance-2", referenceVideoUrls: [CLIP_5] }, "reference"],
        [{ ...auto, referenceVideoUrls: [], unknownReferenceVideos: 1 }, "edit"],
      ]
      for (const [body, referenceTaskType] of cases) {
        const declared = await post({ ...body, referenceTaskType })
        const plain = await post(body)
        expect(declared.statusCode, `${referenceTaskType} ${JSON.stringify(body)}`).toBe(200)
        expect(declared.json(), `${referenceTaskType} ${JSON.stringify(body)}`).toStrictEqual(plain.json())
      }
    })

    it("a draft answers what the same request at 480p without Draft answers — reference + Auto at the worst case", async () => {
      const body = { ...auto, referenceVideoUrls: [CLIP_5] }
      for (const referenceTaskType of ["reference", "edit", "extend"]) {
        const draft = await post({ ...body, draft: true, referenceTaskType })
        expect(draft.statusCode, referenceTaskType).toBe(200)
        expect(draft.json(), referenceTaskType).toStrictEqual((await post({ ...body, resolution: "480p", referenceTaskType })).json())
      }
      const worst480 = seedance2RefVideoBaseCreditsFromDurations({
        provider: "seedance-2-5", resolution: "480p", outputDurationSec: 30, requestedDuration: VIDEO_DURATION_AUTO, referenceTaskType: "reference", durationsSec: [5],
      })
      expect((await post({ ...body, draft: true, referenceTaskType: "reference" })).json().data).toStrictEqual({ credits: worst480, min: worst480, exact: true })
    })

    // An unknown value is taken off the body and priced as Auto, never a 400
    // (`ignoringUnknownTaskType`: an editor newer than this server keeps its price).
    it("a value outside the vocabulary is ignored: the answer of the request without the field", async () => {
      const asked = await post({ ...auto, referenceTaskType: "Edit", referenceVideoUrls: [CLIP_5] })
      expect(asked.statusCode).toBe(200)
      expect(asked.json()).toStrictEqual((await post({ ...auto, referenceVideoUrls: [CLIP_5] })).json())
    })
  })
})
