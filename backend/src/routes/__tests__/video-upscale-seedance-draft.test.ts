import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * /v1/video-upscale provider `seedance-2-5-hd`: the draft is resolved and
 * validated BEFORE the credit guard, a refusal reserves nothing and creates no
 * job, and the reservation + the task sent come from the SOURCE draft, never
 * from the body.
 */

const resolver = vi.hoisted(() => ({
  result: { ok: true } as Record<string, unknown>,
  calls: [] as Array<Record<string, unknown>>,
}))
vi.mock("@/lib/seedance-draft-finalize.js", () => ({
  resolveSeedanceDraftFinalize: async (args: Record<string, unknown>) => {
    resolver.calls.push(args)
    return resolver.result
  },
  seedanceDraftFinalizeBaseCredits: async () => 1900,
}))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: vi.fn().mockResolvedValue({ data: { id: "job-hd" }, error: null }),
}))
vi.mock("@/lib/kie-task-ownership.js", () => ({ kieTaskOwnedByAnother: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: unknown) => string, opts?: unknown) => async (req: { body: unknown; guardSeen?: unknown[] }) => {
    ;(globalThis as { __guardSeen?: unknown[] }).__guardSeen?.push({ id: resolve(req), computes: Boolean(opts) })
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: () => null,
  extractNodeId: () => null,
  extractForcePrivate: () => false,
}))

import { videoUpscaleRoutes } from "../video-upscale.js"
import { videoQueue } from "@/lib/queue.js"
import { insertJob } from "@/lib/insert-job.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"

const PLAN = {
  ok: true,
  sourceJobId: "11111111-2222-4333-8444-555555555555",
  draftTaskId: "task-draft",
  outputSec: 4,
  hasRefVideo: false,
  refVideoDurationsSec: [],
  creditId: "seedance-2-5-hd:4s",
}

describe("POST /v1/video-upscale — seedance-2-5-hd", () => {
  let app: FastifyInstance
  let guardSeen: Array<{ id: string; computes: boolean }>

  beforeEach(async () => {
    vi.clearAllMocks()
    resolver.calls = []
    resolver.result = PLAN
    guardSeen = []
    ;(globalThis as { __guardSeen?: unknown[] }).__guardSeen = guardSeen
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (i) => { await videoUpscaleRoutes(i) })
    await app.ready()
  })
  afterEach(async () => { await app.close() })

  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/video-upscale", payload: { provider: "seedance-2-5-hd", userId: "user-a", ...payload } })

  it("needs the draft's taskId or sourceJobId", async () => {
    resolver.result = { ok: false, status: 400, code: "draft_source_required", message: "x" }
    const res = await post({})
    expect(res.statusCode).toBe(400)
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("a refusal from the gate is returned as is — no job, no reservation, no guard", async () => {
    resolver.result = { ok: false, status: 403, code: "forbidden", message: "You do not own the referenced draft." }
    const res = await post({ taskId: "task-other" })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: { code: "forbidden", message: "You do not own the referenced draft." } })
    expect(guardSeen).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("prices from the source draft and sends the DRAFT's task id, not the body's", async () => {
    const res = await post({ sourceJobId: PLAN.sourceJobId, taskId: "something-else" })
    expect(res.statusCode).toBe(200)
    expect(resolver.calls[0]).toEqual({ userId: "user-a", taskId: "something-else", sourceJobId: PLAN.sourceJobId })
    expect(guardSeen).toEqual([{ id: "seedance-2-5-hd:4s", computes: false }])
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe("seedance-2-5-hd:4s")
    expect(vi.mocked(videoQueue.add)).toHaveBeenCalledWith("video-upscale", expect.objectContaining({
      provider: "seedance-2-5-hd",
      kieTaskId: "task-draft",
      sourceJobId: PLAN.sourceJobId,
    }))
    const row = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(row.input_data).toMatchObject({ taskId: "task-draft", sourceJobId: PLAN.sourceJobId, draftOutputSec: 4, draftHasRefVideo: false })
  })

  it("the draft's audio mux, read from the source job, reaches the worker and the job record", async () => {
    const mux = { kind: "voice-track", audioUrl: "https://r2/track.mp3" }
    resolver.result = { ...PLAN, audioMux: mux, draftVideoUrl: "https://r2/draft.mp4" }
    const res = await post({ sourceJobId: PLAN.sourceJobId, draftAudioMux: { kind: "voice-track", audioUrl: "https://evil/x.mp3" } })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(videoQueue.add)).toHaveBeenCalledWith("video-upscale", expect.objectContaining({ draftAudioMux: mux, draftVideoUrl: "https://r2/draft.mp4" }))
    const row = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(row.input_data.draftAudioMux).toEqual(mux)
  })

  it("a reference-video draft is priced by the input + output override", async () => {
    resolver.result = { ...PLAN, hasRefVideo: true, refVideoDurationsSec: [4], creditId: "seedance-2-5-hd:4s-ref" }
    const res = await post({ taskId: "task-draft" })
    expect(res.statusCode).toBe(200)
    expect(guardSeen).toEqual([{ id: "seedance-2-5-hd:4s-ref", computes: true }])
  })

  it("leaves Topaz and VEO on their own rows, without asking the draft gate", async () => {
    await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { provider: "topaz", videoUrl: "https://x/v.mp4", userId: "user-a" } })
    await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { provider: "veo-1080p", taskId: "veo-task", userId: "user-a" } })
    expect(resolver.calls).toEqual([])
    expect(guardSeen.map((g) => g.id)).toEqual(["topaz-video", "veo-1080p"])
  })
})
