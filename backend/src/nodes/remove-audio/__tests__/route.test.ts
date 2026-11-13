/**
 * POST /v1/remove-audio (the unit's route.ts): validates the body, needs a
 * user, reserves the "remove-audio" row at the guard and at the reservation,
 * inserts the job and queues it on the video queue under the same name. A
 * queue that refuses the job fails it, refunds it and frees its key at once
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
    return { usageLogId: "ul-1", creditsReserved: 20, watermark: false }
  },
}))

import { route } from "../route.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"

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

describe("POST /v1/remove-audio", () => {
  it("queues a remove-audio job on the video queue, priced on the remove-audio row", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/remove-audio", payload: { videoUrl: "https://media.test/clip.mp4" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.resolved).toEqual(["remove-audio"])
    expect(m.reserveIds).toEqual(["remove-audio"])
    expect(m.insertJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ user_id: USER_ID, status: "pending" }))
    expect(m.queueAdd).toHaveBeenCalledWith("remove-audio", { jobId: "job-1", videoUrl: "https://media.test/clip.mp4", usageLogId: "ul-1" })
  })

  it("400s without a video URL, and queues nothing", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/remove-audio", payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.queueAdd).not.toHaveBeenCalled()
  })

  it("401s without a user", async () => {
    const app = await makeApp(null)
    const res = await app.inject({ method: "POST", url: "/v1/remove-audio", payload: { videoUrl: "https://media.test/clip.mp4" } })
    expect(res.statusCode).toBe(401)
    expect(m.queueAdd).not.toHaveBeenCalled()
  })
})

describe("POST /v1/remove-audio: a queue that refuses the job", () => {
  it("fails the job from pending, frees its Idempotency-Key, refunds its hold and answers 500 internal_error", async () => {
    m.queueAdd.mockRejectedValue(new Error("OOM command not allowed when used memory > 'maxmemory'."))
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/remove-audio", payload: { videoUrl: "https://media.test/clip.mp4" } })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-1", expect.objectContaining({ from: ["pending"], extra: { idempotency_key: null } }))
    expect(m.refund).toHaveBeenCalledWith("job-1")
  })

  it("a job the queue took after all (no longer pending) is answered as started, and not refunded", async () => {
    m.queueAdd.mockRejectedValue(new Error("Connection is closed."))
    m.markJobFailedDetailed.mockResolvedValue("missed")
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/remove-audio", payload: { videoUrl: "https://media.test/clip.mp4" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.refund).not.toHaveBeenCalled()
  })
})
