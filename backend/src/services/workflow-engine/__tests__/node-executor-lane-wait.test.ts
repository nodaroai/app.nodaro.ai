/**
 * Concurrency lanes at the node executor (decided 2026-10-30: nothing fails for
 * waiting; only the queue timeout ends a wait). A job waiting for a slot sits
 * in `queued`. Its wait comes off both node clocks (`POLL_ABSOLUTE_TIMEOUT_MS`,
 * `NODE_TIMEOUT_MS`) and grows the run's `ctx.laneWaitMs`, which the workflow
 * cap leaves out; a component node's wait on its inner run grows by that run's
 * queued time, read from the rows only once its base is spent.
 *
 * Harness mirrors node-executor-held-job.test.ts / node-executor-budget-
 * ceilings.test.ts: only the external boundaries (Supabase, CreditsService,
 * BullMQ, fetch) are faked, so the real dispatch and the real poll loop run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockCheckCredits, mockReserveCredits, mockVideoAdd, mockRenderAdd, mockRefund } = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockVideoAdd: vi.fn(),
  mockRenderAdd: vi.fn(),
  mockRefund: vi.fn(),
}))

const JOB_ID = "job-lane-1"

const db = vi.hoisted(() => ({
  /** The row every status poll reads (the node's job, or a component wrapper). */
  jobRecord: {} as Record<string, unknown>,
  /** `input_data` of the component wrapper job. */
  wrapperInput: {} as Record<string, unknown>,
  /** The lane columns of each execution, by id (what `executionQueuedMs` reads). */
  laneRows: new Map<string, Record<string, unknown>>(),
  jobUpdates: [] as Array<Record<string, unknown>>,
  /** Every select that names a lane column, as `table:columns`. */
  laneReads: [] as string[],
}))

vi.mock("../../../lib/supabase.js", () => {
  function builder(table: string) {
    let op: "select" | "insert" | "update" | "delete" | null = null
    let columns = ""
    const filters: Record<string, unknown> = {}
    const b: Record<string, unknown> = {}
    b.select = (c?: string) => {
      if (op === null) {
        op = "select"
        columns = c ?? ""
        if (columns.includes("lane_")) db.laneReads.push(`${table}:${columns}`)
      }
      return b
    }
    b.eq = (col: string, v: unknown) => { filters[`eq:${col}`] = v; return b }
    b.in = (col: string, v: unknown) => { filters[`in:${col}`] = v; return b }
    for (const m of ["not", "order", "limit", "is", "neq", "lt"]) b[m] = () => b
    b.insert = () => { op = "insert"; return b }
    b.update = (patch: Record<string, unknown>) => { op = "update"; if (table === "jobs") db.jobUpdates.push(patch); return b }
    b.delete = () => { op = "delete"; return b }
    const one = () => {
      if (table === "jobs") {
        if (op === "insert") return { data: { id: JOB_ID }, error: null }
        if (columns === "input_data") return { data: { input_data: db.wrapperInput }, error: null }
        return { data: db.jobRecord, error: null }
      }
      if (table === "workflow_executions" && columns.includes("lane_wait_ms")) {
        return { data: db.laneRows.get(filters["eq:id"] as string) ?? null, error: null }
      }
      if (table === "workflow_executions" && columns === "node_states") return { data: { node_states: {} }, error: null }
      return { data: { status: "running" }, error: null }
    }
    const many = () => {
      if (table === "jobs" && op === "update") return { data: [{ id: JOB_ID, user_id: "user-1", provider_task_id: null }], error: null }
      return { data: [], error: null }
    }
    b.single = async () => one()
    b.maybeSingle = async () => one()
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(many()).then(res, rej)
    return b
  }
  return { supabase: { from: (table: string) => builder(table) } }
})

vi.mock("../../../ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
  getModelCreditBaseCost: vi.fn(async () => ({ creditCost: 10 })),
}))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: mockVideoAdd } }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: mockRenderAdd } }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: mockRefund }))
vi.mock("../../../lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: vi.fn(async () => 0) }))
const lanes = vi.hoisted(() => ({ withdrawFromLane: vi.fn(async (_jobId: string) => {}) }))
vi.mock("../../../lib/concurrency-lanes/withdraw.js", () => lanes)
vi.mock("../../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ cost_markup_percent: 0 }),
}))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))
vi.mock("../../../providers/video/social-post-video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/social-post-video.js")>()),
  probeSocialPostVideo: vi.fn(async () => ({ durationSec: null, title: null, isLive: false })),
}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"
import { resetLaneColumnsForTests } from "../../../lib/concurrency-lanes/columns.js"

