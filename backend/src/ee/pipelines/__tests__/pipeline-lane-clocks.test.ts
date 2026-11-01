// @test-reads-none an in-memory database double and a fake lane gate; reads no repo file
/**
 * A film pipeline's clocks and its stage jobs' place in line (concurrency
 * lanes, decided 2026-10-30: nothing fails for waiting).
 *
 *   - a stage poll (`PIPELINE_STAGE_TIMEOUT_MS`, 30 min) counts from the stage
 *     job's START: the time it waits for a slot (`queued`) is left out, and
 *     credited to the pipeline's own row (`pipelines.lane_wait_ms`, which the
 *     pipelines reconcile's 6-hour abandon leaves out — proven in
 *     lib/concurrency-lanes/__tests__/sweeps-spare-waiters.test.ts);
 *   - a stage job is recognised by its `pipeline_id` and enters its lane ahead
 *     of jobs that have not started;
 *   - only inside a drive: a route that waits on a stage job inline keeps
 *     its plain timeout;
 *   - with nothing queued, nothing changes: the same timeout, no write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PIPELINE_STAGE_TIMEOUT_MS } from "@nodaro/shared/pipeline"
import { makeSweepDb, type SweepDb } from "../../../lib/concurrency-lanes/__tests__/fake-sweep-db.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"
import { ConcurrencyGate } from "../../../lib/concurrency-lanes/gate.js"
import type { LaneSizes } from "../../../lib/concurrency-lanes/types.js"

const h = vi.hoisted(() => ({
  db: null as unknown as { client: { from(t: string): unknown; rpc(fn: string, args?: unknown): unknown } },
  gate: null as unknown,
  sizes: { provider: 1, llm: 2, local: 1, run: 1 } as LaneSizes,
}))

vi.mock("../../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => h.db.client.from(t), rpc: (fn: string, args?: unknown) => h.db.client.rpc(fn, args) },
}))
vi.mock("../../../lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => h.gate }))
vi.mock("../../../lib/concurrency-lanes/sizes.js", () => ({ laneSizesFor: async () => h.sizes }))
vi.mock("../../../lib/concurrency-lanes/provider-of.js", () => ({ primaryProviderOfJob: () => "kie" }))

const { pollJobUntilComplete } = await import("../services/_poll.js")
const { admitWorkerJob } = await import("../../../lib/concurrency-lanes/worker-admit.js")
const { runHolding } = await import("../../../lib/concurrency-lanes/hold.js")
const { flushCoordinatorWaitForTests } = await import("../../../lib/concurrency-lanes/coordinator-wait.js")
type ConcurrencyHold = import("../../../lib/concurrency-lanes/hold.js").ConcurrencyHold

const MIN = 60_000
/** The bound cases poll a day of fake time: slower than the default 5 s on a loaded runner. */
const BOUND_CASE_TIMEOUT_MS = 60_000
const USER = "00000000-0000-4000-8000-0000000000a1"
const PIPELINE = "00000000-0000-4000-8000-0000000000e1"
const STAGE_JOB = "00000000-0000-4000-8000-0000000000c1"

let db: SweepDb

/** The pipeline drive's hold, as the pipeline worker admits it (its wait is kept on `pipelines`). */
const pipelineHold: ConcurrencyHold = {
  role: "run", lane: "run", userId: USER, payer: `user:${USER}`, tier: "pro", jobId: PIPELINE, leaseId: null, waitTable: "pipelines",
}

/** The stage job; becomes `then` after `forMs`. */
function stageJob(status: string, forMs: number, then = "completed"): void {
  const row = { id: STAGE_JOB, user_id: USER, status, pipeline_id: PIPELINE, output_data: { imageUrl: "https://cdn.example/i.png" }, error_message: null, credits_actual: 4 }
  db.rows("jobs").push(row)
  setTimeout(() => { row.status = then }, forMs)
}

const client = () => h.db.client as never

