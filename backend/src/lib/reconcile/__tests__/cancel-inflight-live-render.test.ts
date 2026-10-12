/**
 * Podcast Track 0.11 follow-up (product decision 2026-09-24): "On resume, if a
 * budgeted render's worker is still heartbeating, the orchestrator re-attaches
 * to it and keeps waiting instead of cancelling. The render never restarts
 * because of an orchestrator restart."
 *
 * `cancelInFlightChildJobs(…, { adoptLiveBudgetedRenders: true })` — the
 * orchestrator resume — adopts a single-shot row whose job declares a budget,
 * is `processing`, and carries a `pre-task` stamp younger than the reconcile
 * cron's own threshold. Everything else keeps today's cancel + refund.
 *
 * The fake database distinguishes what the resume READ (`db.rows`, the SELECT
 * snapshot) from what is TRUE when it writes (`db.truth`, what the CAS and the
 * re-read see) — so a heartbeat or a video-worker pickup landing between the
 * two can be staged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  truth: new Map<string, Record<string, unknown>>(),
  casFilters: [] as Array<Record<string, unknown>>,
  refunds: [] as string[],
  /** Before migration 451 reaches the database: a select naming the column fails. */
  slotWaitColumnMissing: false,
}))

vi.mock("../../supabase.js", () => {
  function builder() {
    let op: "select" | "update" = "select"
    let patch: Record<string, unknown> = {}
    const filters: Record<string, unknown> = {}
    const b: Record<string, unknown> = {}
    let columns = ""
    b.select = (cols?: string) => { if (typeof cols === "string") columns = cols; return b }
    b.update = (p: Record<string, unknown>) => { op = "update"; patch = p; return b }
    b.eq = (col: string, v: unknown) => { filters[`eq:${col}`] = v; return b }
    b.in = (col: string, v: unknown) => { filters[`in:${col}`] = v; return b }
    b.is = (col: string, v: unknown) => { filters[`is:${col}`] = v; return b }
    const matches = (row: Record<string, unknown>) =>
      Object.entries(filters).every(([key, v]) => {
        const [kind, col] = key.split(":") as [string, string]
        if (kind === "eq") return row[col] === v
        if (kind === "in") return (v as unknown[]).includes(row[col])
        if (kind === "is") return (row[col] ?? null) === v
        return true
      })
    const settle = () => {
      if (op === "update") {
        db.casFilters.push({ ...filters })
        const row = db.truth.get(filters["eq:id"] as string)
        if (!row || !matches(row)) return { data: [], error: null }
        db.truth.set(row.id as string, { ...row, ...patch })
        return { data: [{ id: row.id }], error: null }
      }
      // The resume's SELECT: the snapshot it read.
      if (missingColumn()) return missingColumn()
      return { data: db.rows.map(project), error: null }
    }
    // A read returns only the columns it names, like PostgREST — so a read
    // that forgets one is caught.
    const project = (row: Record<string, unknown>) =>
      Object.fromEntries(columns.split(",").map((c) => c.trim()).filter((c) => c in row).map((c) => [c, row[c]]))
    const missingColumn = () =>
      db.slotWaitColumnMissing && columns.includes("slot_wait_ms")
        ? { data: null, error: { code: "42703", message: "column jobs.slot_wait_ms does not exist" } }
        : undefined
    b.maybeSingle = async () => {
      if (missingColumn()) return missingColumn()
      const row = db.truth.get(filters["eq:id"] as string)
      return { data: row ? project(row) : null, error: null }
    }
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej)
    return b
  }
  return { supabase: { from: () => builder() } }
})
vi.mock("../../credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: vi.fn(async (id: string) => { db.refunds.push(id); return 1 }),
}))

import { cancelInFlightChildJobs, isLiveRenderRow, LIVE_PRE_TASK_STAMP_MS } from "../cancel-inflight-jobs.js"
import { STALE_THRESHOLD_MS } from "../types.js"
import { declaredJobBudgetMs } from "../../job-budget.js"
import { syncHttpIdempotencyKey } from "../../../services/workflow-engine/idempotency-key.js"

const MINUTE = 60_000
const NOW = Date.parse("2026-09-24T12:00:00.000Z")
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

