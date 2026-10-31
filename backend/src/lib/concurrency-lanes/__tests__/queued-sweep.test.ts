// @test-units-by-name names CreditsService only to stand in for its refund; it looks up no node unit
// The queued sweep, on the gate's JS twin, an in-memory database and an
// in-memory BullMQ: a parked row of THIS environment times out (failed, and
// refunded only when the failure write won), is promoted when its line entry
// vanished but its BullMQ entry did not, is added again from its stored
// payload when both are gone, and fails as lost when nothing is left to add
// it from. A row of another environment, or one no lane ever stamped, is never
// touched; absence is only ever read from a definitive answer, never from a
// Redis or database error. The ghost pass withdraws heads whose row ended.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate, type LaneClient } from "../gate.js"
import type { LaneEntryMeta } from "../types.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "./fake-lane-redis.js"
import { makeFakeLaneDb, type FakeLaneDb } from "./fake-lane-db.js"

type BullState = "delayed" | "waiting" | "prioritized" | "active" | "completed" | "failed"

interface FakeBullJob {
  id: string
  name: string
  data: Record<string, unknown>
  opts: Record<string, unknown>
  state: BullState
  getState: () => Promise<string>
  promote: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  db: null as unknown as { client: { from(t: string): unknown } },
  /** BullMQ entries by "<queue>/<id>". */
  bull: new Map<string, unknown>(),
  /** Every Queue.add, as [queue, name, data, opts]. */
  adds: [] as Array<[string, string, unknown, Record<string, unknown>]>,
  /** When set, every BullMQ call rejects with it. */
  bullError: null as Error | null,
  timeoutMs: 120 * 60_000,
  credits: true,
  /** Accounts quietly stopped (admin → Users). */
  quietUsers: new Set<string>(),
}))

vi.mock("bullmq", async (importOriginal) => {
  const real = await importOriginal<typeof import("bullmq")>()
  class Queue {
    constructor(readonly name: string, readonly opts: unknown) {}
    async add(name: string, data: Record<string, unknown>, opts: Record<string, unknown>) {
      if (refs.bullError) throw refs.bullError
      refs.adds.push([this.name, name, data, opts])
      const key = `${this.name}/${String(opts.jobId)}`
      // BullMQ: an add under an id that exists is a no-op.
      if (!refs.bull.has(key)) refs.bull.set(key, makeBullJob(String(opts.jobId), name, data, opts, "waiting"))
      return refs.bull.get(key)
    }
  }
  const Job = {
    fromId: vi.fn(async (queue: { name: string }, id: string) => {
      if (refs.bullError) throw refs.bullError
      return refs.bull.get(`${queue.name}/${id}`)
    }),
  }
  return { ...real, Queue, Job }
})
vi.mock("../instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../../supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))
vi.mock("../sizes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sizes.js")>()),
  laneSettings: async () => ({ queueTimeoutMs: refs.timeoutMs, liveWaitLimitMs: 10 * 60_000 }),
}))
vi.mock("../../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config.js")>()),
  hasCredits: () => refs.credits,
}))
/** A refund, as the credits service does it: a CAS on the log still being `reserved`. */
function refundLog(id: string): void {
  const log = (refs.db as unknown as { rows(t: string): Array<Record<string, unknown>> }).rows("usage_logs").find((l) => l.id === id)
  if (log && log.status === "reserved") {
    log.status = "refunded"
    log.refunds = ((log.refunds as number | undefined) ?? 0) + 1
  }
}
vi.mock("../../../workers/shared.js", () => ({
  refundJobCredits: vi.fn(async (usageLogId: string | null) => {
    if (refs.credits && usageLogId) refundLog(usageLogId)
  }),
}))
vi.mock("../../../ee/billing/credits.js", () => ({
  CreditsService: { refundCredits: vi.fn(async (id: string) => refundLog(id)) },
}))
vi.mock("../../../ee/pipelines/credits.js", () => ({ refundPipelineCredits: vi.fn(async () => undefined) }))
vi.mock("../../mcp/flows/hydrate.js", () => ({ hydrateFlowNodeForJob: async () => undefined }))
vi.mock("../../queue.js", () => ({ redis: { fake: "connection" } }))
vi.mock("../../access-blocks.js", () => ({ isUserQuietStopped: vi.fn(async (u: string | null | undefined) => !!u && refs.quietUsers.has(u)) }))

function makeBullJob(id: string, name: string, data: Record<string, unknown>, opts: Record<string, unknown>, state: BullState): FakeBullJob {
  const job: FakeBullJob = {
    id, name, data, opts, state,
    getState: async () => {
      if (refs.bullError) throw refs.bullError
      return job.state
    },
    promote: vi.fn(async () => {
      if (job.state !== "delayed") throw new Error(`Job ${id} is not in the delayed state. promote`)
      job.state = "waiting"
    }),
    remove: vi.fn(async () => {
      for (const [k, v] of refs.bull) if (v === job) refs.bull.delete(k)
    }),
  }
  return job
}

