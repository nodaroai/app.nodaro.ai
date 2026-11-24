/**
 * POST /v1/video-to-video with `provider: "nodaro-prism"` / `"nodaro-pulse"`:
 * the route answers Video Remake's QUOTE and the request that runs it on
 * POST /v1/video-remake. No job, no hold, no queue, and the credit guard is
 * never reached. POST /v1/quote runs the same step and answers the same
 * figures in a node quote's shape. A request naming no provider is still the
 * default's (a Seedance edit). The engine's estimate route, the guard, the
 * job insert and the queue are stood in for; nothing is generated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  cloud: true,
  guardCalls: 0,
  /** What the stand-in estimate route received. */
  estimates: [] as Array<{ body: Record<string, unknown>; headers: Record<string, unknown> }>,
  /** What it answers. */
  estimate: { status: 200, body: {} as unknown },
  deniedModels: [] as string[],
  /** route → refusal of its node door. */
  nodeRefusals: {} as Record<string, { code: string; message: string }>,
  nodeDoorsAsked: [] as string[],
  engines: ["nodaro-prism", "nodaro-pulse"] as string[],
  /** Whether each Flash choice is offered (Offer Flash, `video-remake-flash.ts`). */
  flashOffered: {} as Record<string, boolean>,
}))
vi.mock("@/lib/video-remake-flash.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video-remake-flash.js")>()),
  flashChoiceOffered: async (choice: string) => state.flashOffered[choice] === true,
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", INTERNAL_ORCHESTRATOR_SECRET: "test-secret" },
  isCloud: () => state.cloud, hasCredits: () => state.cloud, isCommunity: () => !state.cloud, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => { state.guardCalls++ },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1, watermark: false }),
  resolveWebSurfaceFlag: vi.fn(async () => false),
  runNodeRefusal: vi.fn(async (route: string) => {
    state.nodeDoorsAsked.push(route)
    return state.nodeRefusals[route]
  }),
}))
vi.mock("@/lib/surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-deny.js")>()),
  isModelDenied: (id: string) => state.deniedModels.includes(id),
}))
vi.mock("@/lib/private-plugins/supports-registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/private-plugins/supports-registry.js")>()),
  getPluginSupports: () => ({ castSwap: { engines: state.engines } }),
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
// The Seedance lane's handler: reached only by the default, and only named here.
vi.mock("../text-to-video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../text-to-video.js")>()),
  textToVideoPricing: { prechecks: [], modelResolver: () => "seedance-2-5", opts: {} },
  handleTextToVideoRequest: vi.fn(async (req: { body: Record<string, unknown> }) => ({ jobId: "seedance-edit-job", ranOn: req.body.provider })),
}))

import { videoToVideoRoutes, videoToVideoPricing, videoToVideoBody, quoteVideoRemakeEngine } from "../video-to-video.js"
import { insertJob } from "@/lib/insert-job.js"
import { videoQueue } from "@/lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"
import { handleTextToVideoRequest } from "../text-to-video.js"
import { VIDEO_TO_VIDEO_NODE_PROVIDERS, VIDEO_TO_VIDEO_PROVIDERS } from "@nodaro/shared/models"
import { assertNoVideoRemakeEngineOnNode } from "@/lib/video-remake-engine-quote.js"

const USER = "00000000-0000-4000-8000-000000000001"
const CLIP = "https://cdn.test/clip.mp4"

const PRISM_ESTIMATE = {
  engine: "nodaro-prism",
  totalCredits: 480,
  expectedCredits: 300,
  breakdown: { base: 20, references: 0, motion: 460, motionExpected: 280 },
  privacyCredits: 35,
  settlesLower: true,
}
const PULSE_ESTIMATE = {
  engine: "nodaro-pulse",
  totalCredits: 220,
  expectedCredits: 220,
  breakdown: { base: 20, references: 0, motion: 200 },
  settlesLower: false,
}

