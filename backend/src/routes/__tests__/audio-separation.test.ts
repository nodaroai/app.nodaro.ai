/**
 * POST /v1/audio-separation takes any media link as `audioUrl`, a video's
 * included: the worker splits the video's sound (`toSeparableAudio`). The
 * route itself treats both alike — the same hold, at the split's own credit id
 * for the mode and quality, and the link enqueued exactly as it came. The
 * guard and the queue are stood in for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({ guardIds: [] as string[] }))

vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: unknown) => string) => async (req: unknown) => {
    state.guardIds.push(resolve(req))
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: vi.fn().mockReturnValue(null),
  extractNodeId: vi.fn().mockReturnValue(null),
  extractForcePrivate: vi.fn().mockReturnValue(false),
}))

import { audioSeparationRoutes } from "../audio-separation.js"
import { insertJob } from "@/lib/insert-job.js"
import { videoQueue } from "@/lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"

describe("POST /v1/audio-separation — a video link is a source like any audio", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    state.guardIds = []
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
    })
    await app.register(async (i) => { await audioSeparationRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const run = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/audio-separation", payload: { userId: USER, ...body } })

  it.each([
    ["https://cdn.test/song.mp3", undefined, undefined, "audio-separation"],
    ["https://cdn.test/clip.mp4", undefined, undefined, "audio-separation"],
    ["https://cdn.test/clip.mov", "vocal_instrumental", "best", "audio-separation:best"],
    ["https://cdn.test/clip.webm", "stems", "auto", "audio-separation:stems"],
  ])("%s (mode %s, quality %s) is held once at %s and enqueued as it came", async (audioUrl, mode, quality, creditId) => {
    const res = await run({ audioUrl, ...(mode ? { mode } : {}), ...(quality ? { quality } : {}) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(state.guardIds).toEqual([creditId])
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe(creditId)
    const inserted = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(inserted.input_data).toMatchObject({ audioUrl, type: "audio-separation" })
    expect(vi.mocked(videoQueue.add).mock.calls[0]).toEqual([
      "audio-separation",
      { jobId: "job-1", audioUrl, mode: mode ?? "vocal_instrumental", quality: quality ?? "auto", usageLogId: "usage-1" },
    ])
  })

  it("still refuses a body with no link", async () => {
    const res = await run({ mode: "stems" })
    expect(res.statusCode).toBe(400)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })
})
