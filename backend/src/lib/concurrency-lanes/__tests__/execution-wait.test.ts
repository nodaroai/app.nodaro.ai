// A run's time spent waiting for concurrency slots (decided 2026-10-30:
// nothing fails for waiting): the orchestrator's running figure, its
// persisted column, and the read every outside clock grows by. The column is
// read and written tolerantly until migration 568 reaches the shared database.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeFakeLaneDb, type FakeLaneDb } from "./fake-lane-db.js"

const refs = vi.hoisted(() => ({ db: null as unknown as { client: { from(t: string): unknown } } }))
vi.mock("../../supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))

const { addRunLaneWait, executionQueuedMs, laneQueuedAtOf, MAX_LANE_WAIT_INTERVALS, MAX_QUEUED_CREDIT_MS, persistRunLaneWait } = await import("../execution-wait.js")
const { laneColumnsAbsent, resetLaneColumnsForTests } = await import("../columns.js")

const MIN = 60_000
const NOW = Date.parse("2026-10-31T12:00:00.000Z")
const iso = (ms: number) => new Date(ms).toISOString()

let db: FakeLaneDb

beforeEach(() => {
  db = makeFakeLaneDb()
  refs.db = db
  resetLaneColumnsForTests()
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

const execution = (over: Record<string, unknown> = {}) => {
  const row = {
    id: "exec-1", user_id: "U", status: "running", started_at: iso(NOW - 60 * MIN), updated_at: iso(NOW - 60 * MIN),
    lane_queued_at: null, lane_wait_ms: 0, node_states: {}, ...over,
  }
  db.rows("workflow_executions").push(row)
  return row
}
const job = (id: string, over: Record<string, unknown> = {}) =>
  db.rows("jobs").push({ id, user_id: "U", workflow_execution_id: "exec-1", status: "processing", lane_queued_at: null, ...over })

describe("addRunLaneWait — the wall clock the run spent waiting (a union)", () => {
  it("concurrent sibling waits credit the wall clock only once", () => {
    const ctx: { laneWaitMs?: number; laneWaitIntervals?: Array<[number, number]> } = {}
    // Fifty siblings each report the same 3-s tick of a 2-hour wait.
    for (let t = 0; t < 120 * MIN; t += 3_000) {
      for (let i = 0; i < 50; i++) addRunLaneWait(ctx, NOW + t, NOW + t + 3_000)
    }
    expect(ctx.laneWaitMs).toBe(120 * MIN)
  })

  it("sequential waits credit both", () => {
    const ctx: { laneWaitMs?: number; laneWaitIntervals?: Array<[number, number]> } = {}
    addRunLaneWait(ctx, NOW, NOW + 30 * MIN)
    addRunLaneWait(ctx, NOW + 60 * MIN, NOW + 100 * MIN)
    expect(ctx.laneWaitMs).toBe(70 * MIN)
  })

  it("a long wait reported late counts in full, whatever shorter waits were reported since", () => {
    // An inner run waited minutes 0–100; a sibling waited 120–124; the component completes at 125.
    const ctx: { laneWaitMs?: number; laneWaitIntervals?: Array<[number, number]> } = {}
    addRunLaneWait(ctx, NOW + 120 * MIN, NOW + 124 * MIN)
    addRunLaneWait(ctx, NOW + 25 * MIN, NOW + 125 * MIN) // reported at completion as [now − 100, now]
    expect(ctx.laneWaitMs).toBeGreaterThanOrEqual(100 * MIN)
    expect(ctx.laneWaitMs).toBe(100 * MIN)
    addRunLaneWait(ctx, NOW, NOW + 10 * MIN) // an earlier wait, reported later still
    expect(ctx.laneWaitMs).toBe(110 * MIN)
    expect(ctx.laneWaitIntervals).toEqual([[NOW, NOW + 10 * MIN], [NOW + 25 * MIN, NOW + 125 * MIN]])
  })

  it("the interval list stays bounded: past the limit the oldest merge (their gap then counts — the safe side)", () => {
    const ctx: { laneWaitMs?: number; laneWaitIntervals?: Array<[number, number]> } = {}
    const n = MAX_LANE_WAIT_INTERVALS + 10
    for (let i = 0; i < n; i++) addRunLaneWait(ctx, NOW + i * 2 * MIN, NOW + (i * 2 + 1) * MIN)
    expect(ctx.laneWaitIntervals!.length).toBe(MAX_LANE_WAIT_INTERVALS)
    expect(ctx.laneWaitMs).toBeGreaterThanOrEqual(n * MIN)
    expect(ctx.laneWaitMs).toBeLessThanOrEqual((2 * n) * MIN)
  })

  it("a wait that overlaps one already counted counts only its new part", () => {
    const ctx: { laneWaitMs?: number; laneWaitIntervals?: Array<[number, number]> } = {}
    addRunLaneWait(ctx, NOW, NOW + 30 * MIN)
    addRunLaneWait(ctx, NOW + 10 * MIN, NOW + 45 * MIN) // an inner run's wait, reported when its node completes
    expect(ctx.laneWaitMs).toBe(45 * MIN)
    addRunLaneWait(ctx, NOW + 20 * MIN, NOW + 40 * MIN) // wholly covered already
    expect(ctx.laneWaitMs).toBe(45 * MIN)
  })

  it("an empty or invalid interval leaves a run that never waited without any figure", () => {
    const ctx: { laneWaitMs?: number; laneWaitIntervals?: Array<[number, number]> } = {}
    addRunLaneWait(ctx, NOW, NOW)
    addRunLaneWait(ctx, NOW, NOW - 5)
    addRunLaneWait(ctx, Number.NaN, NOW)
    expect("laneWaitMs" in ctx).toBe(false)
    expect("laneWaitIntervals" in ctx).toBe(false)
  })
})

describe("persistRunLaneWait", () => {
  it("writes nothing while the run has not waited — no extra statement", async () => {
    execution()
    const writes: string[] = []
    db.beforeUpdate = (t) => { writes.push(t) }
    await persistRunLaneWait("exec-1", {})
    await persistRunLaneWait("exec-1", { laneWaitMs: 0 })
    expect(writes).toEqual([])
  })

  it("writes the figure once it waited, again only once it grew, and never lowers the column", async () => {
    const row = execution({ lane_wait_ms: 0 })
    const writes: string[] = []
    db.beforeUpdate = (t) => { writes.push(t) }
    const ctx = { laneWaitMs: 4 * MIN }
    await persistRunLaneWait("exec-1", ctx)
    expect(row.lane_wait_ms).toBe(4 * MIN)
    await persistRunLaneWait("exec-1", ctx)
    expect(writes).toHaveLength(1)
    ctx.laneWaitMs = 6 * MIN
    await persistRunLaneWait("exec-1", ctx)
    expect(row.lane_wait_ms).toBe(6 * MIN)
    // A resumed attempt starts again from 0: its smaller figure never lowers what an earlier one wrote.
    await persistRunLaneWait("exec-1", { laneWaitMs: 1 * MIN })
    expect(row.lane_wait_ms).toBe(6 * MIN)
  })

  it("a database without the column: no throw, remembered, never named again", async () => {
    execution()
    db.missingColumns.add("workflow_executions.lane_wait_ms")
    await expect(persistRunLaneWait("exec-1", { laneWaitMs: 4 * MIN })).resolves.toBeUndefined()
    expect(laneColumnsAbsent("workflow_executions")).toBe(true)
    const writes: string[] = []
    db.beforeUpdate = (t) => { writes.push(t) }
    db.missingColumns.clear()
    await persistRunLaneWait("exec-1", { laneWaitMs: 8 * MIN })
    expect(writes).toEqual([])
  })
})

describe("executionQueuedMs", () => {
  it("the persisted figure plus the longest wait still going on — overlapping waits count once", async () => {
    execution({ lane_wait_ms: 30 * MIN, updated_at: iso(NOW - 60 * MIN) })
    job("j-wait", { status: "queued", lane_queued_at: iso(NOW - 50 * MIN) })
    job("j-wait2", { status: "queued", lane_queued_at: iso(NOW - 20 * MIN) }) // overlaps the first
    job("j-run", { status: "processing", lane_queued_at: iso(NOW - 70 * MIN) }) // admitted: its wait is in the figure
    job("j-other", { status: "queued", lane_queued_at: iso(NOW - 90 * MIN), workflow_execution_id: "exec-2" })
    job("j-foreign", { status: "queued", lane_queued_at: iso(NOW - 90 * MIN), user_id: "V" }) // a pointer, not the run's
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(80 * MIN)
  })

  it("never counts twice what the persisted figure already covers (a wait counts only after the row's last write)", async () => {
    // The run wrote 40 minutes at its last write, 10 minutes ago; its child has waited 50 minutes and still does.
    execution({ lane_wait_ms: 40 * MIN, updated_at: iso(NOW - 10 * MIN) })
    job("j-wait", { status: "queued", lane_queued_at: iso(NOW - 50 * MIN) })
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(50 * MIN)
  })

  it("nothing persisted yet: the child's whole wait counts, whatever the row's last write", async () => {
    execution({ lane_wait_ms: 0, updated_at: iso(NOW - 1 * MIN) })
    job("j-wait", { status: "queued", lane_queued_at: iso(NOW - 50 * MIN) })
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(50 * MIN)
  })

  it("the run's own wait for its run slot counts only on request: to started_at, or to now while it still waits", async () => {
    execution({ started_at: iso(NOW - 10 * MIN), lane_queued_at: iso(NOW - 40 * MIN), lane_wait_ms: 5 * MIN })
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(5 * MIN)
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW, includeOwnWait: true })).toBe(35 * MIN)
    db.rows("workflow_executions")[0]!.started_at = null
    db.rows("workflow_executions")[0]!.status = "pending"
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW, includeOwnWait: true })).toBe(45 * MIN)
  })

  it("a wait read from a row is capped at the longest queue timeout plus slack: a row the sweep missed never extends a clock without end", async () => {
    expect(MAX_QUEUED_CREDIT_MS).toBe((1440 + 30) * MIN)
    execution({ lane_queued_at: iso(NOW - 5 * 24 * 60 * MIN), started_at: null, status: "pending" })
    job("j-stuck", { status: "queued", lane_queued_at: iso(NOW - 3 * 24 * 60 * MIN) })
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(MAX_QUEUED_CREDIT_MS)
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW, includeOwnWait: true })).toBe(2 * MAX_QUEUED_CREDIT_MS)
  })

  it("a component or use-case node's inner run still in flight: its waiting counts, recursively and owner-scoped", async () => {
    execution({ node_states: { cmp: { status: "running", jobId: "w-1" }, uc: { status: "running", jobId: "w-2" }, done: { status: "completed", jobId: "w-3" } } })
    db.rows("jobs").push(
      { id: "w-1", user_id: "U", provider: "component", status: "processing", created_at: iso(NOW - 100 * MIN), input_data: { _executionId: "inner-1" } },
      { id: "w-2", user_id: "U", provider: "use-case", status: "processing", created_at: iso(NOW - 100 * MIN), input_data: { _executionId: "inner-2" } },
      // Settled: its wait is already in the run's own figure.
      { id: "w-3", user_id: "U", provider: "component", status: "completed", created_at: iso(NOW - 300 * MIN), input_data: { _executionId: "inner-3" } },
    )
    execution({ id: "inner-1", lane_wait_ms: 20 * MIN, updated_at: iso(NOW - 90 * MIN) })
    job("i1-wait", { workflow_execution_id: "inner-1", status: "queued", lane_queued_at: iso(NOW - 30 * MIN) })
    execution({ id: "inner-2", lane_wait_ms: 0, updated_at: iso(NOW - 90 * MIN), node_states: { deep: { status: "running", jobId: "w-4" } } })
    db.rows("jobs").push({ id: "w-4", user_id: "U", provider: "component", status: "processing", created_at: iso(NOW - 60 * MIN), input_data: { _executionId: "inner-4" } })
    execution({ id: "inner-4", lane_wait_ms: 25 * MIN, updated_at: iso(NOW - 70 * MIN) })
    execution({ id: "inner-3", lane_wait_ms: 200 * MIN })
    // inner-1: 20 + 30 = 50; inner-2: its nested run's 25. They run at once: 75, within the 100 minutes since they began.
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(75 * MIN)
  })

  it("waits running at once never credit more than the wall clock since the first began", async () => {
    execution({ node_states: { cmp: { status: "running", jobId: "w-1" } } })
    db.rows("jobs").push({ id: "w-1", user_id: "U", provider: "component", status: "processing", created_at: iso(NOW - 40 * MIN), input_data: { _executionId: "inner-1" } })
    execution({ id: "inner-1", lane_wait_ms: 0 })
    job("i1-wait", { workflow_execution_id: "inner-1", status: "queued", lane_queued_at: iso(NOW - 35 * MIN) })
    job("j-wait", { status: "queued", lane_queued_at: iso(NOW - 30 * MIN) })
    // 35 + 30 summed, but the inner run's node began 40 minutes ago: at most 40.
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(40 * MIN)
  })

  it("an inner run of another user, or a cycle, adds nothing", async () => {
    execution({ node_states: { cmp: { status: "running", jobId: "w-1" } } })
    db.rows("jobs").push({ id: "w-1", user_id: "U", provider: "component", status: "processing", created_at: iso(NOW - 40 * MIN), input_data: { _executionId: "exec-1" } })
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(0)
    db.rows("jobs")[0]!.input_data = { _executionId: "theirs" }
    execution({ id: "theirs", user_id: "V", lane_wait_ms: 60 * MIN })
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(0)
  })

  it("another user's execution reads as no wait", async () => {
    execution({ lane_wait_ms: 30 * MIN })
    expect(await executionQueuedMs("exec-1", "V", { nowMs: NOW })).toBe(0)
  })

  it("reads tolerate a missing lane_wait_ms column", async () => {
    execution({ lane_wait_ms: 30 * MIN })
    job("j-wait", { status: "queued", lane_queued_at: iso(NOW - 20 * MIN) })
    db.missingColumns.add("workflow_executions.lane_wait_ms")
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(20 * MIN)
    expect(laneColumnsAbsent("workflow_executions")).toBe(true)
    db.missingColumns.add("jobs.lane_queued_at")
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(0)
    expect(laneColumnsAbsent("jobs")).toBe(true)
    // Known absent: never named again.
    const before = db.selects.filter((sel) => sel.includes("lane_")).length
    expect(await executionQueuedMs("exec-1", "U", { nowMs: NOW })).toBe(0)
    expect(db.selects.filter((sel) => sel.includes("lane_")).length).toBe(before)
  })

  it("a failed read counts as no wait and never throws", async () => {
    execution({ lane_wait_ms: 30 * MIN })
    db.failing.add("workflow_executions")
    db.failing.add("jobs")
    await expect(executionQueuedMs("exec-1", "U", { nowMs: NOW })).resolves.toBe(0)
  })
})

describe("laneQueuedAtOf", () => {
  it("when each waiting job entered its line; nothing asked → no read", async () => {
    job("j-1", { status: "queued", lane_queued_at: iso(NOW - 20 * MIN) })
    job("j-2", { status: "queued", lane_queued_at: null })
    expect(await laneQueuedAtOf(["j-1", "j-2"])).toEqual(new Map([["j-1", NOW - 20 * MIN]]))
    const before = db.selects.length
    expect((await laneQueuedAtOf([])).size).toBe(0)
    expect(db.selects.length).toBe(before)
  })

  it("a database without the column answers an empty map", async () => {
    job("j-1", { status: "queued", lane_queued_at: iso(NOW - 20 * MIN) })
    db.missingColumns.add("jobs.lane_queued_at")
    expect((await laneQueuedAtOf(["j-1"])).size).toBe(0)
    expect(laneColumnsAbsent("jobs")).toBe(true)
  })
})
