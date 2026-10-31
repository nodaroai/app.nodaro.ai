// Parking and waking, on the gate's JS twin and an in-memory database: a job
// its lane refuses is put back on BullMQ's delayed set with a long backstop
// (no attempt spent), stamped as `queued`, and promoted by its stored id when a
// release reserves a slot for it — or when enforcement goes off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DelayedError } from "bullmq"
import { ConcurrencyGate, type WakeTarget } from "../gate.js"
import type { LaneSizes } from "../types.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "./fake-lane-redis.js"
import { makeFakeLaneDb, type FakeLaneDb } from "./fake-lane-db.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  db: null as unknown as { client: { from(t: string): unknown } },
  sizes: { provider: 1, llm: 2, local: 1, run: 1 } as LaneSizes,
  /** BullMQ jobs by "<queue>/<id>", as Job.fromId finds them. */
  bull: new Map<string, { promote: () => Promise<void> }>(),
  subscribed: [] as Array<{ queues: string[]; onWake: (t: WakeTarget[]) => Promise<void>; stopped: boolean }>,
}))

vi.mock("bullmq", async (importOriginal) => {
  const real = await importOriginal<typeof import("bullmq")>()
  class Queue {
    constructor(readonly name: string, readonly opts: unknown) {}
  }
  const Job = {
    fromId: vi.fn(async (queue: { name: string }, id: string) => refs.bull.get(`${queue.name}/${id}`)),
  }
  return { ...real, Queue, Job }
})
vi.mock("../instance.js", () => ({ concurrencyGate: () => refs.gate }))
// The switch's on → off wake is exercised here, so turning limits on is made available.
vi.mock("../enforcement-available.js", () => ({ LANES_ENFORCEMENT_AVAILABLE: true }))
vi.mock("../../supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))
vi.mock("../sizes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sizes.js")>()),
  laneSizesFor: async () => refs.sizes,
}))
vi.mock("../provider-of.js", () => ({ primaryProviderOfJob: () => "kie" }))
vi.mock("../../queue.js", () => ({ redis: { fake: "connection" } }))
vi.mock("../wake-subscriber.js", () => ({
  startLaneWakeSubscriber: (queues: string[], onWake: (t: WakeTarget[]) => Promise<void>) => {
    const s = { queues, onWake, stopped: false }
    refs.subscribed.push(s)
    return () => { s.stopped = true }
  },
}))

const { Job } = await import("bullmq")
const park = await import("../park.js")
const {
  LANE_PARK_BACKSTOP_MS, parkForLane, queueOf, registerLaneParking, resetLaneParkingForTests, setLaneQueueConnection,
  startLaneParking, WAKE_ALL_CONCURRENCY, wakeAllWaiters, wakeTargets, wakeTargetsCounted,
} = park
const { admitOrPark, resetWorkerAdmitHooksForTests } = await import("../worker-admit.js")
const { laneCounters, resetLaneCountersForTests } = await import("../hold.js")
const { resetServerShareForTests, serverShare, serverShareOccupancy } = await import("../server-share.js")
const { resetLaneColumnsForTests } = await import("../columns.js")
const { registerOffTransitionWaker, resetEnforcementHooksForTests, setLanesEnforced } = await import("../enforcement.js")
type WorkerRow = import("../worker-admit.js").WorkerRow

const NOW = 1_800_000_000_000
const ADMIN = "00000000-0000-4000-8000-0000000000ad"

let db: FakeLaneDb
let gate: ConcurrencyGate

const row = (id: string, over: Partial<WorkerRow> = {}): WorkerRow => ({
  id, user_id: "U", status: "pending", started_at: null, parent_job_id: null, workflow_execution_id: null,
  pipeline_id: null, workspace_id: null, org_id: null, source: "editor", source_detail: null, mcp_client: null, ...over,
})

/** A BullMQ job as the worker holds it: moving it to delayed and promoting it are recorded. */
function bullJob(jobId: string, over: { id?: string; priority?: number } = {}) {
  const id = over.id ?? `bull-${jobId}`
  const job = {
    id,
    name: "image-to-video",
    data: { jobId, userId: "U", prompt: "a" },
    opts: { priority: over.priority ?? 1, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } },
    moveToDelayed: vi.fn(async (_ts: number, _token?: string) => undefined),
    promote: vi.fn(async () => undefined),
  }
  refs.bull.set(`video-generation/${id}`, job)
  return job
}