/** A 25-minute video edit: a budget well past 90 minutes. */
const EDL = {
  version: 1, clock: "master",
  sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }],
  segments: Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, inMs: i * MINUTE, outMs: (i + 1) * MINUTE, video: "A" })),
}
const RENDER_INPUT = { node_id: "cut", type: "apply-edl", edl: EDL, output: "video", quality: "final" }
const BUDGET = declaredJobBudgetMs("apply-edl", RENDER_INPUT)!

/** An apply-edl row mid-render: picked up 100 min ago, dispatched 101 min ago. */
function renderRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "j-render",
    status: "processing",
    job_type: "apply-edl",
    input_data: RENDER_INPUT,
    provider_task_id: null,
    provider_kind: "pre-task",
    provider_call_started_at: iso(1 * MINUTE),
    created_at: iso(101 * MINUTE),
    started_at: iso(100 * MINUTE),
    usage_log_id: "ul-render",
    credits: 30,
    ...over,
  }
}

/** Stage the resume: `read` is the SELECT snapshot, `truth` what the write sees. */
function stage(read: Record<string, unknown>[], truth: Record<string, unknown>[] = read) {
  db.rows = read
  db.truth = new Map(truth.map((r) => [r.id as string, { ...r }]))
}

const RESUME = { adoptLiveBudgetedRenders: true } as const

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.casFilters = []
  db.refunds = []
})
afterEach(() => {
  vi.useRealTimers()
})

describe("the liveness rule is the reconcile cron's own", () => {
  it("LIVE_PRE_TASK_STAMP_MS is STALE_THRESHOLD_MS['pre-task'] — one number for both readers", () => {
    expect(LIVE_PRE_TASK_STAMP_MS).toBe(STALE_THRESHOLD_MS["pre-task"])
  })

  it("live = processing + pre-task + a stamp younger than the threshold", () => {
    const at = (msAgo: number, over: Record<string, unknown> = {}) =>
      isLiveRenderRow({ status: "processing", provider_kind: "pre-task", provider_call_started_at: iso(msAgo), ...over }, NOW)
    expect(at(LIVE_PRE_TASK_STAMP_MS - 1)).toBe(true)
    expect(at(LIVE_PRE_TASK_STAMP_MS)).toBe(false)
    expect(at(1 * MINUTE, { status: "pending" })).toBe(false)
    expect(at(1 * MINUTE, { provider_kind: null })).toBe(false)
    expect(at(1 * MINUTE, { provider_kind: "kie-standard" })).toBe(false)
    expect(isLiveRenderRow({ status: "processing", provider_kind: "pre-task", provider_call_started_at: null }, NOW)).toBe(false)
  })
})

describe("orchestrator resume — a budgeted render whose worker is still heartbeating", () => {
  it("is ADOPTED on its original clocks: no cancel, no refund, the same budget", async () => {
    stage([renderRow()])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)

    expect(cancelled).toBe(0)
    expect(db.casFilters).toHaveLength(0)
    expect(db.refunds).toHaveLength(0)
    expect(adoptable.get("cut")).toEqual({
      jobId: "j-render",
      usageLogId: "ul-render",
      creditsReserved: 30,
      budgetMs: BUDGET,
      clocks: { dispatchedAtMs: NOW - 101 * MINUTE, processingStartedAtMs: NOW - 100 * MINUTE, slotWaitMs: 0 },
    })
    expect(BUDGET).toBeGreaterThan(90 * MINUTE)
  })

  // Track 0.13: the adopting poll's absolute clock runs from dispatch BEFORE it
  // reads the row once — so the row's earlier slot wait rides on the clocks.
  it("carries the row's ffmpeg-slot wait on the adopted clocks", async () => {
    stage([renderRow({ slot_wait_ms: 60 * MINUTE })])
    const { adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.get("cut")?.clocks?.slotWaitMs).toBe(60 * MINUTE)
  })

  it("before migration 451 reaches the database: reads without the column and adopts with no wait", async () => {
    db.slotWaitColumnMissing = true
    try {
      stage([renderRow()])
      const { adoptable, cancelled } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
      expect(cancelled).toBe(0)
      expect(adoptable.get("cut")?.clocks?.slotWaitMs).toBe(0)
    } finally {
      db.slotWaitColumnMissing = false
      ;(await import("../../jobs-slot-wait-column.js")).resetSlotWaitColumnForTests()
    }
  })

  it("a stamp one tick short of the threshold is still live; AT the threshold it is not", async () => {
    stage([renderRow({ provider_call_started_at: iso(LIVE_PRE_TASK_STAMP_MS - 1000) })])
    expect((await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)).adoptable.has("cut")).toBe(true)

    stage([renderRow({ provider_call_started_at: iso(LIVE_PRE_TASK_STAMP_MS) })])
    const r = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(r.adoptable.has("cut")).toBe(false)
    expect(r.cancelled).toBe(1)
  })
})