describe("POST /v1/video-to-video — Video Remake's engines are quoted, never run", () => {
  let app: FastifyInstance

  async function boot(opts: { withEngine?: boolean } = {}): Promise<void> {
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
      const internal = req.headers["x-internal-user-id"]
      if (typeof internal === "string") req.userId = internal
    })
    await app.register(async (i) => { await videoToVideoRoutes(i) })
    if (opts.withEngine !== false) {
      app.post("/v1/cast-swap/estimate", async (req, reply) => {
        state.estimates.push({ body: req.body as Record<string, unknown>, headers: req.headers })
        return reply.status(state.estimate.status).send(state.estimate.body)
      })
    }
    // POST /v1/quote, as node-quote.ts runs a type's prechecks: the same functions, `quoteOnly` set.
    app.post("/v1/quote", async (req, reply) => {
      req.body = (req.body as { params: Record<string, unknown> }).params
      req.userId = USER
      req.quoteOnly = true
      for (const precheck of videoToVideoPricing.prechecks) {
        await precheck(req, reply)
        if (reply.sent) return reply
      }
      return reply.status(200).send({ data: { reachedPricing: true } })
    })
    await app.ready()
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    state.cloud = true
    state.guardCalls = 0
    state.estimates = []
    state.estimate = { status: 200, body: PRISM_ESTIMATE }
    state.deniedModels = []
    state.nodeRefusals = {}
    state.nodeDoorsAsked = []
    state.engines = ["nodaro-prism", "nodaro-pulse"]
    state.flashOffered = {}
    await boot()
  })

  afterEach(async () => { await app.close() })

  const run = (over: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/v1/video-to-video", payload: { videoUrl: CLIP, prompt: "make it night", userId: USER, ...over } })
  const quote = (params: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/quote", payload: { type: "video-to-video", params: { videoUrl: CLIP, prompt: "make it night", ...params } } })

  function expectNothingStarted(): void {
    expect(state.guardCalls).toBe(0)
    expect(insertJob).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(handleTextToVideoRequest).not.toHaveBeenCalled()
  }

  it("nodaro-prism: a 200 with the quote and the request that runs it, no jobId, nothing held", async () => {
    const res = await run({ provider: "nodaro-prism" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({
      quoteOnly: true,
      message: expect.stringContaining("nothing was started"),
      videoRemake: {
        quote: {
          engine: "nodaro-prism",
          engineName: "Nodaro Prism",
          totalCredits: 480,
          expectedCredits: 300,
          breakdown: { base: 20, references: 0, motion: 460, motionExpected: 280 },
          privacyCredits: 35,
          settlesLower: true,
        },
        run: {
          method: "POST",
          path: "/v1/video-remake",
          body: { videoUrl: CLIP, roles: [], postPrompt: "make it night", engine: "nodaro-prism" },
        },
      },
    })
    expect(body).not.toHaveProperty("jobId")
    expectNothingStarted()
  })

  it("a Flash choice (decided 2026-11-22): quoted as its choice where offered, the run naming it; 409 flash_not_offered where not", async () => {
    state.estimate = { status: 200, body: { ...PULSE_ESTIMATE, engine: "nodaro-pulse-flash", totalCredits: 150, expectedCredits: 150 } }
    const off = await run({ provider: "nodaro-pulse-flash" })
    expect(off.statusCode).toBe(409)
    expect(off.json().error).toEqual({ code: "flash_not_offered", message: "Nodaro Pulse Flash isn't available right now. Choose Nodaro Pulse." })
    expect(state.estimates).toEqual([])
    state.flashOffered = { "nodaro-pulse-flash": true }
    const on = await run({ provider: "nodaro-pulse-flash" })
    expect(on.statusCode).toBe(200)
    expect(on.json().videoRemake.quote).toMatchObject({ engine: "nodaro-pulse-flash", engineName: "Nodaro Pulse Flash", totalCredits: 150 })
    expect(on.json().videoRemake.run.body.engine).toBe("nodaro-pulse-flash")
    // The engine is asked with the Flash choice as it is.
    expect(state.estimates.at(-1)!.body.engine).toBe("nodaro-pulse-flash")
    expectNothingStarted()
    // A node can no more run a Flash choice than an engine.
    expect(() => assertNoVideoRemakeEngineOnNode("nodaro-prism-flash", "Remake")).toThrow(/provider_not_supported: node "Remake" cannot run on nodaro-prism-flash\. Nodaro Prism Flash is a Video Remake engine/)
  })

  it("nodaro-pulse: its own quote, the engine named in the run", async () => {
    state.estimate = { status: 200, body: PULSE_ESTIMATE }
    const res = await run({ provider: "nodaro-pulse", resolution: "1080p" })
    expect(res.statusCode).toBe(200)
    const { videoRemake, quoteOnly, jobId } = res.json()
    expect(quoteOnly).toBe(true)
    expect(jobId).toBeUndefined()
    expect(videoRemake.quote).toMatchObject({ engine: "nodaro-pulse", engineName: "Nodaro Pulse", totalCredits: 220, expectedCredits: 220, settlesLower: false })
    expect(videoRemake.run.body).toEqual({ videoUrl: CLIP, roles: [], postPrompt: "make it night", engine: "nodaro-pulse", resolution: "1080p" })
    expectNothingStarted()
  })

  it("asks the engine's estimate route as the user: the clip, the prompt as postPrompt, no role, the internal engine id", async () => {
    await run({ provider: "nodaro-prism", resolution: "720p", draft: false })
    expect(state.estimates).toHaveLength(1)
    const sent = state.estimates[0]!
    expect(sent.body).toEqual({ videoUrl: CLIP, roles: [], postPrompt: "make it night", engine: "seedance-2-5", resolution: "720p", draft: false })
    expect(sent.headers["x-internal-orchestrator-secret"]).toBe("test-secret")
    expect(sent.headers["x-internal-user-id"]).toBe(USER)
    await run({ provider: "nodaro-pulse" })
    expect(state.estimates[1]!.body.engine).toBe("kling-4")
  })

  it("an older engine's key names are answered as the neutral ones", async () => {
    state.estimate = { status: 200, body: { data: { totalCredits: 500, breakdown: { castSwap: 40, references: 0, seedance: 460 }, maskingCredits: 30, settlesLower: true } } }
    const { videoRemake } = (await run({ provider: "nodaro-prism" })).json()
    expect(videoRemake.quote).toEqual({
      engine: "nodaro-prism",
      engineName: "Nodaro Prism",
      totalCredits: 500,
      breakdown: { references: 0, base: 40, motion: 460 },
      privacyCredits: 30,
      settlesLower: true,
    })
  })

  it("the levers that do not apply are dropped unread: nothing of them reaches Video Remake", async () => {
    const res = await run({
      provider: "nodaro-prism",
      duration: "10", aspectRatio: "9:16", seed: 7, audio: true, multiShots: true,
      negativePrompt: "blur", videoEditDuration: "5", audioSetting: "origin", promptExtend: true, userPrompt: "night",
      trendRun: { slug: "x" }, sessionId: "s-1",
    })
    expect(res.statusCode).toBe(200)
    expect(state.estimates[0]!.body).toEqual({ videoUrl: CLIP, roles: [], postPrompt: "make it night", engine: "seedance-2-5" })
    expect(res.json().videoRemake.run.body).toEqual({ videoUrl: CLIP, roles: [], postPrompt: "make it night", engine: "nodaro-prism" })
  })

  it.each([
    ["referenceImageUrl", "https://cdn.test/a.png"],
    ["referenceImageUrls", ["https://cdn.test/a.png"]],
    ["referenceVideoUrls", ["https://cdn.test/b.mp4"]],
    ["referenceAudioUrls", ["https://cdn.test/c.mp3"]],
  ])("%s is refused with a pointer to Video Remake's own route, nothing asked", async (field, value) => {
    const res = await run({ provider: "nodaro-pulse", [field]: value })
    expect(res.statusCode).toBe(400)
    const { error } = res.json()
    expect(error.code).toBe("validation_error")
    expect(error.message).toContain(field)
    expect(error.message).toContain("POST /v1/video-remake")
    expect(state.estimates).toEqual([])
    expectNothingStarted()
  })

  it("a prompt is required, and the clip must be a URL: 400 before anything is asked", async () => {
    for (const over of [{ prompt: undefined }, { prompt: "   " }, { videoUrl: "not-a-url" }]) {
      const res = await run({ provider: "nodaro-prism", ...over })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(state.estimates).toEqual([])
    expectNothingStarted()
  })

  it("no provider is still the default, a Seedance edit; and a named model is its own", async () => {
    const res = await run()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "seedance-edit-job", ranOn: "seedance-2-5" })
    expect(state.guardCalls).toBe(1)
    expect(state.estimates).toEqual([])

    const wan = await run({ provider: "wan" })
    expect(wan.json()).toEqual({ jobId: "job-1" })
    expect(state.estimates).toEqual([])
  })

  it("only the two public ids: an earlier or internal engine id is an unknown model of this route", async () => {
    for (const provider of ["motion-prism", "motion-pulse", "motion-pro", "motion-lite", "kling-4"]) {
      const res = await run({ provider })
      expect(res.statusCode, provider).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(state.estimates).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("the ids are the route's own: not Video to Video models, and the route's schema does not take them", () => {
    for (const id of ["nodaro-prism", "nodaro-pulse"]) {
      expect(VIDEO_TO_VIDEO_NODE_PROVIDERS as readonly string[]).not.toContain(id)
      expect(VIDEO_TO_VIDEO_PROVIDERS as readonly string[]).not.toContain(id)
      expect(videoToVideoBody.safeParse({ videoUrl: CLIP, prompt: "x", provider: id }).success).toBe(false)
    }
    expect(videoToVideoPricing.prechecks[0]).toBe(quoteVideoRemakeEngine)
  })

  describe("POST /v1/quote agrees with the route", () => {
    it("nodaro-prism: the hold, the expected charge, and that the provider only quotes", async () => {
      const ran = (await run({ provider: "nodaro-prism" })).json().videoRemake.quote
      const res = await quote({ provider: "nodaro-prism" })
      expect(res.statusCode).toBe(200)
      const { data } = res.json()
      expect(data.identifier).toBe("nodaro-prism")
      expect(data.reserve).toBe(ran.totalCredits)
      expect(data.expected).toBe(ran.expectedCredits)
      expect(data.adjustments).toEqual([])
      expect(data.warnings.map((w: { code: string }) => w.code)).toEqual(["quote_only_provider", "settles_to_actual", "refused_clip_retry"])
      expect(data.warnings[2].message).toContain("35")
      // The same estimate, asked the same way.
      expect(state.estimates[1]!.body).toEqual(state.estimates[0]!.body)
      expectNothingStarted()
    })

    it("nodaro-pulse settles at its hold: no expected figure apart, no settles_to_actual", async () => {
      state.estimate = { status: 200, body: PULSE_ESTIMATE }
      const { data } = (await quote({ provider: "nodaro-pulse" })).json()
      expect(data).toEqual({
        identifier: "nodaro-pulse",
        reserve: 220,
        adjustments: [],
        warnings: [expect.objectContaining({ code: "quote_only_provider" })],
      })
    })

    it("refuses what the route refuses: a reference list, a withheld node", async () => {
      expect((await quote({ provider: "nodaro-prism", referenceImageUrls: ["https://cdn.test/a.png"] })).statusCode).toBe(400)
      state.nodeRefusals["/v1/cast-swap"] = { code: "node_not_available", message: "cast-swap is not available" }
      const res = await quote({ provider: "nodaro-prism" })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("node_not_available")
    })

    it("any other provider passes on to the route's own pricing", async () => {
      expect((await quote({ provider: "wan" })).json()).toEqual({ data: { reachedPricing: true } })
      expect(state.estimates).toEqual([])
    })
  })

  describe("gates and refusals: typed, never a fallback to another model", () => {
    it("a self-hosted edition: 404 not_available", async () => {
      state.cloud = false
      const res = await run({ provider: "nodaro-prism" })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe("not_available")
      expect(state.estimates).toEqual([])
      expectNothingStarted()
    })

    it("Cloud without the engine's route: 404 not_available", async () => {
      await app.close()
      await boot({ withEngine: false })
      const res = await run({ provider: "nodaro-pulse" })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe("not_available")
      expectNothingStarted()
    })

    it("both node doors are asked: video-to-video's, then cast-swap's", async () => {
      await run({ provider: "nodaro-prism" })
      expect(state.nodeDoorsAsked).toEqual(["/v1/video-to-video", "/v1/cast-swap"])
    })

    it.each(["/v1/video-to-video", "/v1/cast-swap"])("a deployment that withholds the node of %s: 403 node_not_available", async (route) => {
      state.nodeRefusals[route] = { code: "node_not_available", message: "not offered" }
      const res = await run({ provider: "nodaro-prism" })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ error: { code: "node_not_available", message: "not offered" } })
      expect(state.estimates).toEqual([])
      expectNothingStarted()
    })

    it.each([["nodaro-prism", "nodaro-prism"], ["nodaro-prism", "seedance-2-5"], ["nodaro-pulse", "kling-4"]])(
      "%s where the deployment denies %s: 403 model_not_available",
      async (provider, denied) => {
        state.deniedModels = [denied]
        const res = await run({ provider })
        expect(res.statusCode).toBe(403)
        expect(res.json().error.code).toBe("model_not_available")
        expect(state.estimates).toEqual([])
      },
    )

    it("an engine the loaded plugin does not run: 503 engine_unavailable, never asked", async () => {
      state.engines = ["nodaro-prism"]
      const res = await run({ provider: "nodaro-pulse" })
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe("engine_unavailable")
      expect(state.estimates).toEqual([])
    })

    it("Video Remake's own refusal is answered as its route gives it", async () => {
      state.estimate = { status: 400, body: { error: { code: "clip_out_of_range", message: "The clip must be 4 to 30 seconds long." } } }
      const res = await run({ provider: "nodaro-prism" })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: { code: "clip_out_of_range", message: "The clip must be 4 to 30 seconds long." } })
      expectNothingStarted()
    })

    it("an answer that is no quote: 502 engine_error", async () => {
      state.estimate = { status: 200, body: { nothing: true } }
      const res = await run({ provider: "nodaro-prism" })
      expect(res.statusCode).toBe(502)
      expect(res.json().error.code).toBe("engine_error")
    })

    it.each([{ nodeId: "node-1" }, { workflowId: "wf-1" }])("a canvas node's own run (%o) is refused: a node cannot run on these", async (ids) => {
      const res = await run({ provider: "nodaro-prism", ...ids })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("provider_not_supported")
      expect(state.estimates).toEqual([])
      expectNothingStarted()
    })

    it("no user: 401", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { videoUrl: CLIP, prompt: "x", provider: "nodaro-prism" } })
      expect(res.statusCode).toBe(401)
      expect(state.estimates).toEqual([])
    })
  })
})

describe("a workflow node cannot run on a Video Remake engine", () => {
  it.each(["nodaro-prism", "nodaro-pulse"])("%s as a node's provider is refused with provider_not_supported", (provider) => {
    let thrown: (Error & { code?: string }) | undefined
    try {
      assertNoVideoRemakeEngineOnNode(provider, "Video to Video")
    } catch (err) {
      thrown = err as Error & { code?: string }
    }
    expect(thrown?.code).toBe("provider_not_supported")
    expect(thrown?.message).toContain("POST /v1/video-remake")
  })

  it("every model of the node passes", () => {
    for (const provider of [...VIDEO_TO_VIDEO_NODE_PROVIDERS, undefined]) {
      expect(() => assertNoVideoRemakeEngineOnNode(provider, "Video to Video")).not.toThrow()
    }
  })
})
