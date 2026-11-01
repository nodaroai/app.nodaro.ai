// @test-reads-none an in-memory database double; reads no repo file
/**
 * `tk.jobs.waitForJob` is queue-aware (`tk.capabilities.queueAwareWait`): the
 * time the awaited child waits for a concurrency slot (`queued`) does not count
 * against the plugin's timeout, and is credited to the job the plugin runs for
 * (its row's `lane_wait_ms` and its pre-task heartbeat's cap) — decided
 * 2026-10-30: nothing fails for waiting. It is still the host's one waiter
 * (backoff, jitter, abort signal, held-job early return). Only for a plugin
 * job (a hold): a plugin route waiting inline keeps its plain timeout. A
 * child that never queues times out exactly as before, and nothing is written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeSweepDb, type SweepDb } from "../../concurrency-lanes/__tests__/fake-sweep-db.js"

const h = vi.hoisted(() => ({
  db: null as unknown as { client: { from(t: string): unknown; rpc(fn: string, args?: unknown): unknown } },
}))

vi.mock(import("@/lib/config.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, hasCredits: () => true }
})
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (t: string) => h.db.client.from(t), rpc: (fn: string, args?: unknown) => h.db.client.rpc(fn, args) },
}))

const { buildToolkit } = await import("../toolkit.js")
const { runHolding } = await import("../../concurrency-lanes/hold.js")
const { flushCoordinatorWaitForTests } = await import("../../concurrency-lanes/coordinator-wait.js")
type ConcurrencyHold = import("../../concurrency-lanes/hold.js").ConcurrencyHold

const MIN = 60_000
const USER = "00000000-0000-4000-8000-0000000000a1"
const PARENT = "00000000-0000-4000-8000-0000000000b1"
const CHILD = "00000000-0000-4000-8000-0000000000c1"

let db: SweepDb

/** A plugin coordinator's hold in the video worker (its wait is kept on `jobs`). */
const parentHold: ConcurrencyHold = {
  role: "run", lane: "run", userId: USER, payer: `user:${USER}`, tier: "pro", jobId: PARENT, leaseId: null, waitTable: "jobs",
}

function child(status: string, forMs: number, then = "completed"): void {
  const row = { id: CHILD, user_id: USER, status, output_data: { videoUrl: "https://cdn.example/v.mp4" }, job_type: "image-to-video", created_at: new Date().toISOString() }
  db.rows("jobs").push(row)
  setTimeout(() => { row.status = then }, forMs)
}

beforeEach(() => {
  db = makeSweepDb()
  h.db = db
  db.rows("jobs").push({ id: PARENT, user_id: USER, status: "processing", lane_wait_ms: 0, job_type: "generate-video-pro" })
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("tk.jobs.waitForJob", () => {
  it("tk.jobs.waitForJob does not count queued time", async () => {
    child("queued", 20 * MIN)
    const tk = buildToolkit()
    expect(tk.capabilities?.queueAwareWait).toBe(true)
    const done = runHolding(parentHold, async () => {
      const r = await tk.jobs.waitForJob!({ jobId: CHILD, timeoutMs: 5 * MIN })
      await flushCoordinatorWaitForTests()
      return r
    })
    await vi.advanceTimersByTimeAsync(25 * MIN)
    await expect(done).resolves.toMatchObject({ status: "completed", outputUrl: "https://cdn.example/v.mp4" })
    // The child's 20 minutes in line are the plugin job's own wait, kept on its row.
    const waited = Number(db.row("jobs", PARENT)?.lane_wait_ms)
    expect(waited).toBeGreaterThanOrEqual(19 * MIN)
    expect(waited).toBeLessThanOrEqual(21 * MIN)
  })

  it("a child that never queues times out as before, and nothing is written", async () => {
    child("processing", 20 * MIN)
    const tk = buildToolkit()
    const done = runHolding(parentHold, () => tk.jobs.waitForJob!({ jobId: CHILD, timeoutMs: 5 * MIN }))
    await vi.advanceTimersByTimeAsync(6 * MIN)
    await expect(done).resolves.toMatchObject({ status: "timeout", lastSeen: { status: "processing" } })
    expect(db.writes).toEqual([])
  })

  it("a plugin route waiting inline (no job hold) keeps its plain timeout while the child is queued", async () => {
    child("queued", 20 * MIN)
    const tk = buildToolkit()
    const done = tk.jobs.waitForJob!({ jobId: CHILD, timeoutMs: 5 * MIN })
    await vi.advanceTimersByTimeAsync(6 * MIN)
    await expect(done).resolves.toMatchObject({ status: "timeout", lastSeen: { status: "queued" } })
    expect(db.writes).toEqual([])
  })

  it("keeps the shared waiter's held-job early return and abort signal", async () => {
    child("pending_review", 60 * MIN)
    const tk = buildToolkit()
    await expect(tk.jobs.waitForJob!({ jobId: CHILD, timeoutMs: 5 * MIN })).resolves.toMatchObject({ status: "pending_review" })
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(tk.jobs.waitForJob!({ jobId: CHILD, timeoutMs: 5 * MIN, signal: ctrl.signal })).resolves.toMatchObject({ status: "aborted" })
  })
})
