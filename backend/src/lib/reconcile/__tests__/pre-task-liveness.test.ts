/**
 * A long private-plugin run against the REAL reconcile cron.
 *
 * Staging 2026-09-15: Pro 3D Render job 99ede351 (the 30-second round-table
 * fixture) started 18:18:44Z and was failed at 18:50:00Z with "Reconciliation
 * could not recover this job. Please re-run." — the pickup `pre-task` stamp was
 * 31 minutes old and nothing on the Pro lane refreshed it, although the one
 * container that ran the job was alive throughout.
 *
 * Everything here is real except storage: the cron, its staleness decision,
 * the heartbeat wrapper and the CAS refresh run against an in-memory `jobs`
 * table. The sweep itself is a spy that fails the row, so the assertions read
 * the outcome a user would see. The pickup stamp is written the way the video
 * worker writes it (pinned in `video-worker.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Row = Record<string, unknown> & { id: string }

const db = vi.hoisted(() => ({ jobs: [] as Array<Record<string, unknown> & { id: string }> }))

vi.mock("../../supabase.js", () => {
  const read = (row: Record<string, unknown>, column: string): unknown => {
    const [base, key] = column.split("->>")
    const value = row[base!]
    return key === undefined ? value : (value as Record<string, unknown> | null)?.[key]
  }
  const query = (table: string) => {
    const rows = table === "jobs" ? db.jobs : []
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    let patch: Record<string, unknown> | undefined
    const run = () => {
      const matched = rows.filter((row) => filters.every((keep) => keep(row)))
      if (patch) for (const row of matched) Object.assign(row, patch)
      return { data: matched.map((row) => (patch ? { id: row.id } : { ...row })), error: null }
    }
    const chain: Record<string, unknown> = {
      select: () => (patch ? Promise.resolve(run()) : chain),
      update: (values: Record<string, unknown>) => { patch = values; return chain },
      eq: (column: string, value: unknown) => { filters.push((row) => read(row, column) === value); return chain },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(read(row, column))); return chain },
      is: (column: string) => { filters.push((row) => read(row, column) == null); return chain },
      not: (column: string) => { filters.push((row) => read(row, column) != null); return chain },
      lt: (column: string, value: string) => {
        filters.push((row) => typeof read(row, column) === "string" && (read(row, column) as string) < value)
        return chain
      },
      filter: () => chain,
      limit: () => Promise.resolve(run()),
      maybeSingle: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    }
    return chain
  }
  return { supabase: { from: (table: string) => query(table) } }
})

vi.mock("../../queue.js", () => ({ videoQueue: { getJobs: vi.fn(async () => []), add: vi.fn() } }))
// R38's cancelled-hold pass has its own suite (cancelled-metered-holds.test.ts).
vi.mock("../cancelled-metered-holds.js", () => ({ sweepCancelledMeteredHolds: vi.fn(async () => {}) }))
vi.mock("../hold-expiry.js", () => ({ sweepExpiredHolds: vi.fn(async () => ({ expired: 0, errors: 0 })) }))
vi.mock("../sync-sweep.js", () => ({
  sweepStaleSyncJob: vi.fn(async (job: { id: string }) => {
    const row = db.jobs.find((candidate) => candidate.id === job.id)
    if (row && (row.status === "pending" || row.status === "processing")) {
      Object.assign(row, { status: "failed", error_message: "Reconciliation could not recover this job. Please re-run." })
    }
  }),
}))

import { reconcileInflightJobs } from "../cron.js"
import { sweepStaleSyncJob } from "../sync-sweep.js"
import { STALE_THRESHOLD_MS } from "../types.js"
import { PRE_TASK_HEARTBEAT_MAX_MS, withPreTaskHeartbeat } from "../../../workers/pre-task-heartbeat.js"
import { DrainAbortError } from "../../worker-drain.js"

const MIN = 60_000
const CRON_CADENCE_MS = 5 * MIN
const T0 = new Date("2026-09-15T18:18:44Z").getTime()
const iso = () => new Date().toISOString()
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

function insertJob(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: "99ede351-c7c5-4ad2-a5e4-f41e7cbeacd8",
    status: "pending",
    job_type: "pro-3d-render",
    input_data: { type: "pro-3d-render" },
    provider: null,
    provider_kind: null,
    provider_task_id: null,
    provider_call_started_at: null,
    reconcile_attempts: 0,
    finalize_claimed_at: null,
    created_at: iso(),
    started_at: null,
    ...overrides,
  }
  db.jobs.push(row)
  return row
}

/** The video worker's pickup CAS, field for field (`video-worker.ts`). */
function pickUp(row: Row): void {
  Object.assign(row, { status: "processing", started_at: iso(), provider_call_started_at: iso(), provider_kind: "pre-task" })
}

