/**
 * `tk.http.enqueueJob` / `tk.http.enqueueJobs` — a plugin route queues the job
 * it inserted and reserved through the helpers every core route uses
 * (lib/enqueue-route-job.ts): queued, nothing is sent; refused by the queue,
 * the job is failed from `pending` with its Idempotency-Key released, refunded
 * (confirmed) and the request answered 500; a job a worker claimed meanwhile
 * is left alone and nothing is sent. The payload loses the import way-in keys
 * exactly as `tk.http.videoQueue.add` drops them (`pluginJobData`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({
  add: vi.fn(),
  markJobFailedDetailed: vi.fn(),
  refundJobHoldsConfirmed: vi.fn(),
  insertAppReport: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.add }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => false }))
vi.mock("@/lib/job-failure.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-failure.js")>()),
  markJobFailedDetailed: m.markJobFailedDetailed,
}))
vi.mock("@/lib/credits-job-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credits-job-lifecycle.js")>()),
  refundJobHoldsConfirmed: m.refundJobHoldsConfirmed,
}))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: m.insertAppReport }))

import { buildToolkit } from "../toolkit.js"
import { UNQUEUED_BATCH_CLIENT_MESSAGE, UNQUEUED_JOB_CLIENT_MESSAGE, UNQUEUED_JOB_MESSAGE } from "../../enqueue-route-job.js"

const STORE_OOM = "OOM command not allowed when used memory > 'maxmemory'."

/** A request and a reply that records what was sent. */
function exchange() {
  const req = { userId: "u1", log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } as unknown as FastifyRequest
  const sent: { status?: number; body?: unknown } = {}
  const reply = {
    sent: false,
    status(code: number) {
      sent.status = code
      return this
    },
    code(code: number) {
      sent.status = code
      return this
    },
    send(body: unknown) {
      sent.body = body
      ;(this as { sent: boolean }).sent = true
      return this
    },
  } as unknown as FastifyReply
  return { req, reply, sent }
}

const FAILURE = { error_message: UNQUEUED_JOB_MESSAGE, from: ["pending"], extra: { idempotency_key: null } }

beforeEach(() => {
  vi.clearAllMocks()
  m.add.mockResolvedValue({ id: "queued" })
  m.markJobFailedDetailed.mockResolvedValue("flipped")
  m.refundJobHoldsConfirmed.mockResolvedValue(true)
  m.insertAppReport.mockResolvedValue(undefined)
})

describe("tk.http.enqueueJob", () => {
  it("queues the job on the video queue under its name, without a way in, and sends nothing", async () => {
    const http = buildToolkit().http
    const { req, reply, sent } = exchange()
    await http.enqueueJob!(req, reply, "job-1", "speaker-view", { jobId: "job-1", importVia: "app", importAppId: "x" }, { attempts: 1 })
    expect(m.add).toHaveBeenCalledWith("speaker-view", { jobId: "job-1" }, { attempts: 1 })
    expect(reply.sent).toBe(false)
    expect(sent).toEqual({})
    expect(m.markJobFailedDetailed).not.toHaveBeenCalled()
  })

  it("a job the queue refuses is failed from pending with its key released, refunded, and answered 500", async () => {
    m.add.mockRejectedValueOnce(new Error(STORE_OOM))
    const http = buildToolkit().http
    const { req, reply, sent } = exchange()
    await http.enqueueJob!(req, reply, "job-1", "speaker-view", { jobId: "job-1" })
    expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-1", FAILURE)
    expect(m.refundJobHoldsConfirmed).toHaveBeenCalledWith("job-1")
    expect(reply.sent).toBe(true)
    expect(sent.status).toBe(500)
    expect(sent.body).toMatchObject({ error: { code: "internal_error", message: UNQUEUED_JOB_CLIENT_MESSAGE } })
  })

  it("a refused job a worker claimed meanwhile is left alone: nothing refunded, nothing sent", async () => {
    m.add.mockRejectedValueOnce(new Error("Connection is closed."))
    m.markJobFailedDetailed.mockResolvedValueOnce("missed")
    const http = buildToolkit().http
    const { req, reply } = exchange()
    await http.enqueueJob!(req, reply, "job-1", "speaker-view", { jobId: "job-1" })
    expect(m.refundJobHoldsConfirmed).not.toHaveBeenCalled()
    expect(reply.sent).toBe(false)
  })
})

describe("tk.http.enqueueJobs", () => {
  it("queues each job in order; when one is refused it and the rest are failed and refunded, and the 500 names the started ones", async () => {
    m.add.mockResolvedValueOnce({ id: "a" }).mockRejectedValueOnce(new Error(STORE_OOM))
    const http = buildToolkit().http
    const { req, reply, sent } = exchange()
    await http.enqueueJobs!(req, reply, [
      { jobId: "job-a", name: "recast-rescore", data: { jobId: "job-a", importLane: "run" } },
      { jobId: "job-b", name: "recast-rescore", data: { jobId: "job-b" }, opts: { attempts: 1 } },
      { jobId: "job-c", name: "recast-rescore", data: { jobId: "job-c" } },
    ])
    expect(m.add).toHaveBeenNthCalledWith(1, "recast-rescore", { jobId: "job-a" }, undefined)
    expect(m.add).toHaveBeenNthCalledWith(2, "recast-rescore", { jobId: "job-b" }, { attempts: 1 })
    expect(m.add).toHaveBeenCalledTimes(2)
    expect(m.markJobFailedDetailed.mock.calls.map((c) => c[0])).toEqual(["job-b", "job-c"])
    expect(m.refundJobHoldsConfirmed.mock.calls.map((c) => c[0])).toEqual(["job-b", "job-c"])
    expect(sent.status).toBe(500)
    expect(sent.body).toMatchObject({ error: { code: "internal_error", message: UNQUEUED_BATCH_CLIENT_MESSAGE, startedJobIds: ["job-a"] } })
  })

  it("all queued: nothing sent", async () => {
    const http = buildToolkit().http
    const { req, reply } = exchange()
    await http.enqueueJobs!(req, reply, [{ jobId: "job-a", name: "n", data: {} }, { jobId: "job-b", name: "n", data: {} }])
    expect(m.add).toHaveBeenCalledTimes(2)
    expect(reply.sent).toBe(false)
  })
})
