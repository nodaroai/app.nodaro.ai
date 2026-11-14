/**
 * `runJobBatch` — insert + reserve + queue for the N jobs one request plans
 * (generate-image `count` / `models`), ALL OR NOTHING:
 *
 *  - every job is inserted first, each under its own idempotency key
 *    (`<key>:<i>`), so a replay returns the same jobs and creates only what
 *    is missing;
 *  - then each new job reserves its own credits, with the request's key set to
 *    the job's own while it does (the reservation re-writes `req.idempotencyKey`
 *    onto the row — the request's bare key would collide on the second job);
 *  - then every new job is queued in one call;
 *  - a failure at any step undoes what THIS request owns (refund what was
 *    reserved, remove the rows whose refund is CONFIRMED) before anything is
 *    queued, so no part of a batch runs unpaid or stays paid but unqueued; a
 *    row whose refund is not confirmed stays pending for the never-started
 *    sweep, never deleted (its hold would be stranded);
 *  - a queue that refuses the bulk add may still have delivered it: each job
 *    is failed from `pending` first (key released), and only the ones that
 *    write failed are refunded and removed; a job a worker took keeps running
 *    and is named in `error.startedJobIds`;
 *  - an earlier request's job left pending and unpaid is taken over (reserved
 *    and queued); one pending and paid is queued again (idempotent queue id);
 *  - a keyed batch runs under one claim per key: a concurrent repeat waits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify"

const IMAGE_DATA = { type: "generate-image" }

const h = vi.hoisted(() => ({
  inserts: [] as Array<{ row: Record<string, unknown>; key: string | null | undefined; columns: string | undefined }>,
  insertImpl: null as null | ((i: number, key: string | null | undefined) => Promise<{ row: { id: string; credits?: number | null; status?: string | null; input_fingerprint?: string | null; input_data?: unknown }; created: boolean }>),
  reserves: [] as Array<{ jobId: string; identifier: string; requestKey: string | undefined; opts: unknown }>,
  reserveImpl: null as null | ((jobId: string, reply: FastifyReply) => Promise<unknown>),
  refunded: [] as string[],
  /** Jobs whose refund is NOT confirmed. */
  unconfirmed: new Set<string>(),
  /** Credit holds by job id (usage log id); null = the read fails. */
  holds: new Map<string, string>() as Map<string, string> | null,
  holdReads: [] as string[][],
  deleted: [] as string[][],
  deleteScopes: [] as unknown[][],
  claims: [] as string[],
  released: 0,
  claimImpl: null as null | (() => Promise<{ renew(): Promise<boolean>; release(): Promise<void> } | null>),
  /** What each renew of the claim answers, in order (then true). */
  renews: [] as boolean[],
  renewCalls: 0,
  /** Holds each job is found with right AFTER this request reserved it (another request's). */
  holdsAfterReserve: new Map<string, string>(),
  refundedLogs: [] as string[],
  repoints: [] as Array<{ jobId: string; to: unknown; from: unknown }>,
  /** Every failure write, refund and removal, in the order they ran. */
  log: [] as string[],
  fails: [] as Array<{ jobId: string; input: Record<string, unknown> }>,
  /** What each failure write of a job answers, in order (then "flipped"). */
  failOutcomes: new Map<string, Array<"flipped" | "missed" | "error">>(),
  /** What the read-back of a job finds (`{ data, error }`); absent = no row. */
  readbacks: new Map<string, { data: Record<string, unknown> | null; error: unknown }>(),
  reports: [] as Array<Record<string, unknown>>,
}))