describe("anything that is not a live budgeted render keeps today's cancel + refund", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["a STALE heartbeat (worker gone)", renderRow({ provider_call_started_at: iso(31 * MINUTE) })],
    ["NO heartbeat stamp", renderRow({ provider_call_started_at: null })],
    ["a cleared sentinel (provider_kind null)", renderRow({ provider_kind: null })],
    ["still PENDING (never picked up)", renderRow({ status: "pending", provider_kind: null, provider_call_started_at: null, started_at: null })],
    ["a fan-out iteration", renderRow({ input_data: { ...RENDER_INPUT, iterationIndex: 1 } })],
    ["an UNBUDGETED job, however fresh", renderRow({ job_type: "combine-videos", input_data: { node_id: "cut", type: "combine-videos" } })],
  ]
  for (const [label, row] of cases) {
    it(`${label} → cancelled + refunded, node re-dispatched`, async () => {
      stage([row])
      const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
      expect(adoptable.size).toBe(0)
      expect(cancelled).toBe(1)
      expect(db.refunds).toEqual(["j-render"])
      expect((db.truth.get("j-render")!.input_data as Record<string, unknown>).node_id).toBeUndefined()
    })
  }

  it("an unbudgeted row's cancel is NOT pinned to its stamp (byte-identical CAS)", async () => {
    stage([renderRow({ job_type: "combine-videos", input_data: { node_id: "cut", type: "combine-videos" } })])
    await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(Object.keys(db.casFilters[0]!).sort()).toEqual(["eq:id", "in:status"])
  })

  it("WITHOUT the resume option (the component-timeout cleanup) a live render is cancelled — the parent gave up", async () => {
    stage([renderRow()])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(adoptable.size).toBe(0)
    expect(cancelled).toBe(1)
    expect(db.refunds).toEqual(["j-render"])
  })

  it("a provider-task row is still class 2 — adopted on today's clocks (no `clocks`)", async () => {
    stage([renderRow({ provider_task_id: "task-1" })])
    const { adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.get("cut")?.clocks).toBeUndefined()
    expect(adoptable.get("cut")?.budgetMs).toBe(BUDGET)
  })
})

