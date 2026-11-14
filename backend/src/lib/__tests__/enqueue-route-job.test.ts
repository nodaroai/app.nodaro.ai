/**
 * enqueueRouteJob / enqueueUnitJob (lib/enqueue-route-job.ts): a job the queue
 * takes is answered by the route as before; a job the queue refuses is failed
 * from `pending` only, with its Idempotency-Key released in the same write
 * (written again once when the write errors), refunded only when that write
 * flipped it — the refund confirmed, and reported when it cannot be — and
 * answered 500 internal_error. A job that moved on meanwhile (the queue took
 * it after all, or it was cancelled) is answered as started.
 *
 * The queue's errors here are the ones its connection really throws
 * (lib/queue-connection.ts retries without limit, so an outage waits rather
 * than throws): a Redis error reply, or "Connection is closed" on shutdown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const m = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  markJobFailedDetailed: vi.fn(),
  refundConfirmed: vi.fn(),
  insertAppReport: vi.fn(),
  /** What a read of the job row answers (status, error_message), or an error. */
  row: null as { status: string; error_message: string | null } | null,
  rowError: null as { message: string } | null,
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailedDetailed: m.markJobFailedDetailed }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundJobHoldsConfirmed: m.refundConfirmed }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: m.insertAppReport }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: m.row, error: m.rowError }) }
      return q
    },
  },
}))

import {
  enqueueRouteJob,
  enqueueUnitJob,
  failUnqueuedRouteJob,
  UNQUEUED_JOB_CLIENT_MESSAGE,
  UNQUEUED_JOB_MESSAGE,
  UNQUEUED_FAILURE_UNCONFIRMED_KIND,
  UNQUEUED_REFUND_UNCONFIRMED_KIND,
  type QueuedUnit,
} from "../enqueue-route-job.js"

const UNIT = { type: "queued-unit", execution: { queue: "video" } } as const satisfies QueuedUnit
const REDIS_OOM = "OOM command not allowed when used memory > 'maxmemory'."
const CLOSED = "Connection is closed."
const FAILURE = { error_message: UNQUEUED_JOB_MESSAGE, from: ["pending"], extra: { idempotency_key: null } }

/** A route that queues job-1 the way a node unit's route does, and answers { jobId } after. */
async function makeApp(unit: QueuedUnit = UNIT): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.post("/unit", async (req, reply) => {
    await enqueueUnitJob(req, reply, unit, { jobId: "job-1", videoUrl: "https://media.test/a.mp4", usageLogId: "ul-1" })
    if (reply.sent) return
    return { jobId: "job-1" }
  })
  app.post("/thunk", async (req, reply) => {
    await enqueueRouteJob(req, reply, "job-2", () => m.queueAdd("any", { jobId: "job-2" }))
    if (reply.sent) return
    return { jobId: "job-2" }
  })
  await app.ready()
  return app
}

const post = async (url = "/unit") => (await makeApp()).inject({ method: "POST", url })

beforeEach(() => {
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
  m.markJobFailedDetailed.mockReset().mockResolvedValue("flipped")
  m.refundConfirmed.mockReset().mockResolvedValue(true)
  m.insertAppReport.mockReset().mockResolvedValue(true)
  m.row = null
  m.rowError = null
})