vi.mock("../insert-job.js", () => ({
  insertJobIdempotent: vi.fn(async (_req: unknown, row: Record<string, unknown>, key: string | null | undefined, columns?: string) => {
    const i = h.inserts.length
    h.inserts.push({ row, key, columns })
    return h.insertImpl!(i, key)
  }),
}))
vi.mock("../../middleware/credit-guard.js", () => ({
  reserveCreditsForJob: vi.fn(async function (req: FastifyRequest, reply: FastifyReply, jobId: string, identifier: string) {
    h.reserves.push({ jobId, identifier, requestKey: req.idempotencyKey, opts: arguments[4] })
    const out = await h.reserveImpl!(jobId, reply)
    const other = h.holdsAfterReserve.get(jobId)
    if (other && h.holds) h.holds.set(jobId, other)
    return out
  }),
}))
vi.mock("../credits-job-lifecycle.js", () => ({
  refundJobHoldsConfirmed: vi.fn(async (jobId: string) => {
    h.refunded.push(jobId)
    h.log.push(`refund:${jobId}`)
    return !h.unconfirmed.has(jobId)
  }),
  jobCreditHolds: vi.fn(async (ids: readonly string[]) => {
    h.holdReads.push([...ids])
    if (h.holds === null) return null
    return new Map([...h.holds].filter(([id]) => ids.includes(id)).map(([id, log]) => [id, [{ id: log, credits: 60 }]]))
  }),
  refundUsageLogConfirmed: vi.fn(async (logId: string) => {
    h.refundedLogs.push(logId)
    return true
  }),
}))
vi.mock("../job-batch-claim.js", () => ({
  batchClaimKey: (userId: string, key: string) => `claim:${userId}:${key}`,
  claimBatch: vi.fn(async (key: string) => {
    h.claims.push(key)
    return h.claimImpl!()
  }),
}))
vi.mock("../job-failure.js", () => ({
  markJobFailedDetailed: vi.fn(async (jobId: string, input: Record<string, unknown>) => {
    h.fails.push({ jobId, input })
    h.log.push(`fail:${jobId}`)
    return h.failOutcomes.get(jobId)?.shift() ?? "flipped"
  }),
}))
vi.mock("../app-reports.js", () => ({
  insertAppReport: vi.fn(async (input: Record<string, unknown>) => {
    h.reports.push(input)
    return true
  }),
}))
// The twins whose words the batch's own constants repeat (their module builds the queue at import).
vi.mock("../queue.js", () => ({ videoQueue: {} }))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        in: (_col: string, ids: string[]) => {
          h.deleted.push(ids)
          h.log.push(`delete:${ids.join(",")}`)
          const scope: unknown[] = []
          h.deleteScopes.push(scope)
          const chain = {
            eq: (...s: unknown[]) => { scope.push(...s); return chain },
            then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          }
          return chain
        },
      }),
      select: () => ({
        eq: (_c: string, jobId: string) => ({
          maybeSingle: async () => h.readbacks.get(jobId) ?? { data: null, error: null },
        }),
      }),
      update: (to: unknown) => ({
        eq: (_c: string, jobId: string) => ({
          eq: (_c2: string, from: unknown) => { h.repoints.push({ jobId, to, from }); return Promise.resolve({ error: null }) },
        }),
      }),
    }),
  },
}))

import { batchJobKey, PARTLY_STARTED_BATCH_MESSAGE, runJobBatch, type PlannedBatchJob } from "../job-batch.js"
import { REFUSED_BATCH_FAILURE_UNCONFIRMED_KIND, REFUSED_BATCH_JOB_MESSAGE, REFUSED_BATCH_REFUND_UNCONFIRMED_KIND } from "../job-batch-holds.js"
import {
  UNQUEUED_BATCH_CLIENT_MESSAGE,
  UNQUEUED_FAILURE_UNCONFIRMED_KIND,
  UNQUEUED_JOB_MESSAGE,
  UNQUEUED_REFUND_UNCONFIRMED_KIND,
} from "../enqueue-route-job.js"
import { InvalidClientOriginError } from "../client-origin-error.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"

function plan(n: number): PlannedBatchJob[] {
  return Array.from({ length: n }, (_, i) => ({
    row: { user_id: OWNER, status: "pending", input_data: { type: "generate-image", batchIndex: i } },
    creditIdentifier: i % 2 === 0 ? "gpt-image-2" : "flux-2-max:2MP:0ref",
  }))
}

/** Run a batch inside a real Fastify request, so the reply is the real one. */
async function run(planned: PlannedBatchJob[], opts: { key?: string | null; enqueue?: (jobs: readonly { index: number; jobId: string; usageLogId?: string }[]) => Promise<void> } = {}) {
  const enqueued: Array<readonly { index: number; jobId: string; usageLogId?: string }[]> = []
  let requestKeyAfter: string | undefined = "unset"
  const app = Fastify({ logger: false })
  app.post("/v1/batch", async (req, reply) => {
    req.userId = OWNER
    req.idempotencyKey = opts.key ?? undefined
    const jobs = await runJobBatch(req, reply, planned, {
      idempotencyKey: opts.key,
      failureMessage: "Failed to create image generation jobs",
      enqueue: opts.enqueue ?? (async (jobs) => { enqueued.push(jobs) }),
    })
    requestKeyAfter = req.idempotencyKey
    if (jobs === null) return reply
    return { jobs }
  })
  await app.ready()
  const res = await app.inject({ method: "POST", url: "/v1/batch", payload: {} })
  await app.close()
  return { res, enqueued, requestKeyAfter }
}