/** Advance the clock to `minutesAfterT0`, running a cron tick on every 5-minute boundary on the way. */
async function runCronUntil(minutesAfterT0: number): Promise<void> {
  const target = T0 + minutesAfterT0 * MIN
  for (;;) {
    const nextTick = (Math.floor((Date.now() - T0) / CRON_CADENCE_MS) + 1) * CRON_CADENCE_MS + T0
    if (nextTick > target) break
    await vi.advanceTimersByTimeAsync(nextTick - Date.now())
    await reconcileInflightJobs()
  }
  if (target > Date.now()) await vi.advanceTimersByTimeAsync(target - Date.now())
}

beforeEach(() => {
  db.jobs.length = 0
  vi.mocked(sweepStaleSyncJob).mockClear()
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

describe("a Pro 3D Render run past the pre-task threshold", () => {
  it("is never swept while its worker is alive — 35 minutes, seven cron ticks", async () => {
    const row = insertJob()
    pickUp(row)
    const run = withPreTaskHeartbeat(async () => { await sleep(35 * MIN) })({}, { jobId: row.id })

    await runCronUntil(35)
    await run

    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    expect(row.status).toBe("processing")
    expect(Date.now() - new Date(row.provider_call_started_at as string).getTime()).toBeLessThanOrEqual(MIN)
  })

  it("control — the same run WITHOUT the heartbeat is failed at the first tick past 30 minutes (the staging outcome)", async () => {
    const row = insertJob()
    pickUp(row)

    await runCronUntil(30)
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    await runCronUntil(35)
    expect(sweepStaleSyncJob).toHaveBeenCalledTimes(1)
    expect(row.status).toBe("failed")
  })

  it("still goes stale and is swept once its worker dies: 30 minutes after the last beat, not before", async () => {
    const row = insertJob()
    pickUp(row)
    void withPreTaskHeartbeat(async () => { await sleep(60 * MIN) })({}, { jobId: row.id })

    await runCronUntil(10)
    // The process is gone: no handler, no beats. `clearAllTimers` also rewinds the
    // fake clock to its install time, so put the clock back where the death happened.
    const diedAt = Date.now()
    vi.clearAllTimers()
    vi.setSystemTime(diedAt)
    const lastBeat = new Date(row.provider_call_started_at as string).getTime()
    expect(lastBeat).toBe(T0 + 10 * MIN)

    await runCronUntil(40) // exactly 30 min since the last beat — not yet stale
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    await runCronUntil(45)
    expect(sweepStaleSyncJob).toHaveBeenCalledTimes(1)
    expect(row.status).toBe("failed")
  })

  it("a handler that never settles stops being kept alive at the cap and is swept one threshold later", async () => {
    const row = insertJob()
    pickUp(row)
    void withPreTaskHeartbeat(() => new Promise<void>(() => {}))({}, { jobId: row.id })

    await runCronUntil(PRE_TASK_HEARTBEAT_MAX_MS / MIN)
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()

    await runCronUntil((PRE_TASK_HEARTBEAT_MAX_MS + STALE_THRESHOLD_MS["pre-task"]) / MIN + 5)
    expect(sweepStaleSyncJob).toHaveBeenCalledTimes(1)
  })
})

describe("the deploy-drain hand-off (app PR #1436)", () => {
  const DRAIN_REQUEUE_DELAY_MS = 2_000 // video-worker.ts; pinned against the budget in video-worker.test.ts

  async function handOffAtMinute(row: Row, minute: number): Promise<void> {
    const first = withPreTaskHeartbeat(async () => {
      await sleep(minute * MIN)
      throw new DrainAbortError()
    })({}, { jobId: row.id }).catch((error: unknown) => error)
    await runCronUntil(minute)
    expect(await first).toBeInstanceOf(DrainAbortError)
  }

  it("a job handed back at minute 28 and re-picked seconds later is never swept", async () => {
    const row = insertJob()
    pickUp(row)
    await handOffAtMinute(row, 28)

    // Waiting in the queue: the row keeps its last beat, well inside the threshold.
    await vi.advanceTimersByTimeAsync(DRAIN_REQUEUE_DELAY_MS)
    pickUp(row)
    const second = withPreTaskHeartbeat(async () => { await sleep(12 * MIN) })({}, { jobId: row.id })

    await runCronUntil(45)
    await second
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    expect(row.status).toBe("processing")
  })

  it("a handed-back job that no worker re-picks is recovered as dead: swept 30 minutes after its last beat", async () => {
    const row = insertJob()
    pickUp(row)
    await handOffAtMinute(row, 28)

    await runCronUntil(55)
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    await runCronUntil(60)
    expect(sweepStaleSyncJob).toHaveBeenCalledTimes(1)
  })
})

describe("the beat is a CAS on the pickup sentinel", () => {
  it("never resurrects a sentinel a plugin cleared (gvp/evp stay on the 90-minute orchestrator sweep)", async () => {
    const row = insertJob({ job_type: "generate-video-pro", input_data: { type: "generate-video-pro" } })
    pickUp(row)
    Object.assign(row, { provider_kind: null, provider_call_started_at: null }) // tk.jobs.clearReconcileSentinel

    const run = withPreTaskHeartbeat(async () => { await sleep(10 * MIN) })({}, { jobId: row.id })
    await vi.advanceTimersByTimeAsync(10 * MIN)
    await run

    expect(row.provider_kind).toBeNull()
    expect(row.provider_call_started_at).toBeNull()
  })

  it("never overwrites a real provider kind a handler moved the row to", async () => {
    const row = insertJob()
    pickUp(row)
    const taskStamp = iso()
    Object.assign(row, { provider_kind: "kie-standard", provider_task_id: "task-1", provider_call_started_at: taskStamp })

    const run = withPreTaskHeartbeat(async () => { await sleep(10 * MIN) })({}, { jobId: row.id })
    await vi.advanceTimersByTimeAsync(10 * MIN)
    await run

    expect(row.provider_kind).toBe("kie-standard")
    expect(row.provider_call_started_at).toBe(taskStamp)
  })

  it("never makes a held (pending_review) or terminal row look live", async () => {
    const held = insertJob({ id: "held" })
    pickUp(held)
    const heldStamp = held.provider_call_started_at
    held.status = "pending_review"
    const done = insertJob({ id: "done" })
    pickUp(done)
    const doneStamp = done.provider_call_started_at
    done.status = "completed"

    const runs = [held, done].map((row) =>
      withPreTaskHeartbeat(async () => { await sleep(5 * MIN) })({}, { jobId: row.id }))
    await vi.advanceTimersByTimeAsync(5 * MIN)
    await Promise.all(runs)

    expect(held.provider_call_started_at).toBe(heldStamp)
    expect(done.provider_call_started_at).toBe(doneStamp)
  })
})