describe("enqueueUnitJob", () => {
  it("queues the job on the unit's queue under its type, and the route answers as before", async () => {
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.queueAdd).toHaveBeenCalledWith("queued-unit", { jobId: "job-1", videoUrl: "https://media.test/a.mp4", usageLogId: "ul-1" })
    expect(m.markJobFailedDetailed).not.toHaveBeenCalled()
    expect(m.refundConfirmed).not.toHaveBeenCalled()
  })

  it("a queue that refuses the job (a Redis error reply): failed from pending with its key released, refunded, answered 500", async () => {
    m.queueAdd.mockRejectedValue(new Error(REDIS_OOM))
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: UNQUEUED_JOB_CLIENT_MESSAGE } })
    // The queue's own words never reach the caller.
    expect(res.body).not.toContain("maxmemory")
    expect(m.markJobFailedDetailed).toHaveBeenCalledTimes(1)
    expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-1", FAILURE)
    expect(m.refundConfirmed).toHaveBeenCalledWith("job-1")
    // The 500 files its own internal-error report; nothing of this helper's is filed.
    expect(m.insertAppReport).not.toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_REFUND_UNCONFIRMED_KIND }))
    expect(m.insertAppReport).not.toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_FAILURE_UNCONFIRMED_KIND }))
  })

  it("a job that moved on meanwhile (a closed connection delivered it, a worker claimed it) is answered as started, and nothing is refunded", async () => {
    m.queueAdd.mockRejectedValue(new Error(CLOSED))
    m.markJobFailedDetailed.mockResolvedValue("missed")
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.refundConfirmed).not.toHaveBeenCalled()
  })

  it("a refund the read cannot confirm is logged and filed as an app report; the answer is still the 500", async () => {
    m.queueAdd.mockRejectedValue(new Error(REDIS_OOM))
    m.refundConfirmed.mockResolvedValue(false)
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.json().error.message).toBe(UNQUEUED_JOB_CLIENT_MESSAGE)
    expect(m.insertAppReport).toHaveBeenCalledWith(expect.objectContaining({
      kind: UNQUEUED_REFUND_UNCONFIRMED_KIND,
      severity: "error",
      jobId: "job-1",
    }))
  })

  it("a unit naming no queue this server runs: its job is failed and refunded, never left pending", async () => {
    const app = await makeApp({ type: "queued-unit", execution: {} })
    const res = await app.inject({ method: "POST", url: "/unit" })
    expect(res.statusCode).toBe(500)
    expect(m.queueAdd).not.toHaveBeenCalled()
    expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-1", FAILURE)
    expect(m.refundConfirmed).toHaveBeenCalledWith("job-1")
  })
})

describe("enqueueUnitJob: a failure write that errors is written again once", () => {
  beforeEach(() => {
    m.queueAdd.mockRejectedValue(new Error(REDIS_OOM))
  })

  it("the second write flips the row: refunded, 500", async () => {
    m.markJobFailedDetailed.mockResolvedValueOnce("error").mockResolvedValueOnce("flipped")
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(m.markJobFailedDetailed).toHaveBeenCalledTimes(2)
    expect(m.markJobFailedDetailed).toHaveBeenNthCalledWith(2, "job-1", FAILURE)
    expect(m.refundConfirmed).toHaveBeenCalledWith("job-1")
  })

  it("the first write landed and only its answer was lost (the row reads as this failure): refunded, 500", async () => {
    m.markJobFailedDetailed.mockResolvedValueOnce("error").mockResolvedValueOnce("missed")
    m.row = { status: "failed", error_message: UNQUEUED_JOB_MESSAGE }
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(m.refundConfirmed).toHaveBeenCalledWith("job-1")
  })

  it("the job moved on between the two writes (a worker claimed it): answered as started, nothing refunded", async () => {
    m.markJobFailedDetailed.mockResolvedValueOnce("error").mockResolvedValueOnce("missed")
    m.row = { status: "processing", error_message: null }
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.refundConfirmed).not.toHaveBeenCalled()
  })

  const unconfirmedReport = expect.objectContaining({ kind: UNQUEUED_FAILURE_UNCONFIRMED_KIND, severity: "error", jobId: "job-1" })

  it("a row that cannot be read after a missed second write is not guessed at: no refund, reported, 500", async () => {
    m.markJobFailedDetailed.mockResolvedValueOnce("error").mockResolvedValueOnce("missed")
    m.rowError = { message: "statement timeout" }
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(m.refundConfirmed).not.toHaveBeenCalled()
    // The row may be failed with its hold still reserved, which no sweep reads.
    expect(m.insertAppReport).toHaveBeenCalledWith(unconfirmedReport)
  })

  it("neither write answers (none landed, or the first landed and lost its answer): no refund, reported, 500", async () => {
    m.markJobFailedDetailed.mockResolvedValue("error")
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(m.markJobFailedDetailed).toHaveBeenCalledTimes(2)
    expect(m.refundConfirmed).not.toHaveBeenCalled()
    expect(m.insertAppReport).toHaveBeenCalledWith(unconfirmedReport)
  })

  it("an outcome the second write settles is not reported as unconfirmed", async () => {
    m.markJobFailedDetailed.mockResolvedValueOnce("error").mockResolvedValueOnce("flipped")
    await post()
    expect(m.insertAppReport).not.toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_FAILURE_UNCONFIRMED_KIND }))
  })
})