beforeEach(() => {
  h.inserts.length = 0
  h.reserves.length = 0
  h.refunded.length = 0
  h.unconfirmed.clear()
  h.holds = new Map()
  h.holdReads.length = 0
  h.deleted.length = 0
  h.deleteScopes.length = 0
  h.claims.length = 0
  h.released = 0
  h.renews = []
  h.renewCalls = 0
  h.holdsAfterReserve.clear()
  h.refundedLogs.length = 0
  h.repoints.length = 0
  h.log.length = 0
  h.fails.length = 0
  h.failOutcomes.clear()
  h.readbacks.clear()
  h.reports.length = 0
  h.claimImpl = async () => ({
    renew: async () => { h.renewCalls++; return h.renews.length > 0 ? h.renews.shift()! : true },
    release: async () => { h.released++ },
  })
  h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: null }, created: true })
  h.reserveImpl = async (jobId) => ({ usageLogId: `log-${jobId}`, creditsReserved: 60, watermark: false })
})

describe("batchJobKey", () => {
  it("derives one key per job from the request's, and none without one", () => {
    expect(batchJobKey("client-key-1", 0)).toBe("client-key-1:0")
    expect(batchJobKey("client-key-1", 3)).toBe("client-key-1:3")
    expect(batchJobKey(undefined, 1)).toBeUndefined()
    expect(batchJobKey(null, 1)).toBeUndefined()
  })
})

describe("runJobBatch — the happy path", () => {
  it("inserts every job under its own key, reserves each at its own price, queues them all at once", async () => {
    const { res, enqueued } = await run(plan(3), { key: "client-key-1" })
    expect(res.statusCode).toBe(200)
    expect(h.inserts.map((c) => c.key)).toEqual(["client-key-1:0", "client-key-1:1", "client-key-1:2"])
    expect(h.reserves.map((r) => [r.jobId, r.identifier])).toEqual([
      ["job-0", "gpt-image-2"],
      ["job-1", "flux-2-max:2MP:0ref"],
      ["job-2", "gpt-image-2"],
    ])
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toEqual([
      { index: 0, jobId: "job-0", usageLogId: "log-job-0" },
      { index: 1, jobId: "job-1", usageLogId: "log-job-1" },
      { index: 2, jobId: "job-2", usageLogId: "log-job-2" },
    ])
    expect(res.json().jobs).toEqual([
      { jobId: "job-0", created: true, credits: 60, usageLogId: "log-job-0" },
      { jobId: "job-1", created: true, credits: 60, usageLogId: "log-job-1" },
      { jobId: "job-2", created: true, credits: 60, usageLogId: "log-job-2" },
    ])
  })

  it("reserves each job with the request's key set to that job's own key, then puts the request's back", async () => {
    const { requestKeyAfter } = await run(plan(2), { key: "client-key-1" })
    expect(h.reserves.map((r) => r.requestKey)).toEqual(["client-key-1:0", "client-key-1:1"])
    expect(requestKeyAfter).toBe("client-key-1")
  })

  it("without an Idempotency-Key: plain inserts, no replay dedup", async () => {
    await run(plan(2))
    expect(h.inserts.map((c) => c.key)).toEqual([undefined, undefined])
    expect(h.reserves.map((r) => r.requestKey)).toEqual([undefined, undefined])
  })

  it("asks for the job's credits beside its id (a replayed job reports the earlier hold)", async () => {
    await run(plan(1), { key: "client-key-1" })
    expect(h.inserts[0].columns).toBe("id, credits, status, input_fingerprint, input_data")
  })

  it("credits are null where nothing is charged (no reservation answered)", async () => {
    h.reserveImpl = async () => undefined
    const { res } = await run(plan(1))
    expect(res.json().jobs[0]).toEqual({ jobId: "job-0", created: true, credits: null })
  })
})

