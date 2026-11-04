/**
 * POST /v1/split-media: the part-length body is parsed exactly as before, and
 * `mode: "shots"` takes its own body — a video, no part length, no separate audio.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({ resolved: [] as string[], reserveIds: [] as string[], insertJob: vi.fn(), queueAdd: vi.fn() }))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/supabase.js", () => ({ supabase: {} }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolver: (req: FastifyRequest) => string) => async (req: FastifyRequest) => {
    m.resolved.push(resolver(req))
  },
  reserveCreditsForJob: async (_req: unknown, _reply: unknown, _jobId: string, id: string) => {
    m.reserveIds.push(id)
    return { usageLogId: "ul-1", creditsReserved: 20, watermark: false }
  },
}))

import { splitMediaRoutes } from "../split-media.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const VIDEO = "https://media.test/ad.mp4"
const AUDIO = "https://media.test/a.mp3"

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(splitMediaRoutes)
  await app.ready()
  return app
}
const post = async (payload: Record<string, unknown>) => (await makeApp()).inject({ method: "POST", url: "/v1/split-media", payload })

beforeEach(() => {
  m.resolved = []
  m.reserveIds = []
  m.insertJob.mockReset().mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
})

describe("POST /v1/split-media", () => {
  it("part length: queues exactly the parsed body, as before (an unknown mode is dropped)", async () => {
    const res = await post({ videoUrl: VIDEO, chunkDuration: 10, mode: "duration" })
    expect(res.statusCode).toBe(200)
    expect(m.queueAdd).toHaveBeenCalledWith("split-media", { jobId: "job-1", videoUrl: VIDEO, chunkDuration: 10, audioFormat: "mp3", usageLogId: "ul-1" })
    expect(m.reserveIds).toEqual(["split-media"])
  })

  it("part length: still needs chunkDuration", async () => {
    const res = await post({ videoUrl: VIDEO })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(m.queueAdd).not.toHaveBeenCalled()
  })

  it("shots: queues the video and the mode on the same price row, no part length", async () => {
    const res = await post({ videoUrl: VIDEO, mode: "shots", chunkDuration: 10 })
    expect(res.statusCode).toBe(200)
    expect(m.queueAdd).toHaveBeenCalledWith("split-media", { jobId: "job-1", videoUrl: VIDEO, mode: "shots", usageLogId: "ul-1" })
    expect(m.reserveIds).toEqual(["split-media"])
  })

  it.each([
    ["no video", { audioUrl: AUDIO, mode: "shots" }],
    ["a separate audio", { videoUrl: VIDEO, audioUrl: AUDIO, mode: "shots" }],
  ])("shots: 400s on %s and queues nothing", async (_name, payload) => {
    const res = await post(payload)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(m.queueAdd).not.toHaveBeenCalled()
  })
})