describe("enqueueRouteJob", () => {
  it("runs the route's own enqueue, and fails that route's job when it throws", async () => {
    const app = await makeApp()
    expect((await app.inject({ method: "POST", url: "/thunk" })).json()).toEqual({ jobId: "job-2" })
    expect(m.queueAdd).toHaveBeenCalledWith("any", { jobId: "job-2" })

    m.queueAdd.mockRejectedValue(new Error(CLOSED))
    const res = await app.inject({ method: "POST", url: "/thunk" })
    expect(res.statusCode).toBe(500)
    expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-2", FAILURE)
    expect(m.refundConfirmed).toHaveBeenCalledWith("job-2")
  })
})

describe("failUnqueuedRouteJob — a step between the insert and the queue threw", () => {
  /** A route whose step after the reservation throws, as llm-structured-jobs' analysis sub-request can. */
  async function throwingApp(opts: { answerFirst?: boolean } = {}): Promise<FastifyInstance> {
    const app = Fastify({ logger: false })
    app.post("/throws", async (req, reply) => {
      try {
        if (opts.answerFirst) reply.status(422).send({ error: { code: "refused", message: "refused" } })
        throw new Error("connection reset reading the next step")
      } catch (err) {
        await failUnqueuedRouteJob(req, reply, "job-3", err)
        return
      }
    })
    await app.ready()
    return app
  }

  it("fails the job from `pending` with its key released, refunds it confirmed, and answers 500 with the fixed message", async () => {
    const res = await (await throwingApp()).inject({ method: "POST", url: "/throws" })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toMatchObject({ code: "internal_error", message: UNQUEUED_JOB_CLIENT_MESSAGE })
    expect(res.body).not.toContain("connection reset")
    expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-3", FAILURE)
    expect(m.refundConfirmed).toHaveBeenCalledWith("job-3")
  })

  it("a job no longer `pending` (cancelled or removed) is not refunded here, and the request is still answered 500 — nothing was queued", async () => {
    m.markJobFailedDetailed.mockResolvedValue("missed")
    const res = await (await throwingApp()).inject({ method: "POST", url: "/throws" })
    expect(res.statusCode).toBe(500)
    expect(m.refundConfirmed).not.toHaveBeenCalled()
  })

  it("a failure whose outcome stays unknown is reported, and answered 500", async () => {
    m.markJobFailedDetailed.mockResolvedValue("error")
    const res = await (await throwingApp()).inject({ method: "POST", url: "/throws" })
    expect(res.statusCode).toBe(500)
    expect(m.refundConfirmed).not.toHaveBeenCalled()
    expect(m.insertAppReport).toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_FAILURE_UNCONFIRMED_KIND, jobId: "job-3" }))
  })

  it("never answers twice: a request already answered keeps its answer, and the job is still settled", async () => {
    const res = await (await throwingApp({ answerFirst: true })).inject({ method: "POST", url: "/throws" })
    expect(res.statusCode).toBe(422)
    expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-3", FAILURE)
    expect(m.refundConfirmed).toHaveBeenCalledWith("job-3")
  })
})