describe("runJobBatch — a replay with the same key", () => {
  it("returns the same jobs and reserves and queues nothing again", async () => {
    h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: 60, status: "processing", input_data: IMAGE_DATA }, created: false })
    const { res, enqueued } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(200)
    expect(h.reserves).toHaveLength(0)
    expect(enqueued).toHaveLength(0)
    expect(res.json().jobs).toEqual([
      { jobId: "job-0", created: false, credits: 60 },
      { jobId: "job-1", created: false, credits: 60 },
    ])
  })

  it("completes a partly-created batch: only the missing jobs are reserved and queued", async () => {
    h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: i === 0 ? 60 : null, status: i === 0 ? "completed" : "pending", input_data: IMAGE_DATA }, created: i > 0 })
    const { res, enqueued } = await run(plan(3), { key: "client-key-1" })
    expect(h.reserves.map((r) => r.jobId)).toEqual(["job-1", "job-2"])
    expect(enqueued[0].map((j) => j.index)).toEqual([1, 2])
    expect(res.json().jobs.map((j: { created: boolean }) => j.created)).toEqual([false, true, true])
  })
})

describe("runJobBatch — all or nothing", () => {
  it("an insert that fails part-way removes the jobs already created and answers its error", async () => {
    h.insertImpl = async (i) => {
      if (i === 2) throw new Error("db down")
      return { row: { id: `job-${i}`, credits: null }, created: true }
    }
    const { res, enqueued } = await run(plan(3), { key: "client-key-1" })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(h.deleted).toEqual([["job-0", "job-1"]])
    expect(h.deleteScopes).toEqual([["user_id", OWNER]])
    expect(h.reserves).toHaveLength(0)
    expect(enqueued).toHaveLength(0)
  })

  it("a request refusal at the insert keeps its own status (400 origin), with nothing left behind", async () => {
    h.insertImpl = async () => { throw new InvalidClientOriginError() }
    const { res } = await run(plan(2))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(h.deleted).toEqual([])
  })

  it("a reservation that fails part-way refunds and removes every job this request created; nothing is queued", async () => {
    h.reserveImpl = async (jobId, reply) => {
      if (jobId === "job-1") {
        reply.status(402).send({ error: { code: "insufficient_credits", message: "Insufficient credits" } })
        return undefined
      }
      return { usageLogId: `log-${jobId}`, creditsReserved: 60, watermark: false }
    }
    const { res, enqueued } = await run(plan(3), { key: "client-key-1" })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("insufficient_credits")
    expect(h.refunded).toEqual(expect.arrayContaining(["job-0", "job-1", "job-2"]))
    expect(h.deleted).toEqual([["job-0", "job-1", "job-2"]])
    expect(enqueued).toHaveLength(0)
  })

  it("never touches a job an earlier request created (a replay that fails undoes only its own)", async () => {
    h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: i === 0 ? 60 : null, status: i === 0 ? "processing" : "pending" }, created: i > 0 })
    h.reserveImpl = async (jobId, reply) => {
      reply.status(402).send({ error: { code: "insufficient_credits", message: "x" } })
      return undefined
    }
    await run(plan(2), { key: "client-key-1" })
    expect(h.refunded).not.toContain("job-0")
    expect(h.deleted).toEqual([["job-1"]])
  })

  it("a queue that refuses the batch fails, refunds and removes every job, and answers 500", async () => {
    const { res } = await run(plan(2), { key: "client-key-1", enqueue: async () => { throw new Error("redis down") } })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toEqual({ code: "internal_error", message: "Failed to create image generation jobs" })
    expect(h.fails.map((f) => f.jobId)).toEqual(["job-0", "job-1"])
    expect(h.refunded).toEqual(["job-0", "job-1"])
    expect(h.deleted).toEqual([["job-0", "job-1"]])
  })

  it("the steps before the queue undo without a failure write (nothing was queued)", async () => {
    h.reserveImpl = async (jobId, reply) => {
      if (jobId === "job-1") {
        reply.status(402).send({ error: { code: "insufficient_credits", message: "x" } })
        return undefined
      }
      return { usageLogId: `log-${jobId}`, creditsReserved: 60, watermark: false }
    }
    await run(plan(2), { key: "client-key-1" })
    expect(h.fails).toEqual([])
    expect(h.deleted).toEqual([["job-0", "job-1"]])
    expect(h.deleteScopes).toEqual([["user_id", OWNER]])
  })
})