describe("the supersede-cancel never races a render that came alive (no double dispatch)", () => {
  it("read STALE, but a beat landed before the write → the pinned CAS misses and the re-read ADOPTS it", async () => {
    const read = renderRow({ provider_call_started_at: iso(40 * MINUTE) })
    stage([read], [renderRow({ provider_call_started_at: iso(0) })])

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)

    expect(db.casFilters[0]).toMatchObject({ "eq:provider_call_started_at": read.provider_call_started_at })
    expect(cancelled).toBe(0)
    expect(db.refunds).toHaveLength(0)
    expect(db.truth.get("j-render")!.status).toBe("processing")
    expect(adoptable.get("cut")?.jobId).toBe("j-render")
  })

  // Track 0.13: the re-read must carry the slot wait too — the adopting poll's
  // absolute clock is checked before it ever reads the row.
  it("the re-read carries the row's ffmpeg-slot wait onto the adopted clocks", async () => {
    stage([renderRow({ provider_call_started_at: iso(40 * MINUTE) })], [renderRow({ provider_call_started_at: iso(0), slot_wait_ms: 60 * MINUTE })])
    const { adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.get("cut")?.clocks?.slotWaitMs).toBe(60 * MINUTE)
  })

  it("the re-read before migration 451 reaches the database: retried without the column, still adopted", async () => {
    db.slotWaitColumnMissing = true
    try {
      stage([renderRow({ provider_call_started_at: iso(40 * MINUTE) })], [renderRow({ provider_call_started_at: iso(0) })])
      const { adoptable, cancelled } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
      expect(cancelled).toBe(0)
      expect(adoptable.get("cut")?.clocks?.slotWaitMs).toBe(0)
    } finally {
      db.slotWaitColumnMissing = false
      ;(await import("../../jobs-slot-wait-column.js")).resetSlotWaitColumnForTests()
    }
  })

  it("read PENDING, but the video worker picked it up before the write → adopted, not cancelled", async () => {
    const read = renderRow({ status: "pending", provider_kind: null, provider_call_started_at: null, started_at: null })
    stage([read], [renderRow({ provider_call_started_at: iso(0), started_at: iso(0) })])

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)

    expect(db.casFilters[0]).toMatchObject({ "is:provider_call_started_at": null })
    expect(cancelled).toBe(0)
    expect(db.refunds).toHaveLength(0)
    expect(adoptable.get("cut")?.clocks?.processingStartedAtMs).toBe(NOW)
  })

  it("a CAS miss on a row that is NOT live (it just finished) adopts nothing and cancels nothing", async () => {
    stage([renderRow({ provider_call_started_at: iso(40 * MINUTE) })], [renderRow({ status: "completed" })])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(cancelled).toBe(0)
    expect(adoptable.size).toBe(0)
  })

  it("first live row per node wins; a second one for the same node is cancelled", async () => {
    stage([renderRow(), renderRow({ id: "j-dup" })])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.get("cut")?.jobId).toBe("j-render")
    expect(cancelled).toBe(1)
    expect(db.refunds).toEqual(["j-dup"])
  })
})

describe("orchestrator resume — a UGC job whose worker is still running", () => {
  /** A UGC Clip mid-render: its route's own job, picked up 9 min ago, its worker beating. */
  function ugcRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "j-clip",
      status: "processing",
      job_type: "ugc-clip",
      input_data: { node_id: "clip", clip: 1, durationSec: 12 },
      provider_task_id: null,
      provider_kind: "pre-task",
      provider_call_started_at: iso(1 * MINUTE),
      created_at: iso(10 * MINUTE),
      started_at: iso(9 * MINUTE),
      usage_log_id: "ul-clip",
      credits: 1200,
      ...over,
    }
  }

  it.each(["ugc-clip", "ugc-script"])("a live %s job is ADOPTED on its original clocks: no cancel, no refund", async (jobType) => {
    stage([ugcRow({ job_type: jobType })])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(cancelled).toBe(0)
    expect(db.casFilters).toHaveLength(0)
    expect(db.refunds).toHaveLength(0)
    expect(adoptable.get("clip")).toEqual({
      jobId: "j-clip",
      usageLogId: "ul-clip",
      creditsReserved: 1200,
      clocks: { dispatchedAtMs: NOW - 10 * MINUTE, processingStartedAtMs: NOW - 9 * MINUTE, slotWaitMs: 0 },
    })
  })

  it("a UGC job whose worker is gone (its stamp aged out) is cancelled and refunded, so the re-run is charged once", async () => {
    stage([ugcRow({ provider_call_started_at: iso(LIVE_PRE_TASK_STAMP_MS) })])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.has("clip")).toBe(false)
    expect(cancelled).toBe(1)
    expect(db.refunds).toEqual(["j-clip"])
  })

  it("a fan-out iteration's UGC job is cancelled, not adopted (its re-run reuses or inherits the work)", async () => {
    stage([ugcRow({ input_data: { node_id: "clip", iterationIndex: 0, clip: 1 } })])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.size).toBe(0)
    expect(cancelled).toBe(1)
  })

  it("a UGC job its worker has not picked up yet is cancelled for free", async () => {
    stage([ugcRow({ status: "pending", job_type: null, provider_kind: null, provider_call_started_at: null, started_at: null })])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.size).toBe(0)
    expect(cancelled).toBe(1)
  })

  it("outside a resume (the component cleanup) a live UGC job is cancelled: its parent gave up on it", async () => {
    stage([ugcRow()])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(adoptable.size).toBe(0)
    expect(cancelled).toBe(1)
  })

  it("a beat landing between the read and the cancel keeps a live UGC job: the cancel is pinned to the stamp it judged dead", async () => {
    const stale = ugcRow({ provider_call_started_at: iso(LIVE_PRE_TASK_STAMP_MS + MINUTE) })
    stage([stale], [{ ...stale, provider_call_started_at: iso(0) }])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(cancelled).toBe(0)
    expect(adoptable.get("clip")?.jobId).toBe("j-clip")
  })

  it("another unbudgeted job type keeps today's rule: cancelled even while its worker runs", async () => {
    stage([ugcRow({ job_type: "generate-image" })])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.size).toBe(0)
    expect(cancelled).toBe(1)
  })
})

