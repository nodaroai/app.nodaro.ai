// @test-reads-none an in-memory database double and a fake lane gate; reads no repo file
/**
 * The pre-task heartbeat's cap pauses while the job waits for a concurrency
 * slot inside its handler (decided 2026-10-30: nothing fails for waiting), the
 * way it pauses for an ffmpeg-slot wait. A coordinator whose call waits longer
 * than the cap (90 min) keeps beating, so the reconcile's 30-minute pre-task
 * sweep never fails it, and the wait is on its row (`lane_wait_ms`) while it
 * lasts, so the stuck-orchestrator sweep leaves it out too. A job that never
 * waits keeps today's cap: a hung handler still stops beating at 90 minutes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// These tests wait for slots, so they run on the path where limits can be
// turned on (test-only: this release locks them, and a locked take never waits).
vi.mock("../../lib/concurrency-lanes/enforcement-available.js", () => ({ LANES_ENFORCEMENT_AVAILABLE: true }))
import { makeSweepDb, type SweepDb } from "../../lib/concurrency-lanes/__tests__/fake-sweep-db.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"
import { ConcurrencyGate } from "../../lib/concurrency-lanes/gate.js"
import type { LaneSizes } from "../../lib/concurrency-lanes/types.js"

const h = vi.hoisted(() => ({
  db: null as unknown as { client: { from(t: string): unknown; rpc(fn: string, args?: unknown): unknown } },
  gate: null as unknown,
  sizes: { provider: 1, llm: 2, local: 1, run: 1 } as LaneSizes,
  beats: [] as number[],
}))

vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => h.db.client.from(t), rpc: (fn: string, args?: unknown) => h.db.client.rpc(fn, args) },
}))
vi.mock("../../lib/reconcile/persistence.js", () => ({
  refreshPreTaskSentinel: async () => { h.beats.push(Date.now()) },
  recordJobSlotWait: async () => undefined,
}))
vi.mock("../../lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => h.gate }))
vi.mock("../../lib/concurrency-lanes/sizes.js", () => ({
  laneSizesFor: async () => h.sizes,
  laneSettings: async () => ({ queueTimeoutMs: 120 * 60_000, liveWaitLimitMs: 600_000 }),
}))
vi.mock("../../lib/concurrency-lanes/wake-subscriber.js", () => ({ startLaneWakeSubscriber: () => () => {} }))

const { withPreTaskHeartbeat, PRE_TASK_HEARTBEAT_MAX_MS } = await import("../pre-task-heartbeat.js")
const { runHolding } = await import("../../lib/concurrency-lanes/hold.js")
const { withConcurrencySlot, resetConcurrencySlotsForTests } = await import("../../lib/concurrency-lanes/slot.js")
const { STALE_THRESHOLD_MS } = await import("../../lib/reconcile/types.js")
type ConcurrencyHold = import("../../lib/concurrency-lanes/hold.js").ConcurrencyHold

const MIN = 60_000
const USER = "00000000-0000-4000-8000-0000000000a1"
const JOB = "00000000-0000-4000-8000-0000000000b1"
const THRESHOLD = STALE_THRESHOLD_MS["pre-task"]

/** A plugin coordinator's hold in the video worker (its wait is kept on `jobs`). */
const hold: ConcurrencyHold = {
  role: "coordinator", lane: null, userId: USER, payer: `user:${USER}`, tier: "pro", jobId: JOB, leaseId: null, waitTable: "jobs",
}

let db: SweepDb
let gate: ConcurrencyGate