const MINUTE = 60_000
/** Today's poll-timeout message — byte-identical while nothing waits. */
const TODAY_POLL_TIMEOUT = "Poll timeout: job did not complete within 5400s (may still be pending in queue)"
const TODAY_NODE_TIMEOUT = "Node timeout after 5400s of processing"

function vaNode(): SimpleNode {
  return { id: "va", type: "video-analysis", data: { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" } }
}
function componentNode(): SimpleNode {
  return {
    id: "cmp",
    type: "component",
    data: { appSlug: "tighten", componentMetadata: { inputs: [], outputs: [], exposedSettings: [] }, exposedSettings: {} },
  }
}

function makeCtx(over: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    billingContext: { payer: "user", userId: "user-1" },
    onJobCreated: vi.fn(),
    ...over,
  } as unknown as OrchestratorContext
}

/** Advance fake time in poll-sized bites so the loop actually iterates. */
async function advance(ms: number): Promise<void> {
  const STEP = 5 * MINUTE
  for (let left = ms; left > 0; left -= STEP) await vi.advanceTimersByTimeAsync(Math.min(STEP, left))
}

function run(node: SimpleNode, ctx: OrchestratorContext) {
  const settled: Array<{ ok: boolean; value: unknown }> = []
  const done = executeNode(node, {}, [], [node], {}, ctx).then(
    (v) => settled.push({ ok: true, value: v }),
    (e) => settled.push({ ok: false, value: e }),
  )
  return { settled, done }
}

const cancelled = () => db.jobUpdates.filter((u) => u.status === "cancelled")
const row = (status: string, extra: Record<string, unknown> = {}) => ({ status, output_data: null, error_message: null, progress: 0, ...extra })
const COMPLETED = { status: "completed", output_data: { analysis: "ok", text: "done" }, error_message: null, progress: 100, credits_actual: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  resetLaneColumnsForTests()
  db.jobUpdates = []
  db.wrapperInput = {}
  db.laneRows = new Map()
  db.laneReads = []
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
  mockReserveCredits.mockResolvedValue({ usageLogId: "usage-lane-1", creditsReserved: 3, watermark: false })
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("pollJobToCompletion — a job waiting for a concurrency slot", () => {
  it("a node queued 100 min then run 10 min does not time out", async () => {
    db.jobRecord = row("queued")
    const ctx = makeCtx()
    const { settled, done } = run(vaNode(), ctx)
    await advance(100 * MINUTE)
    expect(settled).toHaveLength(0)
    db.jobRecord = row("processing", { progress: 10 })
    await advance(10 * MINUTE)
    expect(settled).toHaveLength(0)
    expect(cancelled()).toHaveLength(0)
    db.jobRecord = COMPLETED
    await advance(1 * MINUTE)
    await done
    expect(settled[0]!.ok, String((settled[0]!.value as Error)?.message)).toBe(true)
    // The run's cap leaves the same wait out.
    expect(ctx.laneWaitMs).toBeGreaterThanOrEqual(99 * MINUTE)
    expect(ctx.laneWaitMs).toBeLessThanOrEqual(100 * MINUTE)
  }, 30_000)

  it("control: the processing clock still fires 90 minutes after the job started, whatever it waited before", async () => {
    db.jobRecord = row("queued")
    const { settled, done } = run(vaNode(), makeCtx())
    await advance(100 * MINUTE)
    db.jobRecord = row("processing", { progress: 10 })
    await advance(92 * MINUTE)
    await done
    expect(settled[0]!.ok).toBe(false)
    // Both clocks reach 90 minutes on the same tick once the wait is taken off; the poll clock is asked first.
    expect([TODAY_POLL_TIMEOUT, TODAY_NODE_TIMEOUT]).toContain((settled[0]!.value as Error).message)
    expect(cancelled()).toHaveLength(1)
  }, 30_000)

  it("control: a job that stays pending (not waiting for a slot) times out at 90 minutes, as today", async () => {
    db.jobRecord = row("pending")
    const ctx = makeCtx()
    const { settled, done } = run(vaNode(), ctx)
    await advance(89 * MINUTE)
    expect(settled).toHaveLength(0)
    await advance(2 * MINUTE)
    await done
    expect((settled[0]!.value as Error).message).toBe(TODAY_POLL_TIMEOUT)
    expect("laneWaitMs" in ctx).toBe(false)
  }, 30_000)

  it("with nothing queued nothing changes: same timeout, no extra statement, no figure on the run", async () => {
    db.jobRecord = row("processing", { progress: 10, lane_wait_ms: 0 })
    const ctx = makeCtx()
    const { settled, done } = run(vaNode(), ctx)
    await advance(91 * MINUTE)
    await done
    expect((settled[0]!.value as Error).message).toBe(TODAY_POLL_TIMEOUT)
    expect("laneWaitMs" in ctx).toBe(false)
    // The only lane column read is the poll's own select of the job's `lane_wait_ms`: no statement of its own.
    expect(db.laneReads.filter((r) => !r.startsWith("jobs:status, output_data, error_message"))).toEqual([])
  }, 30_000)

  it("a workflow node whose job waits 100 min in its handler does not time out", async () => {
    // A coordinator job (its calls, or its children, wait for slots) reports the wait on its row while it lasts.
    db.jobRecord = row("processing", { progress: 10, lane_wait_ms: 0 })
    const ctx = makeCtx()
    const { settled, done } = run(vaNode(), ctx)
    for (let m = 1; m <= 100; m++) {
      await vi.advanceTimersByTimeAsync(MINUTE)
      db.jobRecord = { ...db.jobRecord, lane_wait_ms: m * MINUTE }
    }
    await advance(20 * MINUTE) // then its own 20-minute run
    expect(settled).toHaveLength(0)
    expect(cancelled()).toHaveLength(0)
    db.jobRecord = { ...COMPLETED, lane_wait_ms: 100 * MINUTE }
    await advance(1 * MINUTE)
    await done
    expect(settled[0]!.ok, String((settled[0]!.value as Error)?.message)).toBe(true)
    // The run's cap leaves the same wait out (and the figure is persisted with it).
    expect(ctx.laneWaitMs).toBeGreaterThanOrEqual(99 * MINUTE)
    expect(ctx.laneWaitMs).toBeLessThanOrEqual(101 * MINUTE)
  }, 30_000)

  it("control: a job's in-handler wait counts from the read that found it running, and the node timeout still fires on its own running time", async () => {
    // 60 minutes of an earlier attempt's wait already on the row are not this poll's.
    db.jobRecord = row("processing", { progress: 10, lane_wait_ms: 60 * MINUTE })
    const { settled, done } = run(vaNode(), makeCtx())
    await advance(30 * MINUTE)
    db.jobRecord = { ...db.jobRecord, lane_wait_ms: 90 * MINUTE } // waited 30 of those minutes
    await advance(92 * MINUTE)
    await done
    expect(settled[0]!.ok).toBe(false)
    expect([TODAY_POLL_TIMEOUT, TODAY_NODE_TIMEOUT]).toContain((settled[0]!.value as Error).message)
  }, 30_000)

  it("siblings that wait at the same time credit the run the wall clock once (a union)", async () => {
    db.jobRecord = row("queued")
    const ctx = makeCtx()
    const a = run(vaNode(), ctx)
    const b = run({ ...vaNode(), id: "va2" }, ctx)
    await advance(30 * MINUTE)
    db.jobRecord = COMPLETED
    await advance(1 * MINUTE)
    await Promise.all([a.done, b.done])
    expect(ctx.laneWaitMs).toBeGreaterThanOrEqual(29 * MINUTE)
    expect(ctx.laneWaitMs).toBeLessThanOrEqual(31 * MINUTE)
  }, 30_000)

  it("waits one after another credit the run both", async () => {
    const ctx = makeCtx()
    db.jobRecord = row("queued")
    const a = run(vaNode(), ctx)
    await advance(20 * MINUTE)
    db.jobRecord = COMPLETED
    await advance(1 * MINUTE)
    await a.done
    db.jobRecord = row("queued")
    const b = run({ ...vaNode(), id: "va2" }, ctx)
    await advance(30 * MINUTE)
    db.jobRecord = COMPLETED
    await advance(1 * MINUTE)
    await b.done
    expect(ctx.laneWaitMs).toBeGreaterThanOrEqual(48 * MINUTE)
    expect(ctx.laneWaitMs).toBeLessThanOrEqual(51 * MINUTE)
  }, 30_000)
})

describe("a queued child adopted on a resume", () => {
  it("keeps the time it waited off its clocks from the first tick, and never adds it to this attempt's run", async () => {
    const now = Date.now()
    db.jobRecord = row("queued")
    const adoptable = new Map([["va", { jobId: JOB_ID, clocks: { dispatchedAtMs: now - 100 * MINUTE, queuedMs: 95 * MINUTE } }]])
    const ctx = makeCtx({ adoptableJobs: adoptable })
    const { settled, done } = run(vaNode(), ctx)
    await advance(1 * MINUTE)
    expect(settled).toHaveLength(0)
    expect(mockVideoAdd).not.toHaveBeenCalled() // re-attached, never re-dispatched
    // This attempt's own wait counts for the run; the 95 minutes before it do not.
    expect(ctx.laneWaitMs ?? 0).toBeLessThanOrEqual(2 * MINUTE)
    db.jobRecord = row("processing")
    await advance(20 * MINUTE)
    db.jobRecord = COMPLETED
    await advance(1 * MINUTE)
    await done
    expect(settled[0]!.ok, String((settled[0]!.value as Error)?.message)).toBe(true)
  }, 30_000)

  it("control: one adopted without its wait (stamp unreadable) is timed from its original dispatch as before", async () => {
    const now = Date.now()
    db.jobRecord = row("pending")
    const adoptable = new Map([["va", { jobId: JOB_ID, clocks: { dispatchedAtMs: now - 100 * MINUTE } }]])
    const { settled, done } = run(vaNode(), makeCtx({ adoptableJobs: adoptable }))
    await advance(1 * MINUTE)
    await done
    expect((settled[0]!.value as Error).message).toBe(TODAY_POLL_TIMEOUT)
  }, 30_000)
})

describe("a component node waits COMPONENT_TIMEOUT_MS + its inner run's queued time", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ jobId: "wrap-1" }) })))
    db.wrapperInput = { _executionId: "inner-1" }
  })

  it("the component wait extends by queued time: an inner run that queued 60 min is not abandoned at 90", async () => {
    db.laneRows.set("inner-1", { lane_wait_ms: 60 * MINUTE, lane_queued_at: null, started_at: null })
    db.jobRecord = row("processing", { progress: 10 })
    const ctx = makeCtx()
    const { settled, done } = run(componentNode(), ctx)
    await advance(89 * MINUTE)
    expect(db.laneReads).toEqual([]) // read only once the base is spent
    await advance(50 * MINUTE) // 139 min: inside 150
    expect(settled).toHaveLength(0)
    db.jobRecord = { status: "completed", output_data: { _executionId: "inner-1" }, error_message: null, progress: 100, credits_actual: 30 }
    await advance(1 * MINUTE)
    await done
    expect(settled[0]!.ok, String((settled[0]!.value as Error)?.message)).toBe(true)
    // …and the parent's cap leaves the inner run's queued time out too.
    expect(ctx.laneWaitMs).toBe(60 * MINUTE)
    expect("budgetExcessMs" in ctx).toBe(false)
  }, 60_000)

  it("…but not past 90 + the queued time, naming the grown limit", async () => {
    db.laneRows.set("inner-1", { lane_wait_ms: 60 * MINUTE, lane_queued_at: null, started_at: null })
    db.jobRecord = row("processing", { progress: 10 })
    const { settled, done } = run(componentNode(), makeCtx())
    await advance(151 * MINUTE)
    await done
    expect((settled[0]!.value as Error).message).toBe("Component execution timed out after 150 minutes")
  }, 60_000)

  it("a component that completes inside its base: no queued-time read while lanes are off, one when the run has them on", async () => {
    db.laneRows.set("inner-1", { lane_wait_ms: 5 * MINUTE, lane_queued_at: null, started_at: null })
    db.jobRecord = row("processing", { progress: 10 })
    const off = makeCtx()
    const first = run(componentNode(), off)
    await advance(10 * MINUTE)
    db.jobRecord = { status: "completed", output_data: { _executionId: "inner-1" }, error_message: null, progress: 100, credits_actual: 30 }
    await advance(1 * MINUTE)
    await first.done
    expect(db.laneReads).toEqual([])
    expect("laneWaitMs" in off).toBe(false)

    db.jobRecord = row("processing", { progress: 10 })
    const on = makeCtx({ runDispatch: { lanesEnforced: true, width: 50 } })
    const second = run(componentNode(), on)
    await advance(10 * MINUTE)
    db.jobRecord = { status: "completed", output_data: { _executionId: "inner-1" }, error_message: null, progress: 100, credits_actual: 30 }
    await advance(1 * MINUTE)
    await second.done
    expect(db.laneReads.length).toBeGreaterThan(0)
    expect(on.laneWaitMs).toBe(5 * MINUTE)
  }, 30_000)

  it("an inner run that never queued: times out at 90 minutes with today's message", async () => {
    db.jobRecord = row("processing", { progress: 10 })
    const ctx = makeCtx()
    const { settled, done } = run(componentNode(), ctx)
    await advance(91 * MINUTE)
    await done
    expect((settled[0]!.value as Error).message).toBe("Component execution timed out after 90 minutes")
    expect("laneWaitMs" in ctx).toBe(false)
  }, 30_000)
})