function jobsRow(id: string, status = "pending"): Record<string, unknown> {
  const r = { id, user_id: "U", status, lane_queued_at: null as string | null }
  db.rows("jobs").push(r)
  return r
}

async function fillProvider(): Promise<string> {
  const r = await gate.acquire({
    meta: { jobId: "other", userId: "U", payer: "user:U", lane: "provider", provider: "kie", source: null, sourceDetail: null, jobType: "x", model: null, queue: "video-generation", bullJobId: "bull-other" },
    size: 1, mode: "fresh", leaseTtlMs: 3_600_000,
  })
  if (!r.granted) throw new Error("expected a grant")
  return r.leaseId
}

const providerLane = async () => (await gate.snapshot()).lines.find((l) => l.payer === "user:U")?.lanes.provider

beforeEach(async () => {
  db = makeFakeLaneDb()
  refs.db = db
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  refs.gate = gate
  refs.bull.clear()
  refs.subscribed = []
  vi.mocked(Job.fromId).mockClear()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  vi.stubEnv("RUNTIME_ENV", "production")
  resetWorkerAdmitHooksForTests()
  resetEnforcementHooksForTests()
  resetLaneParkingForTests()
  resetLaneCountersForTests()
  resetServerShareForTests()
  resetLaneColumnsForTests()
  registerLaneParking()
  setLaneQueueConnection({ fake: "connection" })
  await gate.setEnforced(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("parkForLane", () => {
  it("a job over its line is parked as queued with stamps and no attempt spent", async () => {
    await fillProvider()
    const r = jobsRow("job-1")
    const job = bullJob("job-1")
    expect(await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })).toBeNull()

    expect(r.status).toBe("queued")
    expect(r).toMatchObject({ lane_env: "production", lane_bull_queue: "video-generation", lane_bull_job_id: "bull-job-1", lane_queued_at: new Date(NOW).toISOString() })
    expect(db.rows("lane_requeue_payloads")).toEqual([{
      kind: "job", row_id: "job-1", bull_queue: "video-generation", bull_job_id: "bull-job-1", name: "image-to-video",
      data: { jobId: "job-1", userId: "U", prompt: "a" },
      opts: { priority: 1, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } },
    }])
    expect(job.moveToDelayed).toHaveBeenCalledWith(NOW + 600_000, "tok")
    expect(LANE_PARK_BACKSTOP_MS).toBe(600_000)
    expect(job.promote).not.toHaveBeenCalled()
    // It waits in its line, not as running and not ungated.
    expect(await providerLane()).toMatchObject({ running: 1, queued: 1 })
    expect(laneCounters().ungated).toEqual({})
  })

  it("throws DelayedError, which spends no attempt", async () => {
    jobsRow("job-1")
    const job = bullJob("job-1")
    const wait = { lane: "provider" as const, position: 1, limit: 1, running: 1, reason: "user_lane" as const, waitedMs: 0, enqueuedAtMs: NOW }
    await expect(parkForLane({ job, token: "tok", queue: "video-generation", table: "jobs", rowId: "job-1", wait })).rejects.toBeInstanceOf(DelayedError)
  })

  it("a job parked again keeps its first lane_queued_at", async () => {
    await fillProvider()
    const r = jobsRow("job-1")
    const job = bullJob("job-1")
    await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })
    // The backstop brings it back, still without a slot: its row is `queued` now.
    vi.setSystemTime(NOW + 600_000)
    expect(await admitOrPark({ job, token: "tok2", queue: "video-generation", row: row("job-1", { status: "queued" }) })).toBeNull()
    expect(r).toMatchObject({ status: "queued", lane_queued_at: new Date(NOW).toISOString() })
    expect(job.moveToDelayed).toHaveBeenLastCalledWith(NOW + 1_200_000, "tok2")
    expect(db.rows("lane_requeue_payloads")).toHaveLength(1)
  })

  it("a reservation that lands during parking promotes the job at once", async () => {
    const other = await fillProvider()
    jobsRow("job-1")
    const job = bullJob("job-1")
    // The slot is freed between the refusal and the move to delayed: the wake finds the job still active.
    job.moveToDelayed.mockImplementationOnce(async () => {
      expect(await gate.release(other, "completed")).toEqual([{ jobId: "job-1", queue: "video-generation", bullJobId: "bull-job-1" }])
    })
    expect(await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })).toBeNull()
    expect(job.promote).toHaveBeenCalledTimes(1)
  })

  it("a parked job keeps its original priority", async () => {
    await fillProvider()
    jobsRow("job-1")
    const job = bullJob("job-1", { priority: 7 })
    await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })
    // Moved with its own options untouched: BullMQ re-enters it at the priority it was added with.
    expect(job.moveToDelayed.mock.calls[0]).toEqual([NOW + 600_000, "tok"])
    expect(job.opts.priority).toBe(7)
    expect((db.rows("lane_requeue_payloads")[0]!.opts as { priority: number }).priority).toBe(7)
  })

  it("a job refused and parked leaves the server share", async () => {
    await fillProvider()
    jobsRow("job-1")
    await admitOrPark({ job: bullJob("job-1"), token: "tok", queue: "video-generation", row: row("job-1") })
    expect(serverShareOccupancy().video?.byUser ?? {}).toEqual({})
  })

  it("a job holding a lane reservation that its server share refuses keeps its place, gives the slot up and does not promote itself", async () => {
    // job-1 waits in its lane; job-2 waits behind it.
    const other = await fillProvider()
    jobsRow("job-1")
    jobsRow("job-2")
    const job1 = bullJob("job-1")
    expect(await admitOrPark({ job: job1, token: "tok", queue: "video-generation", row: row("job-1") })).toBeNull()
    expect(await admitOrPark({ job: bullJob("job-2"), token: "tok", queue: "video-generation", row: row("job-2") })).toBeNull()
    // The holder's release reserves the slot for job-1, which is picked up on a
    // process where its user's share of the pool is full.
    await gate.release(other, "completed")
    expect(await gate.hasReservation("job-1")).toBe(true)
    const share = serverShare("video", 4)
    const running = share.tryEnter({ userId: "U", jobId: "running-here", coordinator: false, exempt: false })
    if (!running.entered) throw new Error("expected an entry")
    const again = bullJob("job-1")
    expect(await admitOrPark({ job: again, token: "tok2", queue: "video-generation", row: row("job-1", { status: "queued" }) })).toBeNull()
    // It waits for the share: no self-promotion, no slot held, and nothing passed down its user's line.
    expect(again.promote).not.toHaveBeenCalled()
    expect(await gate.hasReservation("job-1")).toBe(false)
    expect(await gate.hasReservation("job-2")).toBe(false)
    expect(await gate.describeWait("job-1")).toMatchObject({ reason: "server_busy" })
    // Its user has room again: it is admitted at its place, ahead of job-2.
    running.leave()
    const a = await admitOrPark({ job: bullJob("job-1"), token: "tok3", queue: "video-generation", row: row("job-1", { status: "queued" }) })
    expect(a).not.toBeNull()
    expect(a!.leaseId).toEqual(expect.any(String))
    expect(await gate.describeWait("job-2")).toMatchObject({ position: 1 })
  })

  it("the server share's waker reports how many parked jobs it moved", async () => {
    const parked = bullJob("job-1")
    expect(await wakeTargetsCounted([{ jobId: "job-1", queue: "video-generation", bullJobId: "bull-job-1" }])).toBe(1)
    expect(parked.promote).toHaveBeenCalledTimes(1)
    // Gone from BullMQ, or no longer delayed: nothing moved, so the share wakes its next waiter.
    expect(await wakeTargetsCounted([{ jobId: "job-x", queue: "video-generation", bullJobId: "bull-missing" }])).toBe(0)
    parked.promote.mockRejectedValueOnce(new Error("Job bull-job-1 is not in the delayed state"))
    expect(await wakeTargetsCounted([{ jobId: "job-1", queue: "video-generation", bullJobId: "bull-job-1" }])).toBe(0)
  })

  it("a row that stopped waiting (cancelled) is not parked: its entry is withdrawn and the claim discards it", async () => {
    await fillProvider()
    jobsRow("job-1", "cancelled")
    const job = bullJob("job-1")
    const a = await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })
    expect(a).not.toBeNull()
    expect(a!.leaseId).toBeNull()
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(db.rows("jobs")[0]!.status).toBe("cancelled")
    expect(await providerLane()).toMatchObject({ running: 1, queued: 0 })
    expect(laneCounters().ungated).toEqual({})
    await a!.release("cancelled")
  })

  it("a started row is never parked", async () => {
    // Admission readmits a `processing` row; were it refused anyway, the CAS would not move it.
    jobsRow("job-1", "processing")
    const job = bullJob("job-1")
    const wait = { lane: "provider" as const, position: 1, limit: 1, running: 1, reason: "user_lane" as const, waitedMs: 0, enqueuedAtMs: NOW }
    await expect(parkForLane({ job, token: "tok", queue: "video-generation", table: "jobs", rowId: "job-1", wait })).rejects.toThrow(/no longer waiting/)
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(db.rows("jobs")[0]!.status).toBe("processing")
  })

  it("a park whose moveToDelayed reports a lost lock does not run the job", async () => {
    await fillProvider()
    const r = jobsRow("job-1")
    const job = bullJob("job-1")
    // The entry is no longer this worker's (a stall re-pick, a replayed command): another pickup owns it now.
    job.moveToDelayed.mockRejectedValueOnce(new Error("Missing lock for job bull-job-1. moveToDelayed"))
    expect(await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })).toBeNull()
    expect(r.status).toBe("queued")
    // It still waits in its line, for the entry that owns it now.
    expect(await providerLane()).toMatchObject({ running: 1, queued: 1 })
    expect(laneCounters().ungated).toEqual({})
    expect(job.promote).not.toHaveBeenCalled()

    for (const message of [
      "Lock mismatch for job bull-job-1. Cmd moveToDelayed from active",
      "Job bull-job-1 is not in the active state. moveToDelayed",
      "Missing key for job bull-job-1. moveToDelayed",
    ]) {
      job.moveToDelayed.mockRejectedValueOnce(new Error(message))
      expect(await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1", { status: "queued" }) })).toBeNull()
    }
  })

  it("a park whose moveToDelayed fails on Redis itself runs the job ungated", async () => {
    await fillProvider()
    jobsRow("job-1")
    const job = bullJob("job-1")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    job.moveToDelayed.mockRejectedValueOnce(new Error("Connection is closed."))
    const a = await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })
    expect(a).not.toBeNull()
    expect(a!.leaseId).toBeNull()
    expect(laneCounters().ungated).toEqual({ "image-to-video": 1 })
    expect(await providerLane()).toMatchObject({ running: 1, queued: 0 })
    // This park made the row `queued`: it is put back, and the job runs from `pending`.
    expect(db.rows("jobs")[0]!.status).toBe("pending")
    await a!.release("completed")
  })

  it("a re-park whose moveToDelayed fails on Redis leaves the row queued, as it was", async () => {
    await fillProvider()
    jobsRow("job-1", "queued").lane_queued_at = new Date(NOW - 60_000).toISOString()
    const job = bullJob("job-1")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    job.moveToDelayed.mockRejectedValueOnce(new Error("Connection is closed."))
    const a = await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1", { status: "queued" }) })
    expect(a!.leaseId).toBeNull()
    expect(db.rows("jobs")[0]!.status).toBe("queued")
    await a!.release("completed")
  })

  it("a park whose row stamps cannot be written (columns absent) runs the job ungated, counted, and leaves the row pending", async () => {
    await fillProvider()
    db.missingColumns.add("jobs.lane_env")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    for (const id of ["job-1", "job-2"]) {
      jobsRow(id)
      const j = bullJob(id)
      const a = await admitOrPark({ job: j, token: "tok", queue: "video-generation", row: row(id) })
      expect(a).not.toBeNull()
      expect(a!.leaseId).toBeNull()
      expect(j.moveToDelayed).not.toHaveBeenCalled()
      await a!.release("completed")
    }
    // No row was left waiting without the stamps every sweep reads, and nothing waits in the line.
    expect(db.rows("jobs").map((r) => r.status)).toEqual(["pending", "pending"])
    expect(db.rows("jobs").every((r) => r.lane_env === undefined && r.lane_queued_at === null)).toBe(true)
    expect(laneCounters().ungated).toEqual({ "image-to-video": 2 })
    expect(await providerLane()).toMatchObject({ running: 1, queued: 0 })
  })

  it("a park whose lane_queued_at write fails runs the job ungated and leaves the row pending; the next refusal parks", async () => {
    await fillProvider()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const r = jobsRow("job-1")
    db.failUpdate = (_t, payload) => ("lane_queued_at" in payload ? { code: "57014", message: "statement timeout" } : null)
    const a = await admitOrPark({ job: bullJob("job-1"), token: "tok", queue: "video-generation", row: row("job-1") })
    expect(a!.leaseId).toBeNull()
    expect(r.status).toBe("pending")
    expect(r.lane_queued_at).toBeNull()
    expect(laneCounters().ungated).toEqual({ "image-to-video": 1 })
    await a!.release("completed")

    db.failUpdate = null
    const r2 = jobsRow("job-2")
    expect(await admitOrPark({ job: bullJob("job-2"), token: "tok", queue: "video-generation", row: row("job-2") })).toBeNull()
    expect(r2).toMatchObject({ status: "queued", lane_env: "production", lane_queued_at: new Date(NOW).toISOString() })
  })

  it("a re-park whose stamps fail leaves its row queued and stamped from the first park, and runs ungated", async () => {
    await fillProvider()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const r = jobsRow("job-1")
    const job = bullJob("job-1")
    expect(await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })).toBeNull()
    db.failUpdate = () => ({ code: "57014", message: "statement timeout" })
    const a = await admitOrPark({ job, token: "tok2", queue: "video-generation", row: row("job-1", { status: "queued" }) })
    expect(a!.leaseId).toBeNull()
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ status: "queued", lane_env: "production", lane_queued_at: new Date(NOW).toISOString() })
    await a!.release("completed")
  })

  it("a park whose requeue payload cannot be stored still parks (only a re-add after Redis lost it degrades)", async () => {
    await fillProvider()
    db.missingTables.add("lane_requeue_payloads")
    const r = jobsRow("job-1")
    const job = bullJob("job-1")
    expect(await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })).toBeNull()
    expect(r).toMatchObject({ status: "queued", lane_env: "production", lane_queued_at: new Date(NOW).toISOString() })
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1)
    expect(laneCounters().ungated).toEqual({})
  })

  it("a job with no lock token runs ungated rather than being lost", async () => {
    await fillProvider()
    jobsRow("job-1")
    const job = bullJob("job-1")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const a = await admitOrPark({ job, token: undefined, queue: "video-generation", row: row("job-1") })
    expect(a).not.toBeNull()
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(db.rows("jobs")[0]!.status).toBe("pending")
    await a!.release("completed")
  })

  it("nothing is parked with enforcement off", async () => {
    await gate.setEnforced(false)
    await fillProvider()
    jobsRow("job-1")
    const job = bullJob("job-1")
    const a = await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })
    expect(a).not.toBeNull()
    expect(a!.leaseId).toEqual(expect.any(String))
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(db.rows("jobs")[0]!.status).toBe("pending")
    expect(db.rows("lane_requeue_payloads")).toEqual([])
    await a!.release("completed")
  })
})