beforeEach(async () => {
  db = makeSweepDb()
  h.db = db
  h.beats.length = 0
  db.rows("jobs").push({ id: JOB, user_id: USER, status: "processing", lane_wait_ms: 0, provider_kind: "pre-task" })
  vi.useFakeTimers()
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  h.gate = gate
  await gate.setEnforced(true)
  resetConcurrencySlotsForTests()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** The longest time the row's sentinel went without a beat between `from` and `to`. */
function longestGap(from: number, to: number): number {
  const points = [from, ...h.beats.filter((t) => t > from && t < to), to]
  return Math.max(...points.slice(1).map((t, i) => t - points[i]!))
}

describe("the pre-task heartbeat and a wait for a concurrency slot", () => {
  it("a coordinator waiting 100 min for a call slot is not failed by the pre-task sweep", async () => {
    // Someone else holds the user's provider slot for 100 minutes.
    const meta = {
      jobId: "other", userId: USER, payer: `user:${USER}` as const, lane: "provider" as const, provider: "kie", source: null,
      sourceDetail: null, jobType: "image-to-video", model: null, queue: "video-generation" as const, bullJobId: "other",
    }
    const other = await gate.acquire({ meta, size: 1, mode: "fresh", leaseTtlMs: 6 * 60 * MIN })
    if (!other.granted) throw new Error("expected a grant")
    setTimeout(() => { void gate.release(other.leaseId, "completed") }, 100 * MIN)

    const started = Date.now()
    let ranAt = 0
    const handler = withPreTaskHeartbeat(async () => {
      await withConcurrencySlot({ lane: "provider", provider: "kie", jobType: "image-to-video" }, async () => {
        ranAt = Date.now()
        await new Promise<void>((resolve) => { setTimeout(resolve, 5 * MIN) })
      })
    })
    const done = runHolding(hold, () => handler({}, { jobId: JOB }))

    // Mid-wait, the row already carries the wait (the stuck-orchestrator sweep reads it).
    await vi.advanceTimersByTimeAsync(60 * MIN)
    expect(Number(db.row("jobs", JOB)?.lane_wait_ms)).toBeGreaterThanOrEqual(59 * MIN)

    await vi.advanceTimersByTimeAsync(50 * MIN)
    await done
    expect(ranAt - started).toBeGreaterThanOrEqual(100 * MIN)
    // It kept beating through the wait and past the 90-minute cap: the sentinel never aged into the sweep.
    expect(h.beats.some((t) => t - started > PRE_TASK_HEARTBEAT_MAX_MS)).toBe(true)
    expect(longestGap(started, started + 105 * MIN)).toBeLessThan(THRESHOLD)
  })

  it("coordinator clocks with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    // The user's slot is taken, but with enforcement off the call is granted at once (an over-limit lease).
    const meta = {
      jobId: "other", userId: USER, payer: `user:${USER}` as const, lane: "provider" as const, provider: "kie", source: null,
      sourceDetail: null, jobType: "image-to-video", model: null, queue: "video-generation" as const, bullJobId: "other",
    }
    expect((await gate.acquire({ meta, size: 1, mode: "fresh", leaseTtlMs: 6 * 60 * MIN })).granted).toBe(true)
    const started = Date.now()
    let ranAt = -1
    const handler = withPreTaskHeartbeat(async () => {
      await withConcurrencySlot({ lane: "provider", provider: "kie", jobType: "image-to-video" }, async () => { ranAt = Date.now() })
      await new Promise<void>(() => {})
    })
    void runHolding(hold, () => handler({}, { jobId: JOB }))
    await vi.advanceTimersByTimeAsync(150 * MIN)
    expect(ranAt).toBe(started)
    // No wait, so no write, and the hung handler stops beating at today's cap.
    expect(db.writes).toEqual([])
    expect(Math.max(...h.beats) - started).toBeLessThanOrEqual(PRE_TASK_HEARTBEAT_MAX_MS)
  })

  it("a handler that never waits keeps today's cap: a hung one stops beating at 90 minutes", async () => {
    const started = Date.now()
    const handler = withPreTaskHeartbeat(async () => {
      await new Promise<void>(() => {})
    })
    void runHolding(hold, () => handler({}, { jobId: JOB }))
    await vi.advanceTimersByTimeAsync(150 * MIN)
    const last = Math.max(...h.beats)
    expect(last - started).toBeLessThanOrEqual(PRE_TASK_HEARTBEAT_MAX_MS)
    // Nothing waited, so nothing about lanes was written.
    expect(db.writes).toEqual([])
  })
})