describe("runJobBatch — a refused bulk add may have been delivered: fail from pending first", () => {
  const refuse = { key: "client-key-1", enqueue: async () => { throw new Error("Connection is closed.") } }
  /** The reports this lane files (the 500 itself files its own, `internal-error`). */
  const filed = () => h.reports.filter((r) => r.kind !== "internal-error")

  it("fails each job from `pending` with its key released, THEN refunds, THEN removes only the failed rows", async () => {
    await run(plan(2), refuse)
    expect(h.log).toEqual(["fail:job-0", "refund:job-0", "fail:job-1", "refund:job-1", "delete:job-0,job-1"])
    expect(h.fails[0]!.input).toEqual({ error_message: REFUSED_BATCH_JOB_MESSAGE, from: ["pending"], extra: { idempotency_key: null } })
    expect(h.deleteScopes).toEqual([["user_id", OWNER, "status", "failed"]])
  })

  it("a job a worker already took is neither refunded nor removed, and the 500 names it in startedJobIds", async () => {
    h.failOutcomes.set("job-1", ["missed"])
    const { res } = await run(plan(3), refuse)
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toEqual({ code: "internal_error", message: PARTLY_STARTED_BATCH_MESSAGE, startedJobIds: ["job-1"] })
    expect(h.refunded).toEqual(["job-0", "job-2"])
    expect(h.deleted).toEqual([["job-0", "job-2"]])
  })

  it("every job already moved on: the add landed with its answer lost, so the batch is answered as started", async () => {
    h.failOutcomes.set("job-0", ["missed"])
    h.failOutcomes.set("job-1", ["missed"])
    const { res } = await run(plan(2), refuse)
    expect(res.statusCode).toBe(200)
    expect(res.json().jobs.map((j: { jobId: string }) => j.jobId)).toEqual(["job-0", "job-1"])
    expect(h.refunded).toEqual([])
    expect(h.deleted).toEqual([])
  })

  it("a failure write that errors twice is reported, never refunded, removed or called started", async () => {
    h.failOutcomes.set("job-0", ["error", "error"])
    const { res } = await run(plan(2), refuse)
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toEqual({ code: "internal_error", message: "Failed to create image generation jobs" })
    expect(h.fails.map((f) => f.jobId)).toEqual(["job-0", "job-0", "job-1"])
    expect(h.refunded).toEqual(["job-1"])
    expect(h.deleted).toEqual([["job-1"]])
    expect(filed().map((r) => [r.kind, r.jobId])).toEqual([[REFUSED_BATCH_FAILURE_UNCONFIRMED_KIND, "job-0"]])
  })

  it("a first write whose answer was lost: the read-back decides — landed is failed and undone, moved on is started", async () => {
    h.failOutcomes.set("job-0", ["error", "missed"])
    h.readbacks.set("job-0", { data: { status: "failed", error_message: REFUSED_BATCH_JOB_MESSAGE }, error: null })
    h.failOutcomes.set("job-1", ["error", "missed"])
    h.readbacks.set("job-1", { data: { status: "processing", error_message: null }, error: null })
    const { res } = await run(plan(2), refuse)
    expect(res.json().error.startedJobIds).toEqual(["job-1"])
    expect(h.refunded).toEqual(["job-0"])
    expect(h.deleted).toEqual([["job-0"]])
  })

  it("a read-back that fails leaves the outcome unknown: reported, untouched", async () => {
    h.failOutcomes.set("job-0", ["error", "missed"])
    h.readbacks.set("job-0", { data: null, error: { message: "timeout" } })
    await run(plan(1), refuse)
    expect(h.refunded).toEqual([])
    expect(h.deleted).toEqual([])
    expect(filed().map((r) => r.kind)).toEqual([REFUSED_BATCH_FAILURE_UNCONFIRMED_KIND])
  })

  it("a failed job whose refund is not confirmed is kept (its hold would be stranded) and reported: no sweep revisits it", async () => {
    h.unconfirmed.add("job-1")
    const { res } = await run(plan(3), refuse)
    expect(res.statusCode).toBe(500)
    expect(h.refunded).toEqual(["job-0", "job-1", "job-2"])
    expect(h.deleted).toEqual([["job-0", "job-2"]])
    expect(filed().map((r) => [r.kind, r.jobId])).toEqual([[REFUSED_BATCH_REFUND_UNCONFIRMED_KIND, "job-1"]])
  })

  it("speaks the same words as every other route the queue refused", () => {
    expect(REFUSED_BATCH_JOB_MESSAGE).toBe(UNQUEUED_JOB_MESSAGE)
    expect(PARTLY_STARTED_BATCH_MESSAGE).toBe(UNQUEUED_BATCH_CLIENT_MESSAGE)
    expect(REFUSED_BATCH_REFUND_UNCONFIRMED_KIND).toBe(UNQUEUED_REFUND_UNCONFIRMED_KIND)
    expect(REFUSED_BATCH_FAILURE_UNCONFIRMED_KIND).toBe(UNQUEUED_FAILURE_UNCONFIRMED_KIND)
  })
})

