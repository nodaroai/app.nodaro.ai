/**
 * Two requests with the same Idempotency-Key, really concurrent: the real
 * `claimBatch` (lease, renewal, heartbeat), the real `runJobBatch` and the real
 * hold rules (`job-batch-holds.ts`), over an in-memory jobs table and ledger
 * and an in-memory lease the test can expire. Only the storage is a stand-in.
 *
 * The money invariant every case checks: each job ends with EXACTLY ONE live
 * hold (a second would stay reserved forever — completion commits one), and
 * no job anyone paid for is removed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

interface Job { id: string; key: string; user_id: string; status: string; usage_log_id: string | null; credits: number | null; input_fingerprint: string | null }
interface Log { id: string; job_id: string; status: "reserved" | "committed" | "refunded"; credits: number; seq: number; by: string }

const h = vi.hoisted(() => ({
  jobs: new Map<string, Job>(),
  logs: [] as Log[],
  seq: 0,
  leases: new Map<string, string>(),
  /** A request whose NEXT reservation waits until the test lets it go. */
  gate: null as null | { tag: string; entered: () => void; release: Promise<void> },
  enqueued: [] as Array<{ tag: string; jobs: Array<{ jobId: string; usageLogId?: string }> }>,
}))

vi.mock("../queue.js", () => ({
  redis: { duplicate: () => ({ status: "ready", on: () => undefined, off: () => undefined, once: () => undefined }) },
}))
vi.mock("../redis-lease.js", () => ({
  acquireLease: vi.fn(async (key: string) => {
    if (h.leases.has(key)) return null
    const token = `tok-${Math.random()}`
    h.leases.set(key, token)
    return token
  }),
  renewLease: vi.fn(async (key: string, token: string) => h.leases.get(key) === token),
  releaseLease: vi.fn(async (key: string, token: string) => {
    if (h.leases.get(key) !== token) return false
    h.leases.delete(key)
    return true
  }),
}))
vi.mock("../insert-job.js", () => ({
  insertJobIdempotent: vi.fn(async (_req: unknown, row: Record<string, unknown>, key: string) => {
    const existing = [...h.jobs.values()].find((j) => j.key === key)
    if (existing) return { row: { ...existing }, created: false }
    const job: Job = {
      id: `job-${h.jobs.size}`, key, user_id: row.user_id as string, status: "pending",
      usage_log_id: null, credits: null, input_fingerprint: (row.input_fingerprint as string) ?? null,
    }
    h.jobs.set(job.id, job)
    return { row: { ...job }, created: true }
  }),
}))
vi.mock("../../middleware/credit-guard.js", () => ({
  reserveCreditsForJob: vi.fn(async (req: FastifyRequest, _reply: FastifyReply, jobId: string) => {
    const tag = req.headers["x-req"] as string
    if (h.gate?.tag === tag) {
      const gate = h.gate
      h.gate = null
      gate.entered()
      await gate.release
    }
    const job = h.jobs.get(jobId)
    if (!job) throw new Error(`no job ${jobId}`)
    const log: Log = { id: `log-${tag}-${jobId}`, job_id: jobId, status: "reserved", credits: 60, seq: h.seq++, by: tag }
    h.logs.push(log)
    job.usage_log_id = log.id
    job.credits = 60
    return { usageLogId: log.id, creditsReserved: 60, watermark: false }
  }),
}))
vi.mock("../credits-job-lifecycle.js", () => ({
  jobCreditHolds: vi.fn(async (ids: readonly string[]) => {
    const out = new Map<string, Array<{ id: string; credits: number }>>()
    for (const log of [...h.logs].sort((a, b) => a.seq - b.seq)) {
      if (!ids.includes(log.job_id) || log.status === "refunded") continue
      out.set(log.job_id, [...(out.get(log.job_id) ?? []), { id: log.id, credits: log.credits }])
    }
    return out
  }),
  refundUsageLogConfirmed: vi.fn(async (id: string) => {
    const log = h.logs.find((l) => l.id === id)
    if (log?.status === "reserved") log.status = "refunded"
    return true
  }),
  refundJobHoldsConfirmed: vi.fn(async (jobId: string) => {
    for (const log of h.logs) if (log.job_id === jobId && log.status === "reserved") log.status = "refunded"
    return true
  }),
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({
      delete: () => ({ in: (_c: string, ids: string[]) => ({ eq: () => { for (const id of ids) h.jobs.delete(id); return Promise.resolve({ error: null }) } }) }),
      update: (to: Partial<Job>) => ({
        eq: (_c: string, jobId: string) => ({
          eq: (_c2: string, from: string) => {
            const job = h.jobs.get(jobId)
            if (job && job.usage_log_id === from) Object.assign(job, to)
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }),
  },
}))

import { runJobBatch, type PlannedBatchJob } from "../job-batch.js"

const OWNER = "00000000-0000-4000-8000-0000000000b2"
const KEY = "client-key-concurrent"

function plan(n: number): PlannedBatchJob[] {
  return Array.from({ length: n }, (_, i) => ({
    row: { user_id: OWNER, status: "pending", input_data: { type: "generate-image", batchIndex: i } },
    creditIdentifier: "gpt-image-2",
  }))
}

let app: FastifyInstance

beforeEach(async () => {
  h.jobs.clear()
  h.logs.length = 0
  h.seq = 0
  h.leases.clear()
  h.gate = null
  h.enqueued.length = 0
  app = Fastify({ logger: false })
  app.post("/v1/batch", async (req, reply) => {
    req.userId = OWNER
    req.idempotencyKey = KEY
    const tag = req.headers["x-req"] as string
    const jobs = await runJobBatch(req, reply, plan(2), {
      idempotencyKey: KEY,
      failureMessage: "Failed to create image generation jobs",
      enqueue: async (jobs) => { h.enqueued.push({ tag, jobs: jobs.map((j) => ({ jobId: j.jobId, usageLogId: j.usageLogId })) }) },
    })
    return jobs === null ? reply : { jobs }
  })
  await app.ready()
})

const post = (tag: string) => app.inject({ method: "POST", url: "/v1/batch", payload: {}, headers: { "x-req": tag } })

/** Hold request `tag` inside its next reservation until `release()` is called. */
function gateNextReservation(tag: string): { entered: Promise<void>; release: () => void } {
  let release!: () => void
  let entered!: () => void
  const enteredP = new Promise<void>((r) => { entered = r })
  h.gate = { tag, entered, release: new Promise<void>((r) => { release = r }) }
  return { entered: enteredP, release }
}

/** Each job's live holds. */
function liveHolds(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const job of h.jobs.values()) {
    out.set(job.id, h.logs.filter((l) => l.job_id === job.id && l.status !== "refunded").map((l) => l.id))
  }
  return out
}

describe("two requests with the same key at once", () => {
  it("the second waits for the first, then returns its jobs: one hold per job, nothing charged twice", async () => {
    const gate = gateNextReservation("A")
    const a = post("A")
    await gate.entered
    const b = post("B")
    // B is waiting on A's claim; A finishes, then B runs.
    await new Promise((r) => setTimeout(r, 50))
    gate.release()
    const [resA, resB] = await Promise.all([a, b])

    expect(resA.statusCode).toBe(200)
    expect(resB.statusCode).toBe(200)
    expect(resB.json().jobs.map((j: { jobId: string }) => j.jobId)).toEqual(resA.json().jobs.map((j: { jobId: string }) => j.jobId))
    expect(h.logs.filter((l) => l.by === "B")).toEqual([])
    expect([...liveHolds().values()]).toEqual([["log-A-job-0"], ["log-A-job-1"]])
    expect(h.jobs.size).toBe(2)
  })
})

describe("the first request's claim lapses while it still works", () => {
  it("the second takes over and pays; the first's late hold is refunded, it stops without undoing: one hold per job", async () => {
    const gate = gateNextReservation("A")
    const a = post("A")
    await gate.entered
    // A is inside its first reservation (its debit not committed yet) when its lease lapses.
    h.leases.clear()
    const resB = await post("B")
    expect(resB.statusCode).toBe(200)
    // B found both jobs pending and unpaid, and paid for and queued them.
    expect(h.enqueued.map((e) => e.tag)).toEqual(["B"])

    // A's reservation now commits — a second hold on job-0.
    gate.release()
    const resA = await a
    expect(resA.statusCode).toBe(409)
    expect(resA.json().error.code).toBe("batch_in_progress")

    expect([...liveHolds().values()]).toEqual([["log-B-job-0"], ["log-B-job-1"]])
    expect(h.logs.find((l) => l.id === "log-A-job-0")?.status).toBe("refunded")
    // A queued nothing and removed nothing.
    expect(h.enqueued.map((e) => e.tag)).toEqual(["B"])
    expect(h.jobs.size).toBe(2)
    // The jobs point at the hold they keep.
    expect(h.jobs.get("job-0")?.usage_log_id).toBe("log-B-job-0")
  })

  it("a lapse after the first paid for a job: the second only queues it, never charging it again", async () => {
    // A pays for job-0, then stops inside job-1's reservation.
    let calls = 0
    const { reserveCreditsForJob } = await import("../../middleware/credit-guard.js")
    const real = vi.mocked(reserveCreditsForJob).getMockImplementation()!
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    let entered!: () => void
    const inSecond = new Promise<void>((r) => { entered = r })
    vi.mocked(reserveCreditsForJob).mockImplementation(async (req, reply, jobId, id, opts) => {
      if (req.headers["x-req"] === "A" && ++calls === 2) { entered(); await held }
      return real(req, reply, jobId, id, opts)
    })
    const a = post("A")
    await inSecond
    h.leases.clear()
    const resB = await post("B")
    expect(resB.statusCode).toBe(200)
    expect(h.logs.filter((l) => l.by === "B").map((l) => l.job_id)).toEqual(["job-1"])
    release()
    const resA = await a
    expect(resA.statusCode).toBe(409)
    vi.mocked(reserveCreditsForJob).mockImplementation(real)

    expect([...liveHolds().values()]).toEqual([["log-A-job-0"], ["log-B-job-1"]])
    expect(h.jobs.size).toBe(2)
  })
})