describe("a cancelled resume job gives back this run's request key, never a route's own key", () => {
  /** The key this run sent for the node, as the lane builds it. */
  const SCRIPT_KEY = syncHttpIdempotencyKey("exec-1", "script")
  /** A UGC Script job whose worker is gone: its stamp aged out. */
  function scriptRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "j-script",
      status: "processing",
      job_type: "ugc-script",
      user_id: "owner-1",
      idempotency_key: SCRIPT_KEY,
      input_data: { node_id: "script" },
      provider_task_id: null,
      provider_kind: "pre-task",
      provider_call_started_at: iso(LIVE_PRE_TASK_STAMP_MS),
      created_at: iso(10 * MINUTE),
      started_at: iso(9 * MINUTE),
      usage_log_id: "ul-script",
      credits: 20,
      ...over,
    }
  }
  /** What the re-run's reservation meets under the same key: UNIQUE(user_id, idempotency_key). */
  const keyHolders = (key: string) =>
    [...db.truth.values()].filter((r) => r.user_id === "owner-1" && r.idempotency_key === key).map((r) => r.id)

  it("a dead keyed UGC Script job is cancelled with its key cleared: the re-run's reservation takes the key and the node runs", async () => {
    stage([scriptRow()])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(cancelled).toBe(1)
    expect(adoptable.size).toBe(0)
    expect(db.refunds).toEqual(["j-script"])
    expect(db.truth.get("j-script")).toMatchObject({ status: "cancelled", idempotency_key: null })
    // Nothing holds the key any more, so the re-run's row keeps it instead of being handed the cancelled job.
    expect(keyHolders(SCRIPT_KEY)).toEqual([])
  })

  it("a keyed job its worker never picked up is cancelled the same way", async () => {
    stage([scriptRow({ status: "pending", provider_kind: null, provider_call_started_at: null, started_at: null })])
    await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(db.truth.get("j-script")).toMatchObject({ status: "cancelled", idempotency_key: null })
  })

  it("a dead UGC Clip job keeps its content key: the clip route answers the re-run from it", async () => {
    const contentKey = "ugc-clip-content-0f3a9c"
    stage([scriptRow({
      id: "j-clip",
      job_type: "ugc-clip",
      idempotency_key: contentKey,
      input_data: { node_id: "clip", ugcClipRequestKey: syncHttpIdempotencyKey("exec-1", "clip") },
      credits: 1200,
    })])
    const { cancelled } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(cancelled).toBe(1)
    expect(db.truth.get("j-clip")).toMatchObject({ status: "cancelled", idempotency_key: contentKey })
  })

  it("another execution's key is left alone", async () => {
    const theirs = syncHttpIdempotencyKey("exec-0", "script")
    stage([scriptRow({ idempotency_key: theirs })])
    await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(db.truth.get("j-script")).toMatchObject({ status: "cancelled", idempotency_key: theirs })
  })

  it("a live job is adopted and keeps its key: the re-run polls it and buys nothing", async () => {
    stage([scriptRow({ provider_call_started_at: iso(1 * MINUTE) })])
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(cancelled).toBe(0)
    expect(adoptable.get("script")?.jobId).toBe("j-script")
    expect(db.truth.get("j-script")!.idempotency_key).toBe(SCRIPT_KEY)
  })
})