const { refundJobCredits } = await import("../../../workers/shared.js")
const { refundPipelineCredits } = await import("../../../ee/pipelines/credits.js")
const { CreditsService } = await import("../../../ee/billing/credits.js")
const { setLaneQueueConnection, resetLaneParkingForTests } = await import("../park.js")
const { resetLaneColumnsForTests, dropRequeuePayload } = await import("../columns.js")
const { resetWithdrawWakerForTests } = await import("../withdraw.js")
const sweep = await import("../queued-sweep.js")
const { sweepLaneQueuedJobs, sweepLaneGhosts, registerLaneQueueOutcomeRecorder, resetQueuedSweepForTests, setQueuedSweepTablesForTests, LANE_GHOST_AGE_MS } = sweep

const NOW = 1_800_000_000_000
const MIN = 60_000
const iso = (ms: number) => new Date(ms).toISOString()

let db: FakeLaneDb
let gate: ConcurrencyGate
let client: LaneClient

const result = () => ({ scanned: 0, swept: 0, recovered: 0, notStale: 0, errors: 0 })

const meta = (jobId: string, over: Partial<LaneEntryMeta> = {}): LaneEntryMeta => ({
  jobId, userId: "U", payer: "user:U", lane: "provider", provider: "kie", source: null, sourceDetail: null,
  jobType: "image-to-video", model: null, queue: "video-generation", bullJobId: `bull-${jobId}`, ...over,
})

