/**
 * The run lane at the video director: a director (a `jobs` row) takes a slot
 * of its user's run lane, after its user's share of this server's director
 * pool (1 of its 2 workers); a refused one becomes `queued`, is stamped and
 * parked on BullMQ's delayed set (no attempt spent); a re-picked `processing`
 * one is re-admitted at once; an entry the lanes' sweep added again runs only
 * from `queued`. Drives the worker's real pickup on the gate's JS twin and an
 * in-memory database; the director chain itself is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DelayedError } from "bullmq"
import type { FastifyInstance } from "fastify"
import type { LaneSizes } from "../../lib/concurrency-lanes/types.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  db: null as unknown as { client: { from(t: string): unknown } },
  sizes: { provider: 10, llm: 20, local: 20, run: 1 } as { provider: number; llm: number; local: number; run: number },
  runDirector: vi.fn<(...args: unknown[]) => Promise<{ videoUrl: string }>>(async () => ({ videoUrl: "https://cdn.example.com/v.mp4" })),
}))

vi.mock("ioredis", () => ({ default: class FakeRedis {} }))
vi.mock("@/lib/config.js", () => ({ config: { REDIS_URL: "redis://localhost:6379" }, hasCredits: () => true }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))
vi.mock("@/ee/video-director/orchestrate.js", () => ({
  runVideoDirector: (...args: unknown[]) => refs.runDirector(...args),
  defaultDirectorDeps: () => ({}),
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: vi.fn(async () => undefined),
  refundReservedCreditsForJob: vi.fn(async () => 0),
}))
vi.mock("../shared.js", () => ({ markJobCompleted: vi.fn(async () => true) }))
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("@/lib/concurrency-lanes/sizes.js", () => ({ laneSizesFor: async () => refs.sizes as LaneSizes }))
vi.mock("@/lib/concurrency-lanes/provider-of.js", () => ({ primaryProviderOfJob: () => null }))

const { ConcurrencyGate } = await import("../../lib/concurrency-lanes/gate.js")
const { makeFakeLaneClient, makeFakeLaneStore } = await import("../../lib/concurrency-lanes/__tests__/fake-lane-redis.js")
const { makeFakeLaneDb } = await import("../../lib/concurrency-lanes/__tests__/fake-lane-db.js")
const { registerLaneParking, LANE_PARK_BACKSTOP_MS } = await import("../../lib/concurrency-lanes/park.js")
const { resetWorkerAdmitHooksForTests } = await import("../../lib/concurrency-lanes/worker-admit.js")
const { resetServerShareForTests, serverShare, serverShareOf } = await import("../../lib/concurrency-lanes/server-share.js")
const { resetLaneColumnsForTests } = await import("../../lib/concurrency-lanes/columns.js")
const { currentConcurrencyHold } = await import("../../lib/concurrency-lanes/hold.js")
const { runVideoDirectorPickup, VIDEO_DIRECTOR_CONCURRENCY } = await import("../video-director-worker.js")

type Gate = InstanceType<typeof ConcurrencyGate>
let gate: Gate
let db: ReturnType<typeof makeFakeLaneDb>
const APP = {} as FastifyInstance

function directorRow(id: string, status = "pending") {
  const row: Record<string, unknown> = { id, user_id: "U", status, started_at: null, parent_job_id: null, workflow_execution_id: null, pipeline_id: null, workspace_id: null, org_id: null, source: "mcp", source_detail: null, mcp_client: null }
  db.rows("jobs").push(row)
  return row
}

function bull(jobId: string, id = `bull-${jobId}`) {
  return {
    id,
    name: "video-director",
    data: { jobId, genre: "explainer", brief: "b", userId: "U", tier: "pro" },
    opts: { attempts: 1 },
    attemptsMade: 0,
    moveToDelayed: vi.fn(async () => undefined),
    promote: vi.fn(async () => undefined),
  }
}

async function fillRunLane(): Promise<void> {
  const r = await gate.acquire({
    meta: { jobId: "other", userId: "U", payer: "user:U", lane: "run", provider: null, source: null, sourceDetail: null, jobType: "video-director", model: null, queue: "video-director", bullJobId: "other" },
    size: 1, mode: "fresh", leaseTtlMs: 3_600_000,
  })
  if (!r.granted) throw new Error("expected a grant")
}

const runLine = async () => (await gate.snapshot()).lines.find((l) => l.payer === "user:U")?.lanes.run

beforeEach(async () => {
  const client = makeFakeLaneClient(makeFakeLaneStore())
  refs.gate = new ConcurrencyGate({ client: () => client })
  gate = refs.gate as Gate
  db = makeFakeLaneDb()
  refs.db = db
  refs.sizes = { provider: 10, llm: 20, local: 20, run: 1 }
  refs.runDirector = vi.fn<(...args: unknown[]) => Promise<{ videoUrl: string }>>(async () => ({ videoUrl: "https://cdn.example.com/v.mp4" }))
  vi.stubEnv("RUNTIME_ENV", "production")
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "")
  resetWorkerAdmitHooksForTests()
  resetServerShareForTests()
  resetLaneColumnsForTests()
  // What createVideoDirectorWorker does.
  registerLaneParking()
  serverShare("director", VIDEO_DIRECTOR_CONCURRENCY)
  await gate.setEnforced(true)
})

describe("the run lane at the video director", () => {
  it("a director over its run line waits as queued", async () => {
    await fillRunLane()
    const row = directorRow("job-1")
    const j = bull("job-1")
    const before = Date.now()
    await expect(runVideoDirectorPickup(j, "tok", APP)).rejects.toBeInstanceOf(DelayedError)
    expect(refs.runDirector).not.toHaveBeenCalled()
    expect(row).toMatchObject({ status: "queued", lane_env: "production", lane_bull_queue: "video-director", lane_bull_job_id: "bull-job-1", lane_queued_at: expect.any(String) })
    expect(j.moveToDelayed).toHaveBeenCalledTimes(1)
    expect((j.moveToDelayed.mock.calls[0] as unknown as [number])[0]).toBeGreaterThanOrEqual(before + LANE_PARK_BACKSTOP_MS)
    expect(await runLine()).toMatchObject({ running: 1, queued: 1 })
  })

  it("a director that waited runs at its next pickup once a slot is free, and its stored payload goes", async () => {
    const row = directorRow("job-1", "queued")
    db.rows("lane_requeue_payloads").push({ kind: "job", row_id: "job-1", bull_queue: "video-director", bull_job_id: "bull-job-1", name: "video-director", data: {}, opts: {} })
    await runVideoDirectorPickup(bull("job-1"), "tok", APP)
    expect(refs.runDirector).toHaveBeenCalledTimes(1)
    expect(row.status).toBe("processing")
    await vi.waitFor(() => expect(db.rows("lane_requeue_payloads")).toEqual([]))
  })

  it("the director runs under a run hold", async () => {
    directorRow("job-1")
    let hold: unknown
    refs.runDirector = vi.fn<(...args: unknown[]) => Promise<{ videoUrl: string }>>(async () => {
      hold = currentConcurrencyHold()
      return { videoUrl: "https://cdn.example.com/v.mp4" }
    })
    await runVideoDirectorPickup(bull("job-1"), "tok", APP)
    expect(hold).toMatchObject({ role: "run", lane: "run", userId: "U", jobId: "job-1", leaseId: expect.any(String) })
    expect(await runLine()).toBeUndefined()
  })

  it("a re-picked processing director is readmitted at once", async () => {
    await fillRunLane()
    directorRow("job-1", "processing")
    const acquire = vi.spyOn(gate, "acquire")
    await runVideoDirectorPickup(bull("job-1"), "tok", APP)
    expect(acquire.mock.calls.map((c) => c[0].mode)).toEqual(["readmit"])
    expect(refs.runDirector).toHaveBeenCalledTimes(1)
  })

  it("an entry the sweep added again runs only from queued: a director already started is never run twice", async () => {
    const row = directorRow("job-1", "processing")
    await runVideoDirectorPickup(bull("job-1", "lane-readd-job-1"), "tok", APP)
    expect(refs.runDirector).not.toHaveBeenCalled()
    expect(row.status).toBe("processing")
  })

  it("a cancelled queued director woken at its backstop does not run", async () => {
    const row = directorRow("job-1", "cancelled")
    const acquire = vi.spyOn(gate, "acquire")
    await runVideoDirectorPickup(bull("job-1"), "tok", APP)
    expect(refs.runDirector).not.toHaveBeenCalled()
    expect(row.status).toBe("cancelled")
    // The slot its pickup took is given back.
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(await runLine()).toBeUndefined()
  })

  it("a director discarded at its pickup says so as a warning (never console.log)", async () => {
    directorRow("job-1", "cancelled")
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await runVideoDirectorPickup(bull("job-1"), "tok", APP)
    expect(log).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("discarding"))
    log.mockRestore()
    warn.mockRestore()
  })

  it("a director whose row is gone is not admitted as a fresh run and does not run", async () => {
    // Deleted with its account while it waited: no row at all (not a read that failed).
    const acquire = vi.spyOn(gate, "acquire")
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await runVideoDirectorPickup(bull("job-1"), "tok", APP)
    expect(acquire).not.toHaveBeenCalled()
    expect(refs.runDirector).not.toHaveBeenCalled()
    expect(await runLine()).toBeUndefined()
    vi.restoreAllMocks()
  })

  it("a re-added director whose claim the database cannot answer is discarded, never run unchecked", async () => {
    directorRow("job-1", "queued")
    db.failUpdate = (table) => (table === "jobs" ? { code: "08006", message: "connection failure" } : null)
    await runVideoDirectorPickup(bull("job-1", "lane-readd-job-1"), "tok", APP)
    expect(refs.runDirector).not.toHaveBeenCalled()
  })

  it("an ordinary pickup whose claim the database cannot answer still runs, as before", async () => {
    directorRow("job-1")
    let failed = false
    db.failUpdate = (table) => {
      if (table !== "jobs" || failed) return null
      failed = true
      return { code: "08006", message: "connection failure" }
    }
    await runVideoDirectorPickup(bull("job-1"), "tok", APP)
    expect(refs.runDirector).toHaveBeenCalledTimes(1)
  })

  it("one user cannot hold more than one of the director pool's 2 workers", async () => {
    refs.sizes = { ...refs.sizes, run: 10 }
    expect(serverShareOf("director").occupancy()).toMatchObject({ poolSize: 2, userCap: 1 })
    directorRow("job-1")
    directorRow("job-2")
    let finish = () => {}
    refs.runDirector = vi.fn<(...args: unknown[]) => Promise<{ videoUrl: string }>>(() => new Promise((resolve) => { finish = () => resolve({ videoUrl: "https://cdn.example.com/v.mp4" }) }))
    const first = runVideoDirectorPickup(bull("job-1"), "t1", APP)
    await vi.waitFor(() => expect(refs.runDirector).toHaveBeenCalledTimes(1))
    await expect(runVideoDirectorPickup(bull("job-2"), "t2", APP)).rejects.toBeInstanceOf(DelayedError)
    expect(await gate.describeWait("job-2")).toMatchObject({ reason: "server_busy" })
    finish()
    await first
  })

  it("with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    await fillRunLane()
    const row = directorRow("job-1")
    const j = bull("job-1")
    let line: unknown
    refs.runDirector = vi.fn<(...args: unknown[]) => Promise<{ videoUrl: string }>>(async () => {
      line = await runLine()
      return { videoUrl: "https://cdn.example.com/v.mp4" }
    })
    await runVideoDirectorPickup(j, "tok", APP)
    expect(refs.runDirector).toHaveBeenCalledTimes(1)
    expect(j.moveToDelayed).not.toHaveBeenCalled()
    expect(row).not.toHaveProperty("lane_env")
    expect(line).toMatchObject({ running: 2, overLimit: 1, queued: 0 })
  })
})