describe("runJobBatch — undo never strands a hold", () => {
  it("removes only the jobs whose refund is confirmed; the rest stay pending for the never-started sweep", async () => {
    h.unconfirmed.add("job-1")
    h.reserveImpl = async (jobId, reply) => {
      if (jobId === "job-2") {
        reply.status(402).send({ error: { code: "insufficient_credits", message: "x" } })
        return undefined
      }
      return { usageLogId: `log-${jobId}`, creditsReserved: 60, watermark: false }
    }
    const { res, enqueued } = await run(plan(3), { key: "client-key-1" })
    expect(res.statusCode).toBe(402)
    expect(h.refunded).toEqual(["job-0", "job-1", "job-2"])
    expect(h.deleted).toEqual([["job-0", "job-2"]])
    expect(enqueued).toHaveLength(0)
  })

  it("removes nothing when no refund is confirmed", async () => {
    h.unconfirmed.add("job-0")
    h.unconfirmed.add("job-1")
    await run(plan(2), { key: "client-key-1", enqueue: async () => { throw new Error("redis down") } })
    expect(h.deleted).toEqual([])
  })

  it("a reservation that THROWS undoes the earlier reservations and answers 500", async () => {
    h.reserveImpl = async (jobId) => {
      if (jobId === "job-1") throw new Error("rpc transport lost")
      return { usageLogId: `log-${jobId}`, creditsReserved: 60, watermark: false }
    }
    const { res, enqueued, requestKeyAfter } = await run(plan(3), { key: "client-key-1" })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toEqual({ code: "internal_error", message: "Failed to create image generation jobs" })
    expect(h.refunded).toEqual(["job-0", "job-1", "job-2"])
    expect(h.deleted).toEqual([["job-0", "job-1", "job-2"]])
    expect(enqueued).toHaveLength(0)
    expect(requestKeyAfter).toBe("client-key-1")
  })
})

describe("runJobBatch — the jobs an earlier request created", () => {
  it("takes over a job left pending with nothing held: reserves it and queues it", async () => {
    h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: null, status: "pending", input_data: IMAGE_DATA }, created: false })
    const { res, enqueued } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(200)
    expect(h.holdReads[0]).toEqual(["job-0", "job-1"])
    expect(h.reserves.map((r) => [r.jobId, r.requestKey])).toEqual([["job-0", "client-key-1:0"], ["job-1", "client-key-1:1"]])
    expect(enqueued[0]).toEqual([
      { index: 0, jobId: "job-0", usageLogId: "log-job-0" },
      { index: 1, jobId: "job-1", usageLogId: "log-job-1" },
    ])
    // They existed already: not created by this request, but paid for by it.
    expect(res.json().jobs).toEqual([
      { jobId: "job-0", created: false, takenOver: true, credits: 60, usageLogId: "log-job-0" },
      { jobId: "job-1", created: false, takenOver: true, credits: 60, usageLogId: "log-job-1" },
    ])
  })

  it("queues again a job left pending and paid for, without charging it again", async () => {
    h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: 60, status: "pending", input_data: IMAGE_DATA }, created: false })
    h.holds = new Map([["job-0", "log-earlier-0"], ["job-1", "log-earlier-1"]])
    const { res, enqueued } = await run(plan(2), { key: "client-key-1" })
    expect(h.reserves).toHaveLength(0)
    expect(enqueued[0]).toEqual([
      { index: 0, jobId: "job-0", usageLogId: "log-earlier-0" },
      { index: 1, jobId: "job-1", usageLogId: "log-earlier-1" },
    ])
    expect(res.json().jobs.map((j: { created: boolean; credits: number }) => [j.created, j.credits])).toEqual([[false, 60], [false, 60]])
  })

  it("leaves a running or finished job alone", async () => {
    h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: 60, status: i === 0 ? "processing" : "failed", input_data: IMAGE_DATA }, created: false })
    const { enqueued } = await run(plan(2), { key: "client-key-1" })
    expect(h.reserves).toHaveLength(0)
    expect(enqueued).toHaveLength(0)
  })

  it("a failed read of the holds charges nothing twice: it undoes its own jobs and answers 500", async () => {
    h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: null, status: "pending", input_data: IMAGE_DATA }, created: i === 1 })
    h.holds = null
    const { res, enqueued } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(500)
    expect(h.reserves).toHaveLength(0)
    expect(h.deleted).toEqual([["job-1"]])
    expect(enqueued).toHaveLength(0)
  })

  it("a queue failure undoes the jobs it took over, never the ones an earlier request paid for", async () => {
    h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: null, status: "pending", input_data: IMAGE_DATA }, created: false })
    h.holds = new Map([["job-0", "log-earlier-0"]])
    await run(plan(2), { key: "client-key-1", enqueue: async () => { throw new Error("redis down") } })
    expect(h.fails.map((f) => f.jobId)).toEqual(["job-1"])
    expect(h.refunded).toEqual(["job-1"])
    expect(h.deleted).toEqual([["job-1"]])
  })
})

