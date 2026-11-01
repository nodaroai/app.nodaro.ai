// @test-reads-none an in-memory database double and a stubbed cloud; reads no repo file
/**
 * A Nodaro Connect relay polls its cloud job under a fixed budget (85 min for
 * the hour-plus exclusive runs, 15 min for the vendor-direct relays). That
 * budget counts from the cloud job's START: while the connected account's
 * lines make the cloud job wait (`queued`), the relay neither gives up nor
 * spends its budget (decided 2026-10-30: nothing fails for waiting), and the
 * wait is the relaying job's own in-handler wait — on its row and off its
 * pre-task heartbeat's cap. Only for the worker-side relays, which ask for it
 * (`queueAware`) and run as jobs: a route that waits on a cloud job inline (the
 * scrapers, site capture) keeps its plain budget. A cloud job that never
 * queues gets exactly the budget it always had.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeSweepDb, type SweepDb } from "../../../lib/concurrency-lanes/__tests__/fake-sweep-db.js"

const h = vi.hoisted(() => ({
  db: null as unknown as { client: { from(t: string): unknown; rpc(fn: string, args?: unknown): unknown } },
  /** The cloud job's status over time: [untilMs since start, status]. */
  timeline: [] as Array<[number, string]>,
  startedAt: 0,
}))

vi.mock("../../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => h.db.client.from(t), rpc: (fn: string, args?: unknown) => h.db.client.rpc(fn, args) },
}))
vi.mock("../../../lib/nodaro-connect.js", () => ({
  nodaroCloudFetch: async () => {
    const at = Date.now() - h.startedAt
    const status = h.timeline.find(([until]) => at < until)?.[1] ?? "completed"
    return { ok: true, status: 200, json: async () => ({ data: { id: "cloud-1", status, output_data: { videoUrl: "https://c/v.mp4" } } }) }
  },
  getNodaroCredential: vi.fn(),
  nodaroCloudBase: () => "https://cloud.test",
}))

const { waitForCloudJob } = await import("../../../providers/nodaro/client.js")
const { relayPollBudgetMs } = await import("../nodaro-exclusive-relay.js")
const { runHolding } = await import("../../../lib/concurrency-lanes/hold.js")
const { flushCoordinatorWaitForTests } = await import("../../../lib/concurrency-lanes/coordinator-wait.js")
type ConcurrencyHold = import("../../../lib/concurrency-lanes/hold.js").ConcurrencyHold

const MIN = 60_000
/** The bound cases poll a day of fake time: slower than the default 5 s on a loaded runner. */
const BOUND_CASE_TIMEOUT_MS = 60_000
const USER = "00000000-0000-4000-8000-0000000000a1"
const NEAR_JOB = "00000000-0000-4000-8000-0000000000b1"

/** The relaying job's hold in the video worker (its wait is kept on `jobs`). */
const hold: ConcurrencyHold = {
  role: "leaf", lane: "provider", userId: USER, payer: `user:${USER}`, tier: null, jobId: NEAR_JOB, leaseId: null, waitTable: "jobs",
}

let db: SweepDb

beforeEach(() => {
  db = makeSweepDb()
  h.db = db
  db.rows("jobs").push({ id: NEAR_JOB, user_id: USER, status: "processing", lane_wait_ms: 0 })
  vi.useFakeTimers()
  h.startedAt = Date.now()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("a Connect relay's poll budget", () => {
  const budget = () => relayPollBudgetMs("generate-video-pro", {})!

  it("a Connect relay does not give up while the cloud job is queued", async () => {
    expect(budget()).toBe(85 * MIN)
    // 40 minutes in line on the connected account, then an 80-minute run: 120 minutes in all.
    h.timeline = [[40 * MIN, "queued"], [120 * MIN, "processing"]]
    const done = runHolding(hold, async () => {
      const job = await waitForCloudJob("cloud-1", undefined, { budgetMs: budget(), queueAware: true })
      await flushCoordinatorWaitForTests()
      return job
    })
    await vi.advanceTimersByTimeAsync(125 * MIN)
    await expect(done).resolves.toMatchObject({ status: "completed" })
    // The time in line is the relaying job's own wait, on its row.
    const waited = Number(db.row("jobs", NEAR_JOB)?.lane_wait_ms)
    expect(waited).toBeGreaterThanOrEqual(39 * MIN)
    expect(waited).toBeLessThanOrEqual(41 * MIN)
  })

  it("a cloud job that never queues gets exactly the budget it had, and nothing is written", async () => {
    h.timeline = [[120 * MIN, "processing"]]
    const settled = runHolding(hold, () => waitForCloudJob("cloud-1", undefined, { budgetMs: budget(), queueAware: true })).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(90 * MIN)
    expect(String(await settled)).toMatch(/did not finish within/)
    expect(db.writes).toEqual([])
  })

  it("a wait that does not ask, or that runs as no job (a route waiting inline), keeps its plain budget while the cloud job is queued", async () => {
    h.timeline = [[200 * MIN, "queued"]]
    const notAsked = runHolding(hold, () => waitForCloudJob("cloud-1", undefined, { budgetMs: budget() })).catch((e: unknown) => e)
    const noJob = waitForCloudJob("cloud-1", undefined, { budgetMs: budget(), queueAware: true }).catch((e: unknown) => e)
    const liveRequest = runHolding({ ...hold, transport: "json" }, () => waitForCloudJob("cloud-1", undefined, { budgetMs: budget(), queueAware: true })).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(90 * MIN)
    for (const settled of [notAsked, noJob, liveRequest]) expect(String(await settled)).toMatch(/did not finish within/)
    expect(db.writes).toEqual([])
  })

  it("a cloud job stuck in `queued` past the queue timeout's bound is given up", async () => {
    h.timeline = [[100 * 60 * MIN, "queued"]]
    const settled = runHolding(hold, () => waitForCloudJob("cloud-1", undefined, { budgetMs: budget(), queueAware: true })).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync((24 * 60 + 30) * MIN + budget() + 2 * MIN)
    expect(String(await settled)).toMatch(/did not finish within/)
  }, BOUND_CASE_TIMEOUT_MS)
})
