/**
 * GET /v1/pipelines/:id and the `queue` field: a pipeline waiting for its run
 * slot stays `queued` and says where it stands. A pipeline is also `queued`
 * before it is first driven, so only the lane stamp (`lane_queued_at`) makes
 * the read ask the gate; a database without that column (staging before the
 * migration) answers the read without it. On an in-memory database and a
 * real gate over the JS twin of its scripts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { ConcurrencyGate } from "../../lib/concurrency-lanes/gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"
import { makeFakeLaneDb, type FakeLaneDb } from "../../lib/concurrency-lanes/__tests__/fake-lane-db.js"
import type { LaneEntryMeta } from "../../lib/concurrency-lanes/types.js"

const USER = "00000000-0000-4000-8000-0000000000aa"
const HOLDER = "00000000-0000-4000-8000-000000000110"
const PIPELINE = "00000000-0000-4000-8000-000000000111"
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0)

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  db: null as unknown as { client: { from(t: string): unknown } },
}))

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => true,
  hasAdmin: () => true,
  isCommunity: () => false,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))

import { pipelinesRoutes } from "../pipelines.js"
import { resetLaneColumnsForTests } from "../../lib/concurrency-lanes/columns.js"
import { invalidateLaneConfigCache, resetLaneTierCacheForTests } from "../../ee/concurrency-lanes/plan-sizes.js"

let app: FastifyInstance
let db: FakeLaneDb
let gate: ConcurrencyGate
let clock = T0

const meta = (jobId: string): LaneEntryMeta => ({
  jobId, userId: USER, payer: `user:${USER}`, lane: "run", provider: null, source: "web", sourceDetail: null,
  jobType: "pipeline", model: null, queue: "pipeline-orchestration", bullJobId: jobId,
})

const pipeline = (over: Record<string, unknown> = {}) => ({
  id: PIPELINE, user_id: USER, status: "queued", current_stage: null, spent_credits: 0, reserved_credits: 30,
  upfront_credit_estimate: 30, branched_from_pipeline_id: null, branched_from_stage: null, mode: "auto",
  failure_reason: null, current_progress_message: null, ...over,
})

beforeEach(async () => {
  db = makeFakeLaneDb()
  refs.db = db
  clock = T0
  db.rows("profiles").push({ id: USER, tier: "basic", subscription_tier: "basic", lifetime_topup_credits: 0 })
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store), now: () => clock })
  refs.gate = gate
  resetLaneColumnsForTests()
  invalidateLaneConfigCache()
  resetLaneTierCacheForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(pipelinesRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const read = async () => {
  const res = await app.inject({ method: "GET", url: `/v1/pipelines/${PIPELINE}` })
  expect(res.statusCode).toBe(200)
  return res.json() as Record<string, unknown>
}

describe("GET /v1/pipelines/:id — the queue field", () => {
  it("a waiting pipeline reports queue while staying queued, its wait counted from its own lane stamp", async () => {
    // The row first parked at T0 (its queue timeout runs from there); the gate's
    // entry is younger (re-added after a Redis restart, say).
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(T0 + 90_000)
    db.rows("pipelines").push(pipeline({ lane_queued_at: new Date(T0).toISOString() }))
    await gate.setEnforced(true)
    await gate.acquire({ meta: meta(HOLDER), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
    await gate.acquire({ meta: meta(PIPELINE), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
    clock += 61_000
    const body = await read()
    expect(body.status).toBe("queued")
    expect(body.queue).toEqual({ lane: "run", position: 1, limit: 1, running: 1, reason: "user_lane", waitedSeconds: 90, upgradeHint: "plan" })
    // The stamp and the owner stay server-side.
    expect(body).not.toHaveProperty("lane_queued_at")
    expect(body).not.toHaveProperty("user_id")
  })

  it("a pipeline not driven yet (queued, never stamped) makes no gate call", async () => {
    db.rows("pipelines").push(pipeline())
    const describeWaits = vi.spyOn(gate, "describeWaits")
    const body = await read()
    expect(body).toMatchObject({ id: PIPELINE, status: "queued" })
    expect(body).not.toHaveProperty("queue")
    expect(describeWaits).not.toHaveBeenCalled()
  })

  it("a database without the lane column answers the read without it, and stops naming it", async () => {
    db.rows("pipelines").push(pipeline())
    db.missingColumns.add("pipelines.lane_queued_at")
    expect(await read()).toMatchObject({ id: PIPELINE, status: "queued" })
    expect(await read()).toMatchObject({ id: PIPELINE, status: "queued" })
    const named = db.selects.filter((s) => s.startsWith("pipelines:")).map((s) => s.includes("lane_queued_at"))
    expect(named).toEqual([true, false, false])
  })
})