beforeEach(() => {
  db = makeSweepDb()
  h.db = db
  db.rows("pipelines").push({ id: PIPELINE, user_id: USER, status: "running", lane_wait_ms: 0 })
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("a pipeline stage poll", () => {
  it("a pipeline stage child queued 40 min does not time out", async () => {
    vi.useFakeTimers()
    stageJob("queued", 40 * MIN)
    const done = runHolding(pipelineHold, async () => {
      const row = await pollJobUntilComplete(client(), STAGE_JOB)
      await flushCoordinatorWaitForTests()
      return row
    })
    await vi.advanceTimersByTimeAsync(45 * MIN)
    await expect(done).resolves.toMatchObject({ status: "completed" })
    // The 40 minutes are the pipeline's own wait: its row carries them for its 6-hour abandon.
    const waited = Number(db.row("pipelines", PIPELINE)?.lane_wait_ms)
    expect(waited).toBeGreaterThanOrEqual(39 * MIN)
    expect(waited).toBeLessThanOrEqual(41 * MIN)
  })

  it("a stage job that never queues keeps today's 30-minute limit, and nothing is written (with enforcement off nothing queues)", async () => {
    vi.useFakeTimers()
    stageJob("pending", 40 * MIN)
    const settled = runHolding(pipelineHold, () => pollJobUntilComplete(client(), STAGE_JOB)).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(PIPELINE_STAGE_TIMEOUT_MS + MIN)
    expect(String(await settled)).toMatch(new RegExp(`timed out after ${PIPELINE_STAGE_TIMEOUT_MS}ms`))
    expect(db.writes).toEqual([])
  })

  it("a route that waits on a stage job inline (no drive, no hold) keeps today's 30-minute limit while it is queued", async () => {
    vi.useFakeTimers()
    stageJob("queued", 40 * MIN)
    const settled = pollJobUntilComplete(client(), STAGE_JOB).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(PIPELINE_STAGE_TIMEOUT_MS + MIN)
    expect(String(await settled)).toMatch(new RegExp(`timed out after ${PIPELINE_STAGE_TIMEOUT_MS}ms`))
    expect(db.writes).toEqual([])
  })

  it("a stage job stuck in `queued` past the queue timeout's bound no longer holds the clock", async () => {
    vi.useFakeTimers()
    stageJob("queued", 40 * 60 * MIN)
    const settled = runHolding(pipelineHold, () => pollJobUntilComplete(client(), STAGE_JOB)).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync((24 * 60 + 30) * MIN + PIPELINE_STAGE_TIMEOUT_MS + MIN)
    expect(String(await settled)).toMatch(/timed out/)
  }, BOUND_CASE_TIMEOUT_MS)
})

describe("a pipeline stage job's place in line", () => {
  it("a pipeline stage job enters its lane ahead of a fresh fan-out", async () => {
    const store = makeFakeLaneStore()
    const gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
    h.gate = gate
    await gate.setEnforced(true)
    const meta = (id: string) => ({
      jobId: id, userId: USER, payer: `user:${USER}` as const, lane: "provider" as const, provider: "kie", source: null,
      sourceDetail: null, jobType: "generate-image", model: null, queue: "video-generation" as const, bullJobId: id,
    })
    expect((await gate.acquire({ meta: meta("running"), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })).granted).toBe(true)
    for (const id of ["fan-1", "fan-2", "fan-3"]) {
      expect((await gate.acquire({ meta: meta(id), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })).granted).toBe(false)
    }
    const row = (over: { id: string; pipeline_id: string | null }) => ({
      user_id: USER, status: "pending", started_at: null, parent_job_id: null, workflow_execution_id: null,
      workspace_id: null, org_id: null, source: "api", source_detail: null, mcp_client: null, ...over,
    })
    const stage = await admitWorkerJob({
      job: { id: "bull-stage", name: "generate-image", data: { jobId: STAGE_JOB, userId: USER } },
      queue: "video-generation",
      row: row({ id: STAGE_JOB, pipeline_id: PIPELINE }),
    })
    if (stage.admitted) throw new Error("expected a wait")
    expect(stage.wait.position).toBe(1)
    // Control: the same job with no pipeline waits behind the fan-out.
    const fresh = await admitWorkerJob({
      job: { id: "bull-plain", name: "generate-image", data: { jobId: "plain-job", userId: USER } },
      queue: "video-generation",
      row: row({ id: "plain-job", pipeline_id: null }),
    })
    if (fresh.admitted) throw new Error("expected a wait")
    expect(fresh.wait.position).toBe(5)
  })
})