describe("wakeTargets", () => {
  it("wakeTargets promotes by stored id and tolerates a job that is not delayed", async () => {
    const a = bullJob("a")
    const b = bullJob("b")
    b.promote.mockRejectedValueOnce(new Error("Job bull-b is not in the delayed state. promote"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await wakeTargets([
      { jobId: "a", queue: "video-generation", bullJobId: "bull-a" },
      { jobId: "b", queue: "video-generation", bullJobId: "bull-b" },
      { jobId: "gone", queue: "video-generation", bullJobId: "bull-gone" },
      { jobId: "live-1", queue: "live", bullJobId: null },
    ])
    expect(Job.fromId).toHaveBeenCalledWith(queueOf("video-generation"), "bull-a")
    expect(Job.fromId).toHaveBeenCalledWith(queueOf("video-generation"), "bull-b")
    expect(Job.fromId).toHaveBeenCalledTimes(3) // the live target was published by the gate; nothing to promote here
    expect(a.promote).toHaveBeenCalledTimes(1)
    expect(b.promote).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it("queueOf names the BullMQ queue; live and inline have none", () => {
    expect(queueOf("video-render")).toMatchObject({ name: "video-render" })
    expect(queueOf("video-render")).toBe(queueOf("video-render"))
    expect(queueOf("live")).toBeNull()
    expect(queueOf("inline")).toBeNull()
  })

  it("a release by a running job promotes the waiter it reserved the slot for", async () => {
    const other = await fillProvider()
    jobsRow("job-1")
    const job = bullJob("job-1")
    await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })
    const targets = await gate.release(other, "completed")
    await wakeTargets(targets)
    expect(job.promote).toHaveBeenCalledTimes(1)
  })
})

describe("wakeAllWaiters", () => {
  it("turning enforcement off wakes every parked job", async () => {
    registerOffTransitionWaker(wakeAllWaiters)
    await setLanesEnforced(true, ADMIN)
    await fillProvider()
    const jobs = ["job-1", "job-2"].map((id) => {
      jobsRow(id)
      return bullJob(id)
    })
    for (const [i, job] of jobs.entries()) {
      expect(await admitOrPark({ job, token: "tok", queue: "video-generation", row: row(`job-${i + 1}`) })).toBeNull()
    }
    expect(await setLanesEnforced(false, ADMIN)).toEqual({ woke: 2, mirrored: true })
    for (const job of jobs) expect(job.promote).toHaveBeenCalledTimes(1)
    // Woken, each is admitted at once: the flag is off.
    const a = await admitOrPark({ job: jobs[0]!, token: "tok", queue: "video-generation", row: row("job-1", { status: "queued" }) })
    expect(a?.leaseId).toEqual(expect.any(String))
    await a!.release("completed")
  })

  it("never has more than WAKE_ALL_CONCURRENCY promotes in flight", async () => {
    await fillProvider()
    const ids = Array.from({ length: 60 }, (_, i) => `w${i}`)
    let inFlight = 0
    let peak = 0
    for (const id of ids) {
      const job = bullJob(id)
      job.promote.mockImplementation(async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 1))
        inFlight--
      })
      const w = await gate.acquire({
        meta: { jobId: id, userId: "U", payer: "user:U", lane: "provider", provider: "kie", source: null, sourceDetail: null, jobType: "x", model: null, queue: "video-generation", bullJobId: `bull-${id}` },
        size: 1, mode: "fresh", leaseTtlMs: 60_000,
      })
      expect(w.granted).toBe(false)
    }
    expect(await wakeAllWaiters()).toBe(60)
    expect(WAKE_ALL_CONCURRENCY).toBe(25)
    expect(peak).toBe(25)
  })

  it("is idempotent: a second wake promotes nothing and fails nothing", async () => {
    await fillProvider()
    jobsRow("job-1")
    const job = bullJob("job-1")
    await admitOrPark({ job, token: "tok", queue: "video-generation", row: row("job-1") })
    expect(await wakeAllWaiters()).toBe(1)
    job.promote.mockRejectedValue(new Error("Job bull-job-1 is not in the delayed state. promote"))
    expect(await wakeAllWaiters()).toBe(0)
  })
})

