/**
 * The `queue` field of the job reads (GET /v1/jobs/:id, /v1/jobs/:id/status,
 * GET /v1/jobs/status and POST /v1/jobs/batch-status): a job waiting for a
 * slot says where it stands in its line, from one gate read per request; any
 * other job answers as before, with no gate read at all. On an in-memory
 * database and a real gate over the JS twin of its scripts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { ConcurrencyGate, type LaneClient } from "../../lib/concurrency-lanes/gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"
import { makeFakeLaneDb, type FakeLaneDb } from "../../lib/concurrency-lanes/__tests__/fake-lane-db.js"
import type { LaneEntryMeta, PayerKey } from "../../lib/concurrency-lanes/types.js"

const USER = "00000000-0000-4000-8000-0000000000aa"
const PAYER = "00000000-0000-4000-8000-0000000000bb"
const RUNNING = "00000000-0000-4000-8000-00000000f001"
const FIRST = "00000000-0000-4000-8000-00000000f002"
const SECOND = "00000000-0000-4000-8000-00000000f003"
const DONE = "00000000-0000-4000-8000-00000000f004"
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0)

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  db: null as unknown as { client: { from(t: string): unknown } },
  credits: true,
}))

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => refs.credits,
  hasAdmin: () => refs.credits,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
// The credit figures and the owner's favorite / rating have their own tests.
vi.mock("@/lib/job-credit-status.js", () => ({
  creditStatusMapFor: async () => new Map(),
  creditStatusOf: () => null,
  runCreditsFor: async () => new Map(),
  publicCreditFieldsOf: () => ({}),
}))
vi.mock("@/lib/job-owner-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-owner-state.js")>()),
  jobOwnerStateFor: async () => new Map(),
}))

import { jobRoutes } from "../jobs.js"
import { invalidateLaneConfigCache, resetLaneTierCacheForTests } from "../../ee/concurrency-lanes/plan-sizes.js"
import { resetQueueInfoWarningForTests } from "../../lib/concurrency-lanes/queue-info.js"

let app: FastifyInstance
let db: FakeLaneDb
let gate: ConcurrencyGate
let clock = T0
/** Gate calls made by the route under test (set to 0 after a test's own setup). */
let evals = 0
let failGate = false

const meta = (jobId: string, payer: PayerKey = `user:${USER}`): LaneEntryMeta => ({
  jobId, userId: USER, payer, lane: "provider", provider: "kie", source: "web", sourceDetail: null,
  jobType: "generate-image", model: "flux-2", queue: "video-generation", bullJobId: `bull-${jobId}`,
})
const acquire = (jobId: string, payer?: PayerKey) => gate.acquire({ meta: meta(jobId, payer), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })

const job = (id: string, status: string) => ({
  id, user_id: USER, status, progress: 0, input_data: { prompt: "p" }, output_data: null, error_message: null, error_hint: null,
  created_at: new Date(T0).toISOString(), started_at: null, completed_at: null, credits: 10, job_type: "generate-image",
  source: "web", source_detail: null, session_id: null, usage_log_id: null, deleted_at: null, parent_job_id: null, reconcile_attempts: 0,
  // A waiting row carries the stamp the park writes before it marks the row `queued`.
  lane_queued_at: status === "queued" ? new Date(T0).toISOString() : null,
})

/** Move the gate's clock and the server's together. */
function tick(ms: number): void {
  clock += ms
  vi.setSystemTime(clock)
}

/** One job running, two waiting behind it (a line of one), one finished. */
async function seedLine(payer?: PayerKey): Promise<void> {
  db.rows("jobs").push(job(RUNNING, "processing"), job(FIRST, "queued"), job(SECOND, "queued"), job(DONE, "completed"))
  // Only an enforced gate makes anyone wait (this release never enforces).
  await gate.setEnforced(true)
  await acquire(RUNNING, payer)
  await acquire(FIRST, payer)
  await acquire(SECOND, payer)
  tick(7_500)
  evals = 0
}