/** Fill U's one provider slot, so the next acquire on that line waits. */
async function fillLine(): Promise<void> {
  const r = await gate.acquire({ meta: meta("holder"), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
  if (!r.granted) throw new Error("expected a grant")
}

/** Put a job in its line (behind the holder). */
async function enterLine(jobId: string): Promise<void> {
  const r = await gate.acquire({ meta: meta(jobId), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
  if (r.granted) throw new Error("expected a wait")
}

/** A parked job row of this environment (production, off Railway), waiting since `queuedAgoMs`. */
function parkedJob(id: string, over: Record<string, unknown> = {}, queuedAgoMs = 5 * MIN): Record<string, unknown> {
  const r = {
    id, user_id: "U", status: "queued", usage_log_id: `log-${id}`,
    lane_env: "production", lane_env_id: null, lane_queued_at: iso(NOW - queuedAgoMs),
    lane_bull_queue: "video-generation", lane_bull_job_id: `bull-${id}`, ...over,
  }
  db.rows("jobs").push(r)
  return r
}

function payload(kind: "job" | "execution" | "pipeline", rowId: string, over: Record<string, unknown> = {}): void {
  db.rows("lane_requeue_payloads").push({
    kind, row_id: rowId, bull_queue: "video-generation", bull_job_id: `bull-${rowId}`, name: "image-to-video",
    data: { jobId: rowId, userId: "U" }, opts: { priority: 3, attempts: 3 }, created_at: iso(NOW - 5 * MIN), ...over,
  })
}

function bullEntry(queue: string, id: string, data: Record<string, unknown>, state: BullState): FakeBullJob {
  const job = makeBullJob(id, "image-to-video", data, {}, state)
  refs.bull.set(`${queue}/${id}`, job)
  return job
}

beforeEach(async () => {
  db = makeFakeLaneDb()
  refs.db = db
  const store = makeFakeLaneStore()
  client = makeFakeLaneClient(store)
  // The gate's clock is the test's (faked) one: heads' last-seen times line up with the sweep's.
  gate = new ConcurrencyGate({ client: () => client, now: () => Date.now() })
  refs.gate = gate
  refs.bull.clear()
  refs.adds = []
  refs.bullError = null
  refs.timeoutMs = 120 * MIN
  refs.credits = true
  refs.quietUsers.clear()
  vi.mocked(refundJobCredits).mockClear()
  vi.mocked(refundPipelineCredits).mockClear()
  vi.mocked(CreditsService.refundCredits).mockReset().mockImplementation(async (logId: string) => refundLog(logId))
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  vi.stubEnv("RUNTIME_ENV", "production")
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "")
  resetLaneParkingForTests()
  resetLaneColumnsForTests()
  resetWithdrawWakerForTests()
  resetQueuedSweepForTests()
  setLaneQueueConnection({ fake: "connection" })
  await gate.setEnforced(true)
  await fillLine()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("sweepLaneQueuedJobs — a quietly stopped account", () => {
  it("its waiting job is never timed out, refunded, promoted or re-added; released, it is swept again", async () => {
    refs.quietUsers.add("U")
    // Past the timeout, out of its line, its parked entry delayed: every branch would act on it.
    const late = parkedJob("job-1", {}, 300 * MIN)
    const parked = bullEntry("video-generation", "bull-job-1", { jobId: "job-1" }, "delayed")
    // Lost entirely, with a payload to add it again from.
    parkedJob("job-2")
    payload("job", "job-2")
    const res = result()

    await sweepLaneQueuedJobs(res)

    expect(late.status).toBe("queued")
    expect(refundJobCredits).not.toHaveBeenCalled()
    expect(parked.promote).not.toHaveBeenCalled()
    expect(parked.remove).not.toHaveBeenCalled()
    expect(refs.adds).toEqual([])
    expect(res).toMatchObject({ swept: 0, recovered: 0, notStale: 2 })

    refs.quietUsers.clear()
    await sweepLaneQueuedJobs(result())
    expect(late.status).toBe("failed")
  })
})

describe("sweepLaneQueuedJobs — what it reads", () => {
  it("reads only jobs: nothing parks executions or pipelines yet", async () => {
    db.rows("workflow_executions").push({ id: "exec-1", user_id: "U", status: "pending", lane_env: "production", lane_env_id: null, lane_queued_at: iso(NOW - 130 * MIN) })
    db.rows("pipelines").push({ id: "pipe-1", user_id: "U", status: "queued", lane_env: "production", lane_env_id: null, lane_queued_at: iso(NOW - 130 * MIN) })
    await sweepLaneQueuedJobs(result())
    expect(db.selects.filter((q) => q.startsWith("workflow_executions:") || q.startsWith("pipelines:"))).toEqual([])
    expect(db.rows("workflow_executions")[0]!.status).toBe("pending")
    expect(db.rows("pipelines")[0]!.status).toBe("queued")
  })
})

describe("sweepLaneQueuedJobs — the queue timeout", () => {
  it("fails and refunds a job queued longer than the timeout", async () => {
    await enterLine("job-1")
    const r = parkedJob("job-1", {}, 121 * MIN)
    const parked = bullEntry("video-generation", "bull-job-1", { jobId: "job-1" }, "delayed")
    payload("job", "job-1")
    const recorded: unknown[] = []
    registerLaneQueueOutcomeRecorder((e) => recorded.push(e))
    const res = result()

    await sweepLaneQueuedJobs(res)

    expect(r).toMatchObject({
      status: "failed",
      error_message: "Waited longer than 120 min for a free slot.",
      error_hint: { kind: "queue-timeout", reason: "timeout", waitedMinutes: 121 },
    })
    expect(refundJobCredits).toHaveBeenCalledTimes(1)
    const [logId, jobId, err] = vi.mocked(refundJobCredits).mock.calls[0]!
    expect([logId, jobId]).toEqual(["log-job-1", "job-1"])
    expect((err as Error).name).toBe("LaneWaitTimeoutError")
    expect((err as { failureHint: unknown }).failureHint).toEqual({ kind: "queue-timeout", reason: "timeout", waitedMinutes: 121 })
    // It left its line, its parked entry was removed, its payload deleted.
    expect(await gate.describeWait("job-1")).toBeNull()
    expect(parked.remove).toHaveBeenCalledTimes(1)
    expect(db.rows("lane_requeue_payloads")).toEqual([])
    expect(recorded).toEqual([{ table: "jobs", rowId: "job-1", userId: "U", reason: "timeout", waitedMs: 121 * MIN }])
    expect(res.swept).toBe(1)
  })

  it("refunds only when the failure write won", async () => {
    await enterLine("job-1")
    const r = parkedJob("job-1", {}, 121 * MIN)
    db.rows("usage_logs").push({ id: "log-job-1", job_id: "job-1", status: "reserved" }, { id: "log-addon", job_id: "job-1", status: "reserved" })
    // A worker admits the job between the sweep's read and its write.
    db.beforeUpdate = (table) => {
      if (table === "jobs" && r.status === "queued") r.status = "processing"
    }
    const recorded: unknown[] = []
    registerLaneQueueOutcomeRecorder((e) => recorded.push(e))

    await sweepLaneQueuedJobs(result())

    expect(r.status).toBe("processing")
    expect(r.error_message).toBeUndefined()
    expect(refundJobCredits).not.toHaveBeenCalled()
    expect(db.rows("usage_logs").map((l) => l.status)).toEqual(["reserved", "reserved"])
    expect(recorded).toEqual([])
  })

  it("a timed-out job with two reserved logs refunds both", async () => {
    parkedJob("job-1", {}, 121 * MIN)
    db.rows("usage_logs").push(
      { id: "log-job-1", job_id: "job-1", status: "reserved" },
      { id: "log-addon", job_id: "job-1", status: "reserved" },
      { id: "log-other", job_id: "job-other", status: "reserved" },
    )

    await sweepLaneQueuedJobs(result())

    expect(db.rows("usage_logs")).toEqual([
      { id: "log-job-1", job_id: "job-1", status: "refunded", refunds: 1 },
      { id: "log-addon", job_id: "job-1", status: "refunded", refunds: 1 },
      { id: "log-other", job_id: "job-other", status: "reserved" },
    ])
  })

  it("a refund that throws, or cannot be confirmed, still removes the parked entry, the payload and counts the job", async () => {
    await enterLine("job-1")
    parkedJob("job-1", {}, 121 * MIN)
    const parked = bullEntry("video-generation", "bull-job-1", { jobId: "job-1" }, "delayed")
    payload("job", "job-1")
    db.rows("usage_logs").push({ id: "log-addon", job_id: "job-1", status: "reserved" })
    vi.mocked(refundJobCredits).mockRejectedValueOnce(new Error("refund down"))
    vi.mocked(CreditsService.refundCredits).mockImplementation(async () => undefined) // never refunds
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const recorded: unknown[] = []
    registerLaneQueueOutcomeRecorder((e) => recorded.push(e))
    const res = result()

    await sweepLaneQueuedJobs(res)

    expect(db.rows("jobs")[0]!.status).toBe("failed")
    expect(parked.remove).toHaveBeenCalledTimes(1)
    expect(db.rows("lane_requeue_payloads")).toEqual([])
    expect(recorded).toHaveLength(1)
    expect(res.swept).toBe(1)
    // The throw, and the hold that could not be confirmed refunded.
    expect(res.errors).toBe(2)
  })

  it("leaves a job inside the timeout alone", async () => {
    await enterLine("job-1")
    const r = parkedJob("job-1", {}, 119 * MIN)
    const parked = bullEntry("video-generation", "bull-job-1", { jobId: "job-1" }, "delayed")
    const res = result()

    await sweepLaneQueuedJobs(res)

    expect(r.status).toBe("queued")
    expect(refundJobCredits).not.toHaveBeenCalled()
    expect(parked.promote).not.toHaveBeenCalled()
    expect(refs.adds).toEqual([])
    expect(await gate.describeWait("job-1")).not.toBeNull()
    expect(res).toMatchObject({ scanned: 1, notStale: 1, swept: 0, recovered: 0 })
  })

  it("the timeout counts from lane_queued_at after a Redis restart", async () => {
    // Redis lost the line and the BullMQ entry; the payload would re-add the job,
    // but it has waited past the timeout: it fails instead of starting the clock over.
    const r = parkedJob("job-1", {}, 125 * MIN)
    payload("job", "job-1")

    await sweepLaneQueuedJobs(result())

    expect(r).toMatchObject({ status: "failed", error_hint: { kind: "queue-timeout", reason: "timeout", waitedMinutes: 125 } })
    expect(refs.adds).toEqual([])
    expect(refundJobCredits).toHaveBeenCalledTimes(1)
  })

  it("the message names the timeout setting, not the minutes waited", async () => {
    refs.timeoutMs = 30 * MIN
    const r = parkedJob("job-1", {}, 47 * MIN)
    await sweepLaneQueuedJobs(result())
    expect(r).toMatchObject({ error_message: "Waited longer than 30 min for a free slot.", error_hint: { waitedMinutes: 47 } })
  })
})

describe("sweepLaneQueuedJobs — the owning environment only", () => {
  it("a sweep never touches a queued row of another environment", async () => {
    const staging = parkedJob("job-staging", { lane_env: "staging" }, 200 * MIN)
    const railway = parkedJob("job-railway", { lane_env_id: "env-prod-railway" }, 200 * MIN)
    payload("job", "job-staging")
    const res = result()

    // This process is "production" off Railway: neither row is its own.
    await sweepLaneQueuedJobs(res)
    expect(staging.status).toBe("queued")
    expect(railway.status).toBe("queued")

    // A Railway process of production only owns rows stamped with its own environment id.
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "env-other")
    await sweepLaneQueuedJobs(res)
    expect(railway.status).toBe("queued")

    expect(refs.adds).toEqual([])
    expect(refundJobCredits).not.toHaveBeenCalled()
    expect(res.scanned).toBe(0)

    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "env-prod-railway")
    await sweepLaneQueuedJobs(res)
    expect(railway.status).toBe("failed")
    expect(staging.status).toBe("queued")
  })

  it("an unstamped legacy queued row is never touched", async () => {
    const legacy = parkedJob("job-legacy", { lane_env: null, lane_env_id: null, lane_queued_at: null, lane_bull_queue: null, lane_bull_job_id: null }, 0)
    const legacyRun = { id: "pipe-legacy", user_id: "U", status: "queued", lane_env: null, lane_env_id: null, lane_queued_at: null }
    db.rows("pipelines").push(legacyRun)
    const legacyExec = { id: "exec-legacy", user_id: "U", status: "pending", lane_env: null, lane_env_id: null, lane_queued_at: null }
    db.rows("workflow_executions").push(legacyExec)
    vi.setSystemTime(NOW + 1000 * MIN)

    const res = result()
    await sweepLaneQueuedJobs(res)

    expect(legacy.status).toBe("queued")
    expect(legacyRun.status).toBe("queued")
    expect(legacyExec.status).toBe("pending")
    expect(refs.adds).toEqual([])
    expect(res.scanned).toBe(0)
  })

  it("the sweep does nothing while the lane columns are absent", async () => {
    parkedJob("job-1", {}, 200 * MIN)
    for (const t of ["jobs", "workflow_executions", "pipelines"]) db.missingColumns.add(`${t}.lane_env`)
    db.missingTables.add("lane_requeue_payloads")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const res = result()

    await sweepLaneQueuedJobs(res)
    await sweepLaneQueuedJobs(res)

    expect(db.rows("jobs")[0]!.status).toBe("queued")
    expect(refs.adds).toEqual([])
    expect(res).toEqual(result())
    expect(warn).not.toHaveBeenCalled()
    // Absence is remembered: one probe per table per process.
    expect(db.selects.filter((s) => s.startsWith("jobs:"))).toHaveLength(1)
  })

  it("with enforcement off and nothing parked the sweep changes nothing", async () => {
    await gate.setEnforced(false)
    db.rows("jobs").push({ id: "job-p", user_id: "U", status: "pending", lane_env: null, lane_queued_at: null })
    const res = result()
    await sweepLaneQueuedJobs(res)
    expect(db.rows("jobs")[0]!.status).toBe("pending")
    expect(res).toEqual(result())
    expect(refs.adds).toEqual([])
  })
})

describe("sweepLaneQueuedJobs — lost entries", () => {
  it("a queued row whose lane entry vanished but whose BullMQ entry exists is promoted, not re-added", async () => {
    const r = parkedJob("job-1")
    const parked = bullEntry("video-generation", "bull-job-1", { jobId: "job-1" }, "delayed")
    payload("job", "job-1")
    const res = result()

    await sweepLaneQueuedJobs(res)

    expect(parked.promote).toHaveBeenCalledTimes(1)
    expect(refs.adds).toEqual([])
    expect(r.status).toBe("queued")
    expect(res.recovered).toBe(1)
  })

  it("a BullMQ entry already waiting or running is left as it is", async () => {
    const r = parkedJob("job-1")
    const entry = bullEntry("video-generation", "bull-job-1", { jobId: "job-1" }, "active")
    payload("job", "job-1")
    await sweepLaneQueuedJobs(result())
    expect(entry.promote).not.toHaveBeenCalled()
    expect(refs.adds).toEqual([])
    expect(r.status).toBe("queued")
  })

  it("a server-busy waiter is not promoted by the sweep", async () => {
    const r = parkedJob("job-1")
    await gate.markServerWait({ ...meta("job-1"), pool: "video" })
    const parked = bullEntry("video-generation", "bull-job-1", { jobId: "job-1" }, "delayed")

    await sweepLaneQueuedJobs(result())

    expect(parked.promote).not.toHaveBeenCalled()
    expect(refs.adds).toEqual([])
    expect(r.status).toBe("queued")
  })

  it("a queued row with neither lane entry nor BullMQ entry is re-added once under lane-readd-<id> and a second sweep adds nothing", async () => {
    const r = parkedJob("job-1")
    payload("job", "job-1")

    await sweepLaneQueuedJobs(result())
    expect(refs.adds).toEqual([[
      "video-generation", "image-to-video", { jobId: "job-1", userId: "U" }, { priority: 3, attempts: 3, jobId: "lane-readd-job-1" },
    ]])

    // The re-added entry has not been picked up yet: the second pass finds it and adds nothing.
    await sweepLaneQueuedJobs(result())
    expect(refs.adds).toHaveLength(1)
    expect(r.status).toBe("queued")
    expect(refundJobCredits).not.toHaveBeenCalled()
  })

  it("a stamped BullMQ entry that ended or carries another job counts as gone", async () => {
    parkedJob("job-1")
    bullEntry("video-generation", "bull-job-1", { jobId: "job-1" }, "completed")
    parkedJob("job-2")
    bullEntry("video-generation", "bull-job-2", { jobId: "someone-else" }, "delayed")
    payload("job", "job-1")
    payload("job", "job-2")

    await sweepLaneQueuedJobs(result())

    expect(refs.adds.map((a) => a[3].jobId).sort()).toEqual(["lane-readd-job-1", "lane-readd-job-2"])
  })

  it("a queued row with neither and no stored payload fails as lost and is refunded", async () => {
    const r = parkedJob("job-1", {}, 40 * MIN)
    const recorded: unknown[] = []
    registerLaneQueueOutcomeRecorder((e) => recorded.push(e))

    await sweepLaneQueuedJobs(result())

    expect(r).toMatchObject({
      status: "failed",
      error_message: "This job lost its place in line and did not run. Your credits were refunded — please run it again.",
      error_hint: { kind: "queue-timeout", reason: "lost", waitedMinutes: 40 },
    })
    expect(refundJobCredits).toHaveBeenCalledTimes(1)
    expect((vi.mocked(refundJobCredits).mock.calls[0]![2] as { failureHint: unknown }).failureHint)
      .toEqual({ kind: "queue-timeout", reason: "lost", waitedMinutes: 40 })
    expect(recorded).toEqual([{ table: "jobs", rowId: "job-1", userId: "U", reason: "lost", waitedMs: 40 * MIN }])
  })

  it("a lost job refunds every reserved log", async () => {
    parkedJob("job-1")
    db.rows("usage_logs").push(
      { id: "log-job-1", job_id: "job-1", status: "reserved" },
      { id: "log-addon", job_id: "job-1", status: "reserved" },
      { id: "log-spent", job_id: "job-1", status: "committed" },
    )

    await sweepLaneQueuedJobs(result())

    expect(db.rows("jobs")[0]!.error_hint).toMatchObject({ reason: "lost" })
    expect(db.rows("usage_logs").map((l) => [l.id, l.status, l.refunds])).toEqual([
      ["log-job-1", "refunded", 1], ["log-addon", "refunded", 1], ["log-spent", "committed", undefined],
    ])
  })

  it("no per-job refund sweep outside Cloud", async () => {
    refs.credits = false
    parkedJob("job-1", {}, 121 * MIN)
    db.rows("usage_logs").push({ id: "log-addon", job_id: "job-1", status: "reserved" })
    await sweepLaneQueuedJobs(result())
    expect(db.rows("usage_logs")[0]!.status).toBe("reserved")
  })

  it("a Redis that does not answer is never read as a lost entry", async () => {
    const r = parkedJob("job-1")
    // The gate's Redis fails: no line verdict, so no BullMQ, payload or failure step either.
    client = { eval: async () => { throw new Error("ECONNREFUSED") }, publish: async () => 0 } as unknown as LaneClient
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const res = result()

    await sweepLaneQueuedJobs(res)

    expect(r.status).toBe("queued")
    expect(refs.adds).toEqual([])
    expect(refundJobCredits).not.toHaveBeenCalled()
    expect(res.errors).toBeGreaterThan(0)
    warn.mockRestore()
  })

  it("a BullMQ lookup that fails is never read as a lost entry", async () => {
    const r = parkedJob("job-1")
    refs.bullError = new Error("BullMQ unavailable")
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await sweepLaneQueuedJobs(result())

    expect(r.status).toBe("queued")
    expect(refs.adds).toEqual([])
    expect(refundJobCredits).not.toHaveBeenCalled()
  })

  it("a payload read that fails is never read as no payload", async () => {
    const r = parkedJob("job-1")
    db.failing.add("lane_requeue_payloads")
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await sweepLaneQueuedJobs(result())

    expect(r.status).toBe("queued")
    expect(refundJobCredits).not.toHaveBeenCalled()
  })

  it("without a BullMQ connection nothing is judged lost", async () => {
    resetLaneParkingForTests()
    const r = parkedJob("job-1")
    payload("job", "job-1")
    await sweepLaneQueuedJobs(result())
    expect(r.status).toBe("queued")
    expect(refs.adds).toEqual([])
  })
})

describe("sweepLaneQueuedJobs — runs and pipelines", () => {
  // Ready for when the run lane parks them; not read in production until then.
  beforeEach(() => setQueuedSweepTablesForTests(["jobs", "workflow_executions", "pipelines"]))

  function parkedRun(table: "workflow_executions" | "pipelines", id: string, queuedAgoMs = 5 * MIN): Record<string, unknown> {
    const r = {
      id, user_id: "U", status: table === "pipelines" ? "queued" : "pending",
      lane_env: "production", lane_env_id: null, lane_queued_at: iso(NOW - queuedAgoMs),
    }
    db.rows(table).push(r)
    return r
  }

  it("a lost execution is re-added under its own execution id and a lost pipeline under pipeline-<id>", async () => {
    parkedRun("workflow_executions", "exec-1")
    payload("execution", "exec-1", { bull_queue: "workflow-orchestration", bull_job_id: "exec-1", name: "workflow-execution", data: { executionId: "exec-1" }, opts: {} })
    parkedRun("pipelines", "pipe-1")
    payload("pipeline", "pipe-1", { bull_queue: "pipeline-orchestration", bull_job_id: "pipeline-pipe-1", name: "run", data: { pipelineId: "pipe-1" }, opts: { attempts: 1, removeOnComplete: true, removeOnFail: true } })

    await sweepLaneQueuedJobs(result())
    await sweepLaneQueuedJobs(result())

    expect(refs.adds).toEqual([
      ["workflow-orchestration", "workflow-execution", { executionId: "exec-1" }, { jobId: "exec-1" }],
      ["pipeline-orchestration", "run", { pipelineId: "pipe-1" }, { attempts: 1, removeOnComplete: true, removeOnFail: true, jobId: "pipeline-pipe-1" }],
    ])
  })

  it("a parked execution whose BullMQ entry is delayed is promoted", async () => {
    parkedRun("workflow_executions", "exec-1")
    payload("execution", "exec-1", { bull_queue: "workflow-orchestration", bull_job_id: "exec-1", name: "workflow-execution", data: {}, opts: {} })
    const entry = bullEntry("workflow-orchestration", "exec-1", { executionId: "exec-1" }, "delayed")
    await sweepLaneQueuedJobs(result())
    expect(entry.promote).toHaveBeenCalledTimes(1)
    expect(refs.adds).toEqual([])
  })

  it("an execution or pipeline past the timeout fails through its own path with the same message", async () => {
    const exec = parkedRun("workflow_executions", "exec-1", 130 * MIN)
    const pipe = parkedRun("pipelines", "pipe-1", 130 * MIN)

    await sweepLaneQueuedJobs(result())

    expect(exec).toMatchObject({ status: "failed", error_message: "Waited longer than 120 min for a free slot." })
    expect(typeof exec.completed_at).toBe("string")
    expect(pipe).toMatchObject({ status: "failed", failure_reason: "queue_timeout" })
    expect(refundPipelineCredits).toHaveBeenCalledWith(expect.objectContaining({ pipelineId: "pipe-1", userId: "U", reason: "queue_timeout" }))
    expect(refundJobCredits).not.toHaveBeenCalled()
  })

  it("a lost run with no payload fails as lost", async () => {
    const exec = parkedRun("workflow_executions", "exec-1")
    const pipe = parkedRun("pipelines", "pipe-1")
    await sweepLaneQueuedJobs(result())
    expect(exec).toMatchObject({ status: "failed", error_message: "This job lost its place in line and did not run. Your credits were refunded — please run it again." })
    expect(pipe).toMatchObject({ status: "failed", failure_reason: "queue_lost" })
  })

  it("a run that started meanwhile is not failed", async () => {
    const exec = parkedRun("workflow_executions", "exec-1", 130 * MIN)
    const pipe = parkedRun("pipelines", "pipe-1", 130 * MIN)
    db.beforeUpdate = () => {
      exec.status = "running"
      pipe.status = "running"
    }
    await sweepLaneQueuedJobs(result())
    expect(exec.status).toBe("running")
    expect(exec.error_message).toBeUndefined()
    expect(pipe.status).toBe("running")
    expect(refundPipelineCredits).not.toHaveBeenCalled()
  })

  it("a pipeline with no owner on its row is failed but not refunded", async () => {
    const pipe = parkedRun("pipelines", "pipe-1", 130 * MIN)
    pipe.user_id = null
    await sweepLaneQueuedJobs(result())
    expect(pipe.status).toBe("failed")
    expect(refundPipelineCredits).not.toHaveBeenCalled()
  })

  it("no pipeline refund outside Cloud", async () => {
    refs.credits = false
    parkedRun("pipelines", "pipe-1", 130 * MIN)
    await sweepLaneQueuedJobs(result())
    expect(refundPipelineCredits).not.toHaveBeenCalled()
  })
})

describe("the requeue payloads' lifecycle", () => {
  it("a payload is deleted when its job is admitted", async () => {
    payload("job", "job-1")
    payload("execution", "job-1")
    await dropRequeuePayload("job-1")
    expect(db.rows("lane_requeue_payloads").map((p) => p.kind)).toEqual(["execution"])
  })

  it("deleting a payload tolerates the table being absent", async () => {
    db.missingTables.add("lane_requeue_payloads")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await expect(dropRequeuePayload("job-1")).resolves.toBeUndefined()
    await expect(dropRequeuePayload("job-2")).resolves.toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it("the sweep deletes payloads whose job, run or pipeline ended or is gone, and keeps the rest", async () => {
    db.rows("jobs").push({ id: "job-done", status: "completed" }, { id: "job-waiting", status: "queued", lane_env: "staging" }, { id: "job-running", status: "processing" })
    db.rows("workflow_executions").push({ id: "exec-done", status: "cancelled" }, { id: "exec-waiting", status: "pending" })
    db.rows("pipelines").push({ id: "pipe-done", status: "failed" }, { id: "pipe-waiting", status: "queued" })
    for (const id of ["job-done", "job-waiting", "job-running", "job-deleted"]) payload("job", id)
    for (const id of ["exec-done", "exec-waiting"]) payload("execution", id)
    for (const id of ["pipe-done", "pipe-waiting", "pipe-deleted"]) payload("pipeline", id)

    await sweepLaneQueuedJobs(result())

    expect(db.rows("lane_requeue_payloads").map((p) => `${p.kind}:${p.row_id}`).sort())
      .toEqual(["execution:exec-waiting", "job:job-running", "job:job-waiting", "pipeline:pipe-waiting"])
  })

  it("more than 200 pending payloads are read and deleted in lists of at most 200", async () => {
    db.maxInList = 200
    const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    for (let i = 0; i < 450; i++) {
      // Every third job still waits; the rest ended.
      db.rows("jobs").push({ id: id(i), status: i % 3 === 0 ? "queued" : "completed" })
      payload("job", id(i), { created_at: iso(NOW - 10 * MIN + i) })
    }

    await sweepLaneQueuedJobs(result())

    expect(db.rows("lane_requeue_payloads")).toHaveLength(150)
    expect(db.rows("lane_requeue_payloads").every((p) => Number((p.row_id as string).slice(-12)) % 3 === 0)).toBe(true)
    expect(Math.max(...db.inLengths)).toBeLessThanOrEqual(200)
  })

  it("an owner read that fails keeps the payload", async () => {
    payload("job", "job-x")
    db.failing.add("jobs")
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await sweepLaneQueuedJobs(result())
    expect(db.rows("lane_requeue_payloads")).toHaveLength(1)
  })
})

describe("sweepLaneGhosts", () => {
  it("a ghost head whose row ended is withdrawn", async () => {
    await enterLine("00000000-0000-4000-8000-0000000000e1")
    db.rows("jobs").push({ id: "00000000-0000-4000-8000-0000000000e1", status: "cancelled" })
    vi.setSystemTime(NOW + LANE_GHOST_AGE_MS + 1)
    const res = result()

    await sweepLaneGhosts(res)

    expect(await gate.describeWait("00000000-0000-4000-8000-0000000000e1")).toBeNull()
    expect(res.swept).toBe(1)
  })

  it("a head whose row is gone is withdrawn", async () => {
    await enterLine("00000000-0000-4000-8000-0000000000e2")
    vi.setSystemTime(NOW + LANE_GHOST_AGE_MS + 1)
    await sweepLaneGhosts(result())
    expect(await gate.describeWait("00000000-0000-4000-8000-0000000000e2")).toBeNull()
  })

  it("a stale head whose row still waits stays", async () => {
    await enterLine("00000000-0000-4000-8000-0000000000e3")
    db.rows("jobs").push({ id: "00000000-0000-4000-8000-0000000000e3", status: "queued" })
    vi.setSystemTime(NOW + LANE_GHOST_AGE_MS + 1)
    await sweepLaneGhosts(result())
    expect(await gate.describeWait("00000000-0000-4000-8000-0000000000e3")).not.toBeNull()
  })

  it("a head seen recently is not read at all", async () => {
    await enterLine("00000000-0000-4000-8000-0000000000e1")
    db.rows("jobs").push({ id: "00000000-0000-4000-8000-0000000000e1", status: "cancelled" })
    vi.setSystemTime(NOW + LANE_GHOST_AGE_MS - 1)
    await sweepLaneGhosts(result())
    expect(await gate.describeWait("00000000-0000-4000-8000-0000000000e1")).not.toBeNull()
    expect(db.selects.filter((s) => s.startsWith("jobs:"))).toEqual([])
  })

  it("a row read that fails keeps the head", async () => {
    await enterLine("00000000-0000-4000-8000-0000000000e4")
    db.failing.add("jobs")
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.setSystemTime(NOW + LANE_GHOST_AGE_MS + 1)
    const res = result()
    await sweepLaneGhosts(res)
    expect(await gate.describeWait("00000000-0000-4000-8000-0000000000e4")).not.toBeNull()
    expect(res.errors).toBe(1)
  })

  it("an inline call's head is read through its owner job: withdrawn once stale, kept while it re-checks", async () => {
    // A waiting inline call re-acquires every few seconds, which refreshes its
    // last-seen time; one not seen for the ghost age outlived its process.
    const owner = "00000000-0000-4000-8000-0000000000f1"
    const entry = `${owner}:call:abc`
    db.rows("jobs").push({ id: owner, status: "processing" })
    const r = await gate.acquire({ meta: meta(entry, { queue: "inline", bullJobId: null }), size: 1, mode: "front", leaseTtlMs: 3_600_000 })
    expect(r.granted).toBe(false)

    vi.setSystemTime(NOW + LANE_GHOST_AGE_MS - 1)
    await sweepLaneGhosts(result())
    expect(await gate.describeWait(entry)).not.toBeNull()

    vi.setSystemTime(NOW + LANE_GHOST_AGE_MS + 1)
    await sweepLaneGhosts(result())
    expect(await gate.describeWait(entry)).toBeNull()
  })

  it("a run's head is read from its own table", async () => {
    await gate.acquire({ meta: meta("exec-1", { lane: "run", queue: "workflow-orchestration", provider: null }), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
    await gate.acquire({ meta: meta("00000000-0000-4000-8000-0000000000e5", { lane: "run", queue: "workflow-orchestration", provider: null }), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
    db.rows("workflow_executions").push({ id: "00000000-0000-4000-8000-0000000000e5", status: "completed" })
    vi.setSystemTime(NOW + LANE_GHOST_AGE_MS + 1)
    await sweepLaneGhosts(result())
    expect(await gate.describeWait("00000000-0000-4000-8000-0000000000e5")).toBeNull()
  })
})