describe("startLaneParking", () => {
  it("registers the park, the wakes and the off-transition waker, and subscribes for this process's queues", async () => {
    resetWorkerAdmitHooksForTests()
    resetEnforcementHooksForTests()
    resetLaneParkingForTests()
    const stop = await startLaneParking(["video-render"])
    expect(queueOf("video-render")).not.toBeNull() // the queue connection is set
    expect(refs.subscribed).toHaveLength(1)
    expect(refs.subscribed[0]!.queues).toEqual(["video-render"])
    expect(refs.subscribed[0]!.onWake).toBe(wakeTargets)
    // The park is the not-admitted handler now.
    await fillProvider()
    jobsRow("job-1")
    expect(await admitOrPark({ job: bullJob("job-1"), token: "tok", queue: "video-generation", row: row("job-1") })).toBeNull()
    // The off-transition wakes it.
    await gate.setEnforced(true, 0)
    db.rows("app_settings").push({ key: "lanes_enforced", value: { production: true }, updated_at: "2026-10-30T09:00:00.000Z" })
    expect((await setLanesEnforced(false, ADMIN)).woke).toBe(1)
    stop()
    expect(refs.subscribed[0]!.stopped).toBe(true)
  })

  it("with no queues to subscribe it opens no subscriber", async () => {
    const stop = await startLaneParking([])
    expect(refs.subscribed).toEqual([])
    stop()
  })
})