beforeEach(async () => {
  db = makeFakeLaneDb()
  refs.db = db
  refs.credits = true
  clock = T0
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(T0)
  evals = 0
  failGate = false
  db.rows("profiles").push({ id: USER, tier: "free", subscription_tier: null, lifetime_topup_credits: 0 })
  const store = makeFakeLaneStore()
  const twin = makeFakeLaneClient(store) as unknown as { eval(...a: unknown[]): Promise<unknown>; publish: LaneClient["publish"] }
  const counting = {
    eval: (...a: unknown[]) => {
      evals++
      return failGate ? Promise.reject(new Error("Redis said no")) : twin.eval(...a)
    },
    publish: twin.publish,
  } as unknown as LaneClient
  gate = new ConcurrencyGate({ client: () => counting, now: () => clock })
  refs.gate = gate
  invalidateLaneConfigCache()
  resetLaneTierCacheForTests()
  resetQueueInfoWarningForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(jobRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const get = async (url: string) => {
  const res = await app.inject({ method: "GET", url })
  expect(res.statusCode).toBe(200)
  return res.json() as Record<string, unknown>
}
const byId = (rows: unknown) => new Map((rows as Array<Record<string, unknown>>).map((r) => [r.id as string, r]))

describe("the queue field of the job reads", () => {
  it("a queued job reports its position and limit", async () => {
    await seedLine()
    const expected = { lane: "provider", position: 2, limit: 1, running: 1, reason: "user_lane", waitedSeconds: 7, upgradeHint: "plan" }
    expect(((await get(`/v1/jobs/${SECOND}/status`)).data as Record<string, unknown>).queue).toEqual(expected)
    expect(((await get(`/v1/jobs/${SECOND}`)).data as Record<string, unknown>).queue).toEqual(expected)
    expect(((await get(`/v1/jobs/${FIRST}/status`)).data as Record<string, unknown>).queue).toMatchObject({ position: 1 })
    // Counts only: never the payer or the user.
    expect(Object.keys(expected).sort()).toEqual(Object.keys(((await get(`/v1/jobs/${SECOND}`)).data as { queue: object }).queue).sort())
  })

  it("a job whose gate entry is newer than its row stamp reports the wait from the stamp, on every read, never sending the stamp", async () => {
    // The row first parked at T0 − 10 min (its queue timeout runs from there);
    // the gate's entry is the one seedLine just made (re-added after a Redis restart, say).
    await seedLine()
    for (const row of db.rows("jobs")) if (row.status === "queued") row.lane_queued_at = new Date(T0 - 600_000).toISOString()
    const expectedSeconds = 600 + 7
    const reads: Array<Record<string, unknown> | undefined> = [
      (await get(`/v1/jobs/${SECOND}/status`)).data as Record<string, unknown>,
      (await get(`/v1/jobs/${SECOND}`)).data as Record<string, unknown>,
      byId((await get(`/v1/jobs/status?ids=${SECOND}`)).jobs).get(SECOND),
      byId((await app.inject({ method: "POST", url: "/v1/jobs/batch-status", payload: { jobIds: [SECOND] } })).json().data).get(SECOND),
    ]
    for (const data of reads) {
      expect(data?.queue).toMatchObject({ position: 2, waitedSeconds: expectedSeconds })
      expect(data).not.toHaveProperty("lane_queued_at")
    }
    // Each read named the stamp in its select.
    expect(db.selects.filter((q) => q.startsWith("jobs:")).every((q) => q.includes("lane_queued_at"))).toBe(true)
  })

  it("a running job has no queue field, and its read makes no gate call", async () => {
    await seedLine()
    for (const id of [RUNNING, DONE]) {
      expect((await get(`/v1/jobs/${id}/status`)).data).not.toHaveProperty("queue")
      expect((await get(`/v1/jobs/${id}`)).data).not.toHaveProperty("queue")
    }
    const batch = byId((await get(`/v1/jobs/status?ids=${RUNNING},${DONE}`)).jobs)
    expect(batch.get(RUNNING)).not.toHaveProperty("queue")
    expect(batch.get(DONE)).not.toHaveProperty("queue")
    expect(evals).toBe(0)
  })

  it("batch status carries queue, from one gate read for every waiting job", async () => {
    await seedLine()
    const lean = byId((await get(`/v1/jobs/status?ids=${RUNNING},${FIRST},${SECOND},${DONE}`)).jobs)
    expect(evals).toBe(1)
    expect(lean.get(FIRST)?.queue).toMatchObject({ position: 1, limit: 1, running: 1 })
    expect(lean.get(SECOND)?.queue).toMatchObject({ position: 2, limit: 1, running: 1 })
    expect(lean.get(RUNNING)).not.toHaveProperty("queue")
    expect(lean.get(DONE)).not.toHaveProperty("queue")

    evals = 0
    const res = await app.inject({ method: "POST", url: "/v1/jobs/batch-status", payload: { jobIds: [RUNNING, FIRST, SECOND, DONE] } })
    expect(res.statusCode).toBe(200)
    const posted = byId(res.json().data)
    expect(evals).toBe(1)
    expect(posted.get(FIRST)?.queue).toMatchObject({ position: 1 })
    expect(posted.get(SECOND)?.queue).toMatchObject({ position: 2 })
    expect(posted.get(RUNNING)).not.toHaveProperty("queue")
  })

  describe("upgradeHint follows the payer", () => {
    const hintOf = async (): Promise<unknown> => (((await get(`/v1/jobs/${FIRST}/status`)).data as { queue?: { upgradeHint: unknown } }).queue?.upgradeHint)

    it("a workspace line: the workspace", async () => {
      await seedLine("workspace:W1")
      expect(await hintOf()).toBe("workspace")
    })

    it("a personal line below business on Cloud: the plan", async () => {
      db.rows("profiles")[0]!.tier = "pro"
      await seedLine()
      expect(await hintOf()).toBe("plan")
    })

    it("a personal line at business: none", async () => {
      db.rows("profiles")[0]!.tier = "business"
      await seedLine()
      expect(await hintOf()).toBeNull()
    })

    it("a deployment line follows the paying account's tier", async () => {
      db.rows("profiles").push({ id: PAYER, tier: "standard", subscription_tier: "standard", lifetime_topup_credits: 0 })
      await seedLine(`deployment:${PAYER}`)
      expect(await hintOf()).toBe("plan")
      db.rows("profiles").find((r) => r.id === PAYER)!.tier = "enterprise"
      resetLaneTierCacheForTests()
      expect(await hintOf()).toBeNull()
    })

    it("off Cloud a personal line has none (no plans to upgrade)", async () => {
      refs.credits = false
      await seedLine()
      expect(await hintOf()).toBeNull()
    })

    it("a payer whose tier cannot be read: none, and the job still answers its queue", async () => {
      db.failing.add("profiles")
      await seedLine()
      const queue = ((await get(`/v1/jobs/${FIRST}/status`)).data as { queue?: Record<string, unknown> }).queue
      expect(queue).toMatchObject({ position: 1, upgradeHint: null })
    })
  })

  it("a wait on the provider (busy across the platform) carries no upgrade hint", async () => {
    db.rows("jobs").push(job(RUNNING, "processing"), job(FIRST, "queued"))
    await gate.setEnforced(true)
    await gate.setProviderCeilings({ kie: 1 })
    await gate.acquire({ meta: meta(RUNNING), size: 5, mode: "fresh", leaseTtlMs: 3_600_000 })
    await gate.acquire({ meta: meta(FIRST), size: 5, mode: "fresh", leaseTtlMs: 3_600_000 })
    const queue = ((await get(`/v1/jobs/${FIRST}/status`)).data as { queue?: Record<string, unknown> }).queue
    expect(queue).toMatchObject({ reason: "provider_ceiling", position: 1, upgradeHint: null })
  })

  it("a wait for the server share reports server_busy, no line counts and no upgrade hint", async () => {
    db.rows("jobs").push(job(FIRST, "queued"))
    await gate.setEnforced(true)
    await gate.markServerWait({ ...meta(FIRST), lane: "run", queue: "video-director", pool: "director" })
    tick(3_000)
    const queue = ((await get(`/v1/jobs/${FIRST}/status`)).data as { queue?: Record<string, unknown> }).queue
    expect(queue).toEqual({ lane: "run", position: 1, limit: 0, running: 0, reason: "server_busy", waitedSeconds: 3, upgradeHint: null })
  })

  it("a gate that fails leaves queue out and the read still answers", async () => {
    await seedLine()
    failGate = true
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const data = (await get(`/v1/jobs/${FIRST}/status`)).data as Record<string, unknown>
    expect(data).toMatchObject({ id: FIRST, status: "queued" })
    expect(data).not.toHaveProperty("queue")
    expect(byId((await get(`/v1/jobs/status?ids=${FIRST},${SECOND}`)).jobs).get(SECOND)).not.toHaveProperty("queue")
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("a queued row with no lane stamp (not written by the park) is not waiting: no queue field, no gate read", async () => {
    db.rows("jobs").push({ ...job(FIRST, "queued"), lane_queued_at: null })
    const data = (await get(`/v1/jobs/${FIRST}/status`)).data as Record<string, unknown>
    expect(data).toMatchObject({ id: FIRST, status: "queued" })
    expect(data).not.toHaveProperty("queue")
    expect(byId((await get(`/v1/jobs/status?ids=${FIRST}`)).jobs).get(FIRST)).not.toHaveProperty("queue")
    expect((await get(`/v1/jobs/${FIRST}`)).data).not.toHaveProperty("queue")
    expect(evals).toBe(0)
  })

  it("a job queued but no longer in any line (just woken) has no queue field", async () => {
    db.rows("jobs").push(job(FIRST, "queued"))
    expect((await get(`/v1/jobs/${FIRST}/status`)).data).not.toHaveProperty("queue")
    expect(evals).toBe(1)
  })
})
