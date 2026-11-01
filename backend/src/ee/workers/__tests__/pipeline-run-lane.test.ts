/**
 * The run lane at the pipeline worker: a pipeline never driven (`queued`)
 * takes a slot of its payer's run lane, after its user's share of this
 * server's pipeline pool (1 of the default 5); a refused one stays `queued`,
 * is stamped and parked on BullMQ's delayed set (no attempt spent); a later
 * drive is re-admitted at once; the drive runs under a run hold. Drives the
 * worker's real processor on the gate's JS twin and an in-memory database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DelayedError } from "bullmq"
import type { LaneSizes } from "../../../lib/concurrency-lanes/types.js"

const refs = vi.hoisted(() => ({
  processor: null as null | ((job: unknown, token?: string) => Promise<void>),
  gate: null as unknown,
  db: null as unknown as { client: { from(t: string): unknown } },
  sizes: { provider: 10, llm: 20, local: 20, run: 1 } as { provider: number; llm: number; local: number; run: number },
  payer: { payer: "user", userId: "U" } as Record<string, unknown>,
  drive: vi.fn<(fn: () => Promise<unknown>) => Promise<unknown>>(async () => undefined),
}))

vi.mock("bullmq", async (importOriginal) => {
  const real = await importOriginal<typeof import("bullmq")>()
  class Worker {
    on = vi.fn()
    close = vi.fn()
    constructor(_queue: string, processor: (job: unknown, token?: string) => Promise<void>) {
      refs.processor = processor
    }
  }
  return { ...real, Worker }
})
vi.mock("ioredis", () => ({ default: class FakeRedis {} }))
vi.mock("@/lib/config.js", () => ({ config: { REDIS_URL: "redis://localhost:6379" }, hasCredits: () => true }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))
vi.mock("@/lib/private-plugins/load.js", () => ({ loadPrivatePlugins: vi.fn(async () => ({})) }))
vi.mock("@/ee/pipelines/engine.js", () => ({ drivePipeline: vi.fn(async () => undefined) }))
vi.mock("@/ee/pipelines/redrive-latch.js", () => ({ driveWithRedriveLatch: (_s: unknown, _id: string, fn: () => Promise<unknown>) => refs.drive(fn) }))
vi.mock("@/ee/pipelines/events.js", () => ({ pipelineEvents: { subscribe: vi.fn(() => () => {}), publish: vi.fn() } }))
vi.mock("@/ee/pipelines/pipeline-context.js", () => ({ pipelineContext: { run: (_c: unknown, fn: () => unknown) => fn() } }))
vi.mock("@/ee/pipelines/queue.js", () => ({ pipelineOrchestrationQueue: {} }))
vi.mock("@/ee/pipelines/resume.js", () => ({ resumeActiveOrchestrators: vi.fn(async () => ({ resumed: 0, failed: 0 })) }))
vi.mock("@/ee/pipelines/pipeline-payer.js", () => ({ getPipelineBillingContext: vi.fn(async () => refs.payer) }))
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("@/lib/concurrency-lanes/sizes.js", () => ({ laneSizesFor: async () => refs.sizes as LaneSizes }))
vi.mock("@/lib/concurrency-lanes/provider-of.js", () => ({ primaryProviderOfJob: () => null }))

const { ConcurrencyGate } = await import("../../../lib/concurrency-lanes/gate.js")
const { makeFakeLaneClient, makeFakeLaneStore } = await import("../../../lib/concurrency-lanes/__tests__/fake-lane-redis.js")
const { makeFakeLaneDb } = await import("../../../lib/concurrency-lanes/__tests__/fake-lane-db.js")
const { resetWorkerAdmitHooksForTests } = await import("../../../lib/concurrency-lanes/worker-admit.js")
const { resetServerShareForTests, serverShareOf } = await import("../../../lib/concurrency-lanes/server-share.js")
const { resetLaneColumnsForTests } = await import("../../../lib/concurrency-lanes/columns.js")
const { LANE_PARK_BACKSTOP_MS } = await import("../../../lib/concurrency-lanes/park.js")
const { currentConcurrencyHold } = await import("../../../lib/concurrency-lanes/hold.js")
const { startPipelineWorker } = await import("../pipeline-worker.js")

type Gate = InstanceType<typeof ConcurrencyGate>
let gate: Gate
let db: ReturnType<typeof makeFakeLaneDb>

function job(pipelineId: string) {
  return {
    id: `pipeline-${pipelineId}`,
    name: "run",
    data: { pipelineId, userId: "U", reason: "initial" },
    opts: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    attemptsMade: 0,
    moveToDelayed: vi.fn(async () => undefined),
    promote: vi.fn(async () => undefined),
  }
}

function pipeline(id: string, status = "queued") {
  const row: Record<string, unknown> = { id, user_id: "U", status }
  db.rows("pipelines").push(row)
  return row
}

async function fillRunLane(payer = "user:U"): Promise<void> {
  const r = await gate.acquire({
    meta: { jobId: "other", userId: "U", payer: payer as `user:${string}`, lane: "run", provider: null, source: null, sourceDetail: null, jobType: "run", model: null, queue: "pipeline-orchestration", bullJobId: "other" },
    size: 1, mode: "fresh", leaseTtlMs: 3_600_000,
  })
  if (!r.granted) throw new Error("expected a grant")
}

const runLine = async (payer = "user:U") => (await gate.snapshot()).lines.find((l) => l.payer === payer)?.lanes.run

beforeEach(async () => {
  const client = makeFakeLaneClient(makeFakeLaneStore())
  refs.gate = new ConcurrencyGate({ client: () => client })
  gate = refs.gate as Gate
  db = makeFakeLaneDb()
  refs.db = db
  refs.sizes = { provider: 10, llm: 20, local: 20, run: 1 }
  refs.payer = { payer: "user", userId: "U" }
  refs.drive = vi.fn<(fn: () => Promise<unknown>) => Promise<unknown>>(async (fn) => fn())
  vi.stubEnv("RUNTIME_ENV", "production")
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "")
  resetWorkerAdmitHooksForTests()
  resetServerShareForTests()
  resetLaneColumnsForTests()
  startPipelineWorker()
  await gate.setEnforced(true)
})

describe("the run lane at the pipeline worker", () => {
  it("a pipeline over its run line waits as queued with stamps", async () => {
    await fillRunLane()
    const row = pipeline("pipe-1")
    const j = job("pipe-1")
    const before = Date.now()
    await expect(refs.processor!(j, "tok")).rejects.toBeInstanceOf(DelayedError)
    expect(refs.drive).not.toHaveBeenCalled()
    expect(row).toMatchObject({ status: "queued", lane_env: "production", lane_env_id: null, lane_queued_at: expect.any(String) })
    expect(j.moveToDelayed).toHaveBeenCalledTimes(1)
    const [when, token] = j.moveToDelayed.mock.calls[0] as unknown as [number, string]
    expect(token).toBe("tok")
    expect(when).toBeGreaterThanOrEqual(before + LANE_PARK_BACKSTOP_MS)
    expect(db.rows("lane_requeue_payloads")).toEqual([expect.objectContaining({
      kind: "pipeline", row_id: "pipe-1", bull_queue: "pipeline-orchestration", bull_job_id: "pipeline-pipe-1", name: "run",
    })])
    expect(await runLine()).toMatchObject({ running: 1, queued: 1 })
  })

  it("a later drive of a pipeline already running is readmitted at once", async () => {
    await fillRunLane()
    pipeline("pipe-1", "awaiting_approval")
    const acquire = vi.spyOn(gate, "acquire")
    await refs.processor!(job("pipe-1"), "tok")
    expect(refs.drive).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls.map((c) => c[0].mode)).toEqual(["readmit"])
  })

  it("the drive runs under the pipeline's run hold", async () => {
    pipeline("pipe-1")
    let hold: unknown
    refs.drive = vi.fn<(fn: () => Promise<unknown>) => Promise<unknown>>(async () => { hold = currentConcurrencyHold() })
    await refs.processor!(job("pipe-1"), "tok")
    expect(hold).toMatchObject({ role: "run", lane: "run", userId: "U", jobId: "pipe-1", leaseId: expect.any(String) })
    expect(await runLine()).toBeUndefined()
  })

  it("a workspace's pipeline waits in the workspace's line", async () => {
    refs.payer = { payer: "workspace", userId: "U", workspaceId: "ws-1", orgId: "org-1", entitlements: { tierForGates: "business" } }
    pipeline("pipe-1")
    let line: unknown
    refs.drive = vi.fn<(fn: () => Promise<unknown>) => Promise<unknown>>(async () => { line = await runLine("workspace:ws-1") })
    await refs.processor!(job("pipe-1"), "tok")
    expect(line).toMatchObject({ running: 1 })
  })

  it("one user cannot hold more than one of the pipeline pool's 5 workers", async () => {
    refs.sizes = { ...refs.sizes, run: 10 }
    expect(serverShareOf("pipeline").occupancy()).toMatchObject({ poolSize: 5, userCap: 1 })
    pipeline("pipe-1")
    pipeline("pipe-2")
    let finish = () => {}
    refs.drive = vi.fn<(fn: () => Promise<unknown>) => Promise<unknown>>(() => new Promise<void>((resolve) => { finish = resolve }))
    const first = refs.processor!(job("pipe-1"), "t1")
    await vi.waitFor(() => expect(refs.drive).toHaveBeenCalledTimes(1))
    await expect(refs.processor!(job("pipe-2"), "t2")).rejects.toBeInstanceOf(DelayedError)
    expect(await gate.describeWait("pipe-2")).toMatchObject({ reason: "server_busy" })
    expect(refs.drive).toHaveBeenCalledTimes(1)
    finish()
    await first
  })

  it("with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    await fillRunLane()
    const row = pipeline("pipe-1")
    const j = job("pipe-1")
    let line: unknown
    refs.drive = vi.fn<(fn: () => Promise<unknown>) => Promise<unknown>>(async () => { line = await runLine() })
    await refs.processor!(j, "tok")
    expect(refs.drive).toHaveBeenCalledTimes(1)
    expect(j.moveToDelayed).not.toHaveBeenCalled()
    expect(row).not.toHaveProperty("lane_env")
    expect(line).toMatchObject({ running: 2, overLimit: 1, queued: 0 })
  })
})
