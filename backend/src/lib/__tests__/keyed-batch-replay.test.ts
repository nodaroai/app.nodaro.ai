/**
 * keyedBatchReplay (lib/keyed-batch-replay.ts): a keyed batch route's repeat,
 * answered from the jobs it made (`<key>:0..n-1`) before the credit guard, or
 * priced for the jobs it still pays for; and keyedBatchAnswer, the answer a
 * batch made by `runJobBatch` gets.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const m = vi.hoisted(() => ({
  findJobsByIdempotencyKeys: vi.fn(),
  jobCreditHolds: vi.fn(),
}))

vi.mock("@/lib/dedup-fingerprint.js", () => ({
  MIN_IDEMPOTENCY_KEY_LENGTH: 8,
  findJobsByIdempotencyKeys: m.findJobsByIdempotencyKeys,
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ jobCreditHolds: m.jobCreditHolds }))
// job-batch.ts is read only for `batchJobKey`; its queue-free imports load as they are.
vi.mock("@/lib/insert-job.js", () => ({}))
vi.mock("@/middleware/credit-guard.js", () => ({}))
vi.mock("@/lib/job-batch-claim.js", () => ({}))
vi.mock("@/lib/job-batch-holds.js", () => ({}))

import { keyedBatchAnswer, keyedBatchJobsToPrice, keyedBatchReplay } from "../keyed-batch-replay.js"

const KEY = "batch-key-0001"
type Row = { id: string; status: string | null; credits: number | null; input_data: { type: string } | null }
const JOB_TYPE = "generate-widget"
const row = (id: string, status: string, type: string | null = JOB_TYPE): Row => ({ id, status, credits: 10, input_data: type ? { type } : null })

let priced: number | undefined | "unset"

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => { req.userId = "user-1" })
  app.post("/batch", {
    preHandler: keyedBatchReplay({
      size: (body) => (body as { count?: number }).count ?? 1,
      jobType: JOB_TYPE,
      answer: (jobIds) => ({ jobIds: [...jobIds] }),
    }),
  }, async (req) => {
    priced = keyedBatchJobsToPrice(req)
    return { handler: true }
  })
  await app.ready()
  return app
}

async function post(count: number, key: string | null = KEY) {
  const app = await makeApp()
  return app.inject({ method: "POST", url: "/batch", headers: key ? { "idempotency-key": key } : {}, payload: { count } })
}

beforeEach(() => {
  priced = "unset"
  m.findJobsByIdempotencyKeys.mockReset().mockResolvedValue(new Map())
  m.jobCreditHolds.mockReset().mockResolvedValue(new Map())
})

describe("keyedBatchReplay", () => {
  it("every job exists and is running or done: answered from them, deduped, before the handler", async () => {
    m.findJobsByIdempotencyKeys.mockResolvedValue(new Map([
      [`${KEY}:0`, row("j0", "processing")],
      [`${KEY}:1`, row("j1", "completed")],
      [`${KEY}:2`, row("j2", "failed")],
    ]))
    const res = await post(3)
    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBe("1")
    expect(res.json()).toEqual({ jobIds: ["j0", "j1", "j2"], deduped: true })
    expect(priced).toBe("unset")
    expect(m.findJobsByIdempotencyKeys).toHaveBeenCalledWith("user-1", [`${KEY}:0`, `${KEY}:1`, `${KEY}:2`])
  })

  it("jobs another route made under the same key: 422, never replayed or topped up", async () => {
    for (const status of ["processing", "completed", "failed", "pending"]) {
      m.findJobsByIdempotencyKeys.mockResolvedValue(new Map([
        [`${KEY}:0`, row("j0", status, "generate-other")],
        [`${KEY}:1`, row("j1", status, "generate-other")],
      ]))
      const res = await post(3)
      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe("idempotency_key_reused")
      expect(res.headers["x-dedup-hit"]).toBeUndefined()
      expect(priced).toBe("unset")
    }
  })

  it("one job of another route among this route's, or one with no recorded type: 422", async () => {
    m.findJobsByIdempotencyKeys.mockResolvedValue(new Map([
      [`${KEY}:0`, row("j0", "processing")],
      [`${KEY}:1`, row("j1", "processing", "generate-other")],
    ]))
    expect((await post(2)).statusCode).toBe(422)
    m.findJobsByIdempotencyKeys.mockResolvedValue(new Map([[`${KEY}:0`, row("j0", "processing", null)]]))
    expect((await post(2)).statusCode).toBe(422)
  })

  it("the lookup is the caller's own: the same key under another user finds nothing and runs", async () => {
    m.findJobsByIdempotencyKeys.mockImplementation(async (userId: string) =>
      userId === "user-1" ? new Map() : new Map([[`${KEY}:0`, row("x0", "processing", "generate-other")]]))
    const res = await post(2)
    expect(res.json()).toEqual({ handler: true })
    expect(m.findJobsByIdempotencyKeys.mock.calls[0]![0]).toBe("user-1")
  })

  it("some jobs missing: the handler runs, priced for the missing ones only", async () => {
    m.findJobsByIdempotencyKeys.mockResolvedValue(new Map([[`${KEY}:0`, row("j0", "processing")]]))
    const res = await post(3)
    expect(res.json()).toEqual({ handler: true })
    expect(priced).toBe(2)
  })

  it("a job left pending with nothing held is priced (the request takes it over); one pending and paid is not", async () => {
    m.findJobsByIdempotencyKeys.mockResolvedValue(new Map([
      [`${KEY}:0`, row("j0", "pending")],
      [`${KEY}:1`, row("j1", "pending")],
    ]))
    m.jobCreditHolds.mockResolvedValue(new Map([["j1", [{ id: "log-1", credits: 10 }]]]))
    const res = await post(2)
    expect(res.json()).toEqual({ handler: true })
    expect(priced).toBe(1)
    expect(m.jobCreditHolds).toHaveBeenCalledWith(["j0", "j1"])
  })

  it("every job exists and the only ones waiting are paid: the handler queues them again, priced at nothing", async () => {
    m.findJobsByIdempotencyKeys.mockResolvedValue(new Map([
      [`${KEY}:0`, row("j0", "processing")],
      [`${KEY}:1`, row("j1", "pending")],
    ]))
    m.jobCreditHolds.mockResolvedValue(new Map([["j1", [{ id: "log-1", credits: 10 }]]]))
    const res = await post(2)
    expect(res.json()).toEqual({ handler: true })
    expect(priced).toBe(0)
  })

  it.each([
    ["no key", 3, null],
    ["a key under 8 characters", 3, "short"],
    ["a single job (it keeps the bare key and the guard's own replay)", 1, KEY],
  ])("%s: nothing is read and the whole request is priced", async (_label, count, key) => {
    const res = await post(count, key)
    expect(res.json()).toEqual({ handler: true })
    expect(priced).toBeUndefined()
    expect(m.findJobsByIdempotencyKeys).not.toHaveBeenCalled()
  })

  it("nothing found, or a read that fails: the whole batch is priced", async () => {
    expect((await post(3)).json()).toEqual({ handler: true })
    expect(priced).toBeUndefined()

    m.findJobsByIdempotencyKeys.mockResolvedValue(null)
    expect((await post(3)).json()).toEqual({ handler: true })
    expect(priced).toBeUndefined()

    m.findJobsByIdempotencyKeys.mockResolvedValue(new Map([[`${KEY}:0`, row("j0", "pending")]]))
    m.jobCreditHolds.mockResolvedValue(null)
    expect((await post(3)).json()).toEqual({ handler: true })
    expect(priced).toBeUndefined()
  })
})

describe("keyedBatchAnswer", () => {
  function replyStub() {
    const headers: Record<string, string> = {}
    return { headers, reply: { header: (k: string, v: string) => { headers[k] = v } } as never }
  }

  it("a batch this request made or took over: the route's answer, no deduped", () => {
    const { headers, reply } = replyStub()
    const out = keyedBatchAnswer(reply, [
      { jobId: "a", created: false, credits: 10 },
      { jobId: "b", created: true, credits: 10 },
    ], (ids) => ({ jobIds: [...ids] }))
    expect(out).toEqual({ jobIds: ["a", "b"] })
    expect(headers).toEqual({})

    const takenOver = keyedBatchAnswer(reply, [{ jobId: "a", created: false, takenOver: true, credits: 10 }], (ids) => ({ jobIds: [...ids] }))
    expect(takenOver).toEqual({ jobIds: ["a"] })
  })

  it("every job already existed and nothing was charged: deduped, with X-Dedup-Hit", () => {
    const { headers, reply } = replyStub()
    const out = keyedBatchAnswer(reply, [
      { jobId: "a", created: false, credits: 10 },
      { jobId: "b", created: false, credits: 10 },
    ], (ids) => ({ jobId: ids[0], jobIds: [...ids] }))
    expect(out).toEqual({ jobId: "a", jobIds: ["a", "b"], deduped: true })
    expect(headers).toEqual({ "X-Dedup-Hit": "1" })
  })
})
