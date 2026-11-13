/**
 * enqueueRouteJobs (lib/enqueue-route-job.ts): a batch route's jobs (its
 * variants, versions or candidates) are queued in order. A batch the queue
 * takes whole is answered by the route as before. When the queue refuses one,
 * the jobs already queued keep running; the refused one and every one after it
 * (never handed to the queue) are failed from `pending` with their
 * Idempotency-Key released and refunded confirmed, and the request is answered
 * 500 internal_error with `error.startedJobIds` naming the jobs that are
 * running, so a client can follow them and run the rest again. A refused job
 * that moved on meanwhile (the queue took it after all) counts as started.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const m = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  markJobFailedDetailed: vi.fn(),
  refundConfirmed: vi.fn(),
  insertAppReport: vi.fn(),
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailedDetailed: m.markJobFailedDetailed }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundJobHoldsConfirmed: m.refundConfirmed }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: m.insertAppReport }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }
      return q
    },
  },
}))

import {
  enqueueRouteJobs,
  UNQUEUED_BATCH_CLIENT_MESSAGE,
  UNQUEUED_JOB_CLIENT_MESSAGE,
  UNQUEUED_JOB_MESSAGE,
} from "../enqueue-route-job.js"
import { videoQueue } from "../queue.js"

const REDIS_OOM = "OOM command not allowed when used memory > 'maxmemory'."
const FAILURE = { error_message: UNQUEUED_JOB_MESSAGE, from: ["pending"], extra: { idempotency_key: null } }
const JOB_IDS = ["job-1", "job-2", "job-3"] as const

/** A batch route that queues job-1, job-2 and job-3 in order and answers { jobIds } after. */
async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.post("/batch", async (req, reply) => {
    await enqueueRouteJobs(
      req,
      reply,
      JOB_IDS.map((jobId) => ({ jobId, enqueue: () => videoQueue.add("batch-job", { jobId }) })),
    )
    if (reply.sent) return
    return { jobIds: [...JOB_IDS] }
  })
  await app.ready()
  return app
}

const post = async () => (await makeApp()).inject({ method: "POST", url: "/batch" })

/** The queue refuses the job `refused`, and takes every other one. */
function queueRefuses(refused: string): void {
  m.queueAdd.mockImplementation(async (_name: string, data: { jobId: string }) => {
    if (data.jobId === refused) throw new Error(REDIS_OOM)
    return { id: `q-${data.jobId}` }
  })
}

/** The jobs the queue was handed, in order. */
const queuedJobIds = (): string[] => m.queueAdd.mock.calls.map((c) => (c[1] as { jobId: string }).jobId)
const failedJobIds = (): string[] => m.markJobFailedDetailed.mock.calls.map((c) => c[0] as string)
const refundedJobIds = (): string[] => m.refundConfirmed.mock.calls.map((c) => c[0] as string)

beforeEach(() => {
  m.queueAdd.mockReset().mockImplementation(async (_name: string, data: { jobId: string }) => ({ id: `q-${data.jobId}` }))
  m.markJobFailedDetailed.mockReset().mockResolvedValue("flipped")
  m.refundConfirmed.mockReset().mockResolvedValue(true)
  m.insertAppReport.mockReset().mockResolvedValue(true)
})

describe("enqueueRouteJobs", () => {
  it("every job queued: nothing is sent, and the route answers as before", async () => {
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobIds: ["job-1", "job-2", "job-3"] })
    expect(queuedJobIds()).toEqual(["job-1", "job-2", "job-3"])
    expect(m.markJobFailedDetailed).not.toHaveBeenCalled()
    expect(m.refundConfirmed).not.toHaveBeenCalled()
  })

  it("the 2nd of 3 refused: the 1st keeps running, the 2nd and 3rd are failed with their keys released and refunded, 500 names the 1st", async () => {
    queueRefuses("job-2")
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: "internal_error", message: UNQUEUED_BATCH_CLIENT_MESSAGE, startedJobIds: ["job-1"] },
    })
    // The queue's own words never reach the caller.
    expect(res.body).not.toContain("maxmemory")
    // The 3rd is never handed to the queue once the 2nd is refused.
    expect(queuedJobIds()).toEqual(["job-1", "job-2"])
    expect(failedJobIds()).toEqual(["job-2", "job-3"])
    expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-2", FAILURE)
    expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-3", FAILURE)
    expect(refundedJobIds()).toEqual(["job-2", "job-3"])
  })

  it("the 1st refused: every job is failed and refunded, and startedJobIds is empty", async () => {
    queueRefuses("job-1")
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: "internal_error", message: UNQUEUED_JOB_CLIENT_MESSAGE, startedJobIds: [] },
    })
    expect(queuedJobIds()).toEqual(["job-1"])
    expect(failedJobIds()).toEqual(["job-1", "job-2", "job-3"])
    expect(refundedJobIds()).toEqual(["job-1", "job-2", "job-3"])
  })

  it("the refused job moved on and was the last: nothing is failed, nothing is sent, and the route answers as before", async () => {
    queueRefuses("job-3")
    m.markJobFailedDetailed.mockImplementation(async (jobId: string) => (jobId === "job-3" ? "missed" : "flipped"))
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobIds: ["job-1", "job-2", "job-3"] })
    expect(failedJobIds()).toEqual(["job-3"])
    expect(m.refundConfirmed).not.toHaveBeenCalled()
  })

  it("the refused job moved on with a sibling after it: that one counts as started, the sibling is failed and refunded", async () => {
    queueRefuses("job-2")
    m.markJobFailedDetailed.mockImplementation(async (jobId: string) => (jobId === "job-2" ? "missed" : "flipped"))
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: "internal_error", message: UNQUEUED_BATCH_CLIENT_MESSAGE, startedJobIds: ["job-1", "job-2"] },
    })
    expect(queuedJobIds()).toEqual(["job-1", "job-2"])
    expect(failedJobIds()).toEqual(["job-2", "job-3"])
    // Nothing is refunded for the job that moved on: it is running.
    expect(refundedJobIds()).toEqual(["job-3"])
  })
})
