/**
 * POST /v1/shot-cuts (the unit's route.ts): validates the body BEFORE the
 * credit guard (a malformed request hears its 400, never a 402), needs a user,
 * reserves the type's own row at the guard and at the reservation — with or
 * without frames — inserts the job and queues it on the video queue under the
 * same name. The clip itself is measured by the job, never on the request.
 * A queue that refuses the job fails it, refunds it and frees its key at once
 * (lib/enqueue-route-job.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({
  resolved: [] as string[],
  reserveIds: [] as string[],
  insertJob: vi.fn(),
  queueAdd: vi.fn(),
  markJobFailedDetailed: vi.fn(),
  refund: vi.fn(),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailedDetailed: m.markJobFailedDetailed }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundJobHoldsConfirmed: m.refund }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn().mockResolvedValue(true) }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolver: (req: FastifyRequest) => string) => async (req: FastifyRequest) => {
    m.resolved.push(resolver(req))
  },
  reserveCreditsForJob: async (_req: unknown, _reply: unknown, _jobId: string, id: string) => {
    m.reserveIds.push(id)
    return { usageLogId: "ul-1", creditsReserved: 1, watermark: false }
  },
}))

import { route } from "../route.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const URL = "/v1/shot-cuts"
const CLIP = "https://media.test/clip.mp4"

async function makeApp(userId: string | null = USER_ID): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = userId ?? undefined
  })
  await app.register(route)
  await app.ready()
  return app
}

beforeEach(() => {
  m.resolved = []
  m.reserveIds = []
  m.insertJob.mockReset().mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
  m.markJobFailedDetailed.mockReset().mockResolvedValue("flipped")
  m.refund.mockReset().mockResolvedValue(true)
})

describe("POST /v1/shot-cuts", () => {
  it("queues a shot-cuts job on the video queue, frames off by default, priced on the type's row", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { videoUrl: CLIP } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.resolved).toEqual(["shot-cuts"])
    expect(m.reserveIds).toEqual(["shot-cuts"])
    expect(m.insertJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ user_id: USER_ID, status: "pending" }))
    expect(m.queueAdd).toHaveBeenCalledWith("shot-cuts", { jobId: "job-1", videoUrl: CLIP, frames: false, usageLogId: "ul-1" })
  })

  it("frames on reserves the same row (one price, with or without frames)", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { videoUrl: CLIP, frames: true } })
    expect(res.statusCode).toBe(200)
    expect(m.reserveIds).toEqual(["shot-cuts"])
    expect(m.queueAdd).toHaveBeenCalledWith("shot-cuts", { jobId: "job-1", videoUrl: CLIP, frames: true, usageLogId: "ul-1" })
  })

  it("the job row carries the request (not the body's userId) and the MCP client", async () => {
    const app = await makeApp()
    await app.inject({ method: "POST", url: URL, payload: { videoUrl: CLIP, frames: true, userId: USER_ID, mcp_client: "Claude" } })
    const row = m.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown>; mcp_client?: string }
    expect(row.input_data).toMatchObject({ videoUrl: CLIP, frames: true })
    expect(row.input_data.userId).toBeUndefined()
    expect(row.mcp_client).toBe("Claude")
  })

  it.each([
    ["no video URL", {}],
    ["a video URL that is not a URL", { videoUrl: "not a url" }],
    ["frames that is not a boolean", { videoUrl: CLIP, frames: "yes" }],
  ])("400s on %s before the credit guard, and queues nothing", async (_name, payload) => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(m.resolved).toEqual([])
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.queueAdd).not.toHaveBeenCalled()
  })

  it("401s without a user", async () => {
    const app = await makeApp(null)
    const res = await app.inject({ method: "POST", url: URL, payload: { videoUrl: CLIP } })
    expect(res.statusCode).toBe(401)
    expect(m.queueAdd).not.toHaveBeenCalled()
  })

  it("500s and queues nothing when the job row cannot be written", async () => {
    m.insertJob.mockResolvedValue({ data: null, error: { message: "db down" } })
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { videoUrl: CLIP } })
    expect(res.statusCode).toBe(500)
    expect(m.queueAdd).not.toHaveBeenCalled()
  })
})

describe("POST /v1/shot-cuts: a queue that refuses the job", () => {
  it("fails the job from pending, frees its Idempotency-Key, refunds its hold and answers 500 internal_error", async () => {
    m.queueAdd.mockRejectedValue(new Error("OOM command not allowed when used memory > 'maxmemory'."))
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/shot-cuts", payload: { videoUrl: CLIP } })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-1", expect.objectContaining({ from: ["pending"], extra: { idempotency_key: null } }))
    expect(m.refund).toHaveBeenCalledWith("job-1")
  })

  it("a job the queue took after all (no longer pending) is answered as started, and not refunded", async () => {
    m.queueAdd.mockRejectedValue(new Error("Connection is closed."))
    m.markJobFailedDetailed.mockResolvedValue("missed")
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/shot-cuts", payload: { videoUrl: CLIP } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.refund).not.toHaveBeenCalled()
  })
})