describe("runJobBatch — one request at a time per key", () => {
  it("a keyed batch runs under the claim for its key, given back at the end", async () => {
    await run(plan(2), { key: "client-key-1" })
    expect(h.claims).toEqual([`claim:${OWNER}:client-key-1`])
    expect(h.released).toBe(1)
  })

  it("gives the claim back when the batch fails", async () => {
    await run(plan(2), { key: "client-key-1", enqueue: async () => { throw new Error("redis down") } })
    expect(h.released).toBe(1)
  })

  it("a claim still held after waiting: 409 batch_in_progress, nothing created", async () => {
    h.claimImpl = async () => null
    const { res } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("batch_in_progress")
    expect(h.inserts).toHaveLength(0)
  })

  it("a claim that cannot be read: 500, nothing created", async () => {
    h.claimImpl = async () => { throw new Error("redis down") }
    const { res } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(500)
    expect(h.inserts).toHaveLength(0)
  })

  it("without a key there is nothing to repeat, so no claim", async () => {
    await run(plan(2))
    expect(h.claims).toEqual([])
  })
})

describe("runJobBatch — the claim is checked before every step that charges, queues or undoes", () => {
  it("renews the claim before each reservation and before the queue", async () => {
    await run(plan(2), { key: "client-key-1" })
    // two reservations + the queue
    expect(h.renewCalls).toBe(3)
  })

  it("a claim lost before a reservation: 409, nothing more is reserved, queued or undone", async () => {
    h.renews = [true, false]
    const { res, enqueued } = await run(plan(3), { key: "client-key-1" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("batch_in_progress")
    expect(h.reserves.map((r) => r.jobId)).toEqual(["job-0"])
    expect(enqueued).toHaveLength(0)
    // The request now holding the batch finds these and pays for / queues them.
    expect(h.refunded).toEqual([])
    expect(h.deleted).toEqual([])
  })

  it("a claim lost before the queue: 409, nothing queued or undone", async () => {
    h.renews = [true, true, false]
    const { res, enqueued } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(409)
    expect(enqueued).toHaveLength(0)
    expect(h.deleted).toEqual([])
  })

  it("a claim lost before an undo: the failure is answered, nothing is failed, refunded or removed", async () => {
    h.renews = [true, true, true, false]
    const { res } = await run(plan(2), { key: "client-key-1", enqueue: async () => { throw new Error("redis down") } })
    expect(res.statusCode).toBe(500)
    expect(h.fails).toEqual([])
    expect(h.refunded).toEqual([])
    expect(h.deleted).toEqual([])
  })

  it("an unkeyed batch has no claim to check", async () => {
    const { res } = await run(plan(2))
    expect(res.statusCode).toBe(200)
    expect(h.renewCalls).toBe(0)
  })
})

describe("runJobBatch — a failed reservation leaves its job to the confirmed undo", () => {
  it("every reservation asks to keep its job on failure", async () => {
    await run(plan(2), { key: "client-key-1" })
    expect(h.reserves.map((r) => r.opts)).toEqual([{ retainJobOnFailure: true }, { retainJobOnFailure: true }])
  })

  it("a reservation whose answer was lost (a hold may exist) is refunded and confirmed before its job is removed", async () => {
    h.unconfirmed.add("job-1")
    h.reserveImpl = async (jobId, reply) => {
      if (jobId === "job-1") {
        reply.status(500).send({ error: { code: "credit_reservation_failed", message: "Failed to reserve credits" } })
        return undefined
      }
      return { usageLogId: `log-${jobId}`, creditsReserved: 60, watermark: false }
    }
    const { res } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(500)
    expect(h.refunded).toEqual(["job-0", "job-1"])
    // job-1's refund is not confirmed: it stays for the never-started sweep.
    expect(h.deleted).toEqual([["job-0"]])
  })
})

describe("runJobBatch — the same key for a different request", () => {
  it("a pending job made for another body is never run with this one: 422, this request's own jobs removed", async () => {
    h.insertImpl = async (i) => i === 0
      ? { row: { id: "job-0", credits: null, status: "pending", input_fingerprint: "another-request", input_data: IMAGE_DATA }, created: false }
      : { row: { id: `job-${i}`, credits: null }, created: true }
    const { res, enqueued } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(h.reserves).toHaveLength(0)
    expect(enqueued).toHaveLength(0)
    expect(h.deleted).toEqual([["job-1"]])
  })

  it("jobs another route made under the same key are never adopted: 422 for any status, this request's own jobs removed", async () => {
    for (const status of ["processing", "completed", "pending"]) {
      h.inserts.length = 0
      h.deleted.length = 0
      h.reserves.length = 0
      h.insertImpl = async (i) => i < 2
        ? { row: { id: `other-${i}`, credits: 60, status, input_data: { type: "generate-character" } }, created: false }
        : { row: { id: `job-${i}`, credits: null }, created: true }
      const { res, enqueued } = await run(plan(3), { key: "client-key-1" })
      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe("idempotency_key_reused")
      expect(h.reserves).toHaveLength(0)
      expect(enqueued).toHaveLength(0)
      expect(h.deleted).toEqual([["job-2"]])
    }
  })

  it("a kept job that records no type is not this route's either", async () => {
    h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: 60, status: "processing", input_data: null }, created: false })
    const { res } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(422)
  })

  it("every row is stamped with the request's fingerprint", async () => {
    await run(plan(2), { key: "client-key-1" })
    const stamps = h.inserts.map((c) => c.row.input_fingerprint)
    expect(stamps[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(stamps[1]).toBe(stamps[0])
  })

  it("a running or finished job of another body is only reported, never queued", async () => {
    h.insertImpl = async (i) => ({ row: { id: `job-${i}`, credits: 60, status: "completed", input_fingerprint: "another-request", input_data: IMAGE_DATA }, created: false })
    const { res, enqueued } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(200)
    expect(enqueued).toHaveLength(0)
  })
})

describe("runJobBatch — a job holding another request's hold after this one reserved it", () => {
  it("yields: refunds its own, keeps the other, queues with the other's, and never undoes that job", async () => {
    h.holdsAfterReserve.set("job-0", "log-other-0")
    const { res, enqueued } = await run(plan(2), { key: "client-key-1" })
    expect(res.statusCode).toBe(200)
    expect(h.refundedLogs).toEqual(["log-job-0"])
    expect(h.repoints).toEqual([{ jobId: "job-0", to: { usage_log_id: "log-other-0", credits: 60 }, from: "log-job-0" }])
    expect(enqueued[0]).toEqual([
      { index: 0, jobId: "job-0", usageLogId: "log-other-0" },
      { index: 1, jobId: "job-1", usageLogId: "log-job-1" },
    ])
  })

  it("a later failure undoes only the jobs this request still pays for", async () => {
    h.holdsAfterReserve.set("job-0", "log-other-0")
    await run(plan(2), { key: "client-key-1", enqueue: async () => { throw new Error("redis down") } })
    expect(h.fails.map((f) => f.jobId)).toEqual(["job-1"])
    expect(h.refunded).toEqual(["job-1"])
    expect(h.deleted).toEqual([["job-1"]])
  })
})
