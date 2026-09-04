/**
 * The DAG waiter and a job parked in `pending_review`
 * (spec 2026-09-03-job-policy-hook-design §6.3, §17.1, §17.10).
 *
 * THE BUG THIS PINS: `pollJobToCompletion`'s two clocks — the absolute poll
 * timeout (`POLL_ABSOLUTE_TIMEOUT_MS`) and the per-node processing timeout
 * (`NODE_TIMEOUT_MS`), both 90 minutes — ran straight through a human review.
 * At 90 minutes the loop called `cancelJobAndThrow`, whose UPDATE is
 * `.not("status","in","(completed,failed,cancelled)")` — a predicate that
 * MATCHES `pending_review`. So a job a reviewer was actively looking at got
 * flipped to `cancelled` and refunded out from under them, and the review page
 * then resolved a row nobody could complete.
 *
 * The fix freezes both clocks while the row is parked (`heldTotalMs`), so a
 * 95-minute review costs the node no budget at all. The two CANCELLATION
 * intents (user cancel, execution cancelled) deliberately still reach
 * `cancelJobAndThrow` and still take a held child with them — §17.1 —
 * so this file pins that half too.
 *
 * Orchestrated jobs are hold-INELIGIBLE in v1 (D8: `workflow_execution_id`
 * must be null), so this is a CONTRACT guard: it makes widening eligibility a
 * config change instead of a project, and stops a future widening from
 * silently cancelling a job under review.
 *
 * Mocking style mirrors node-executor-error-hint.test.ts: only the external
 * boundaries (Supabase, CreditsService, BullMQ) are faked, so the real
 * `pollJobToCompletion` runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockCheckCredits, mockReserveCredits, mockVideoAdd, mockRenderAdd, mockRefund } = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockVideoAdd: vi.fn(),
  mockRenderAdd: vi.fn(),
  mockRefund: vi.fn(),
}))

const JOB_ID = "job-held-1"

/** The row `pollJobToCompletion` reads on every tick; tests reassign it. */
let jobRecord: Record<string, unknown> = {}
/** `workflow_executions.status` the mid-poll cancel check reads. */
let executionStatus = "running"
/** Every `jobs` UPDATE patch, in order — the assertion surface. */
let jobUpdates: Array<Record<string, unknown>> = []

vi.mock("../../../lib/supabase.js", () => {
  function jobsBuilder() {
    let op: "select" | "insert" | "update" | "delete" | null = null
    const b: Record<string, unknown> = {}
    const self = () => b
    b.select = () => { op ??= "select"; return b }
    for (const m of ["eq", "not", "in", "order", "limit", "is", "neq"]) b[m] = self
    b.insert = () => { op = "insert"; return b }
    b.update = (patch: Record<string, unknown>) => { op = "update"; jobUpdates.push(patch); return b }
    b.delete = () => { op = "delete"; return b }
    b.single = async () => (op === "insert" ? { data: { id: JOB_ID }, error: null } : { data: jobRecord, error: null })
    b.maybeSingle = async () => (op === "insert" ? { data: { id: JOB_ID }, error: null } : { data: jobRecord, error: null })
    // Awaited without a terminal: an UPDATE ... RETURNING (cancelJobAndThrow's
    // CAS) yields the flipped rows; anything else yields nothing.
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(
        op === "update" ? { data: [{ id: JOB_ID, user_id: "user-1", provider_task_id: null }], error: null } : { data: null, error: null },
      ).then(res, rej)
    return b
  }
  function otherBuilder() {
    const b: Record<string, unknown> = {}
    const self = () => b
    for (const m of ["select", "eq", "not", "in", "order", "limit", "insert", "update", "delete"]) b[m] = self
    b.single = async () => ({ data: { status: executionStatus }, error: null })
    b.maybeSingle = async () => ({ data: { status: executionStatus }, error: null })
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(res, rej)
    return b
  }
  return { supabase: { from: (table: string) => (table === "jobs" ? jobsBuilder() : otherBuilder()) } }
})

vi.mock("../../../ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: mockVideoAdd } }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: mockRenderAdd } }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: mockRefund }))
vi.mock("../../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ cost_markup_percent: 0 }),
}))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))

import { executeNode } from "../node-executor.js"
import { NODE_TIMEOUT_MS, POLL_ABSOLUTE_TIMEOUT_MS } from "../types.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const MINUTE = 60_000

function vaNode(): SimpleNode {
  return { id: "va", type: "video-analysis", data: { youtubeUrl: "https://youtu.be/abc123" } }
}

function makeCtx(over: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    onJobCreated: vi.fn(),
    ...over,
  } as unknown as OrchestratorContext
}

/** Advance fake time in poll-sized bites so the loop actually iterates. */
async function advance(ms: number): Promise<void> {
  const STEP = 5 * MINUTE
  for (let left = ms; left > 0; left -= STEP) {
    await vi.advanceTimersByTimeAsync(Math.min(STEP, left))
  }
}

describe("pollJobToCompletion — a job parked in pending_review", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobUpdates = []
    executionStatus = "running"
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
    mockReserveCredits.mockResolvedValue({ usageLogId: "usage-held-1", creditsReserved: 3, watermark: false })
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("survives a 95-minute review: neither timeout cancels the job, and the approved output is returned", async () => {
    jobRecord = { status: "processing", output_data: null, error_message: null, progress: 40 }

    const settled: Array<{ ok: boolean; value: unknown }> = []
    const running = executeNode(vaNode(), {}, [], [vaNode()], {}, makeCtx()).then(
      (v) => settled.push({ ok: true, value: v }),
      (e) => settled.push({ ok: false, value: e }),
    )

    // A minute of real processing, then the result gate parks the row.
    await advance(2 * MINUTE)
    jobRecord = { status: "pending_review", output_data: null, error_message: null, progress: 100 }

    // 95 minutes of review — PAST both 90-minute clocks.
    await advance(95 * MINUTE)
    expect(settled).toHaveLength(0)
    expect(jobUpdates.filter((u) => u.status === "cancelled")).toHaveLength(0)
    expect(mockRefund).not.toHaveBeenCalled()

    // The reviewer approves: pending_review → completed, with no intervening tick.
    jobRecord = {
      status: "completed",
      output_data: { analysis: "ok", text: "a summary" },
      error_message: null,
      progress: 100,
      credits_actual: 3,
    }
    await advance(1 * MINUTE)
    await running

    expect(settled).toHaveLength(1)
    expect(settled[0].ok).toBe(true)
    expect(jobUpdates.filter((u) => u.status === "cancelled")).toHaveLength(0)
    expect(mockRefund).not.toHaveBeenCalled()
    expect(NODE_TIMEOUT_MS).toBe(90 * MINUTE)
    expect(POLL_ABSOLUTE_TIMEOUT_MS).toBe(90 * MINUTE)
  }, 30_000)

  it("still enforces the node timeout on the time that was NOT spent under review", async () => {
    jobRecord = { status: "processing", output_data: null, error_message: null, progress: 10 }

    const settled: Array<{ ok: boolean; value: unknown }> = []
    const running = executeNode(vaNode(), {}, [], [vaNode()], {}, makeCtx()).then(
      (v) => settled.push({ ok: true, value: v }),
      (e) => settled.push({ ok: false, value: e }),
    )

    // 50 minutes of genuine processing, 30 minutes parked, 45 more processing:
    // 95 minutes of real work in a 185-minute wall clock ⇒ the timeout fires.
    await advance(50 * MINUTE)
    jobRecord = { ...jobRecord, status: "pending_review" }
    await advance(30 * MINUTE)
    jobRecord = { ...jobRecord, status: "processing" }
    await advance(45 * MINUTE)
    await running

    expect(settled).toHaveLength(1)
    expect(settled[0].ok).toBe(false)
    expect((settled[0].value as Error).message).toMatch(/timeout/i)
    expect(jobUpdates.filter((u) => u.status === "cancelled")).toHaveLength(1)
  }, 30_000)

  it("a user cancel still takes a held child with it (§17.1 — the two cancellation intents are NOT exempt)", async () => {
    jobRecord = { status: "pending_review", output_data: null, error_message: null, progress: 100 }
    const ctx = makeCtx()

    const settled: Array<{ ok: boolean; value: unknown }> = []
    const running = executeNode(vaNode(), {}, [], [vaNode()], {}, ctx).then(
      (v) => settled.push({ ok: true, value: v }),
      (e) => settled.push({ ok: false, value: e }),
    )

    await advance(1 * MINUTE)
    expect(settled).toHaveLength(0)

    ctx.cancelled = true
    await advance(1 * MINUTE)
    await running

    expect(settled).toHaveLength(1)
    expect(settled[0].ok).toBe(false)
    expect((settled[0].value as Error).message).toBe("Execution cancelled")
    expect(jobUpdates.filter((u) => u.status === "cancelled")).toHaveLength(1)
    expect(mockRefund).toHaveBeenCalled()
  }, 30_000)

  it("reports the hold to the canvas: onJobProgress carries awaitingReview, and ctx.maxChildHeldMs accumulates", async () => {
    jobRecord = { status: "processing", output_data: null, error_message: null, progress: 20 }
    const onJobProgress = vi.fn()
    const ctx = makeCtx({ onJobProgress })

    const settled: Array<{ ok: boolean; value: unknown }> = []
    const running = executeNode(vaNode(), {}, [], [vaNode()], {}, ctx).then(
      (v) => settled.push({ ok: true, value: v }),
      (e) => settled.push({ ok: false, value: e }),
    )

    await advance(1 * MINUTE)
    expect(onJobProgress).toHaveBeenCalledWith(JOB_ID, 20, false)

    jobRecord = { status: "pending_review", output_data: null, error_message: null, progress: 100 }
    await advance(10 * MINUTE)
    expect(onJobProgress).toHaveBeenCalledWith(JOB_ID, 100, true)
    expect(ctx.maxChildHeldMs ?? 0).toBeGreaterThanOrEqual(9 * MINUTE)

    jobRecord = {
      status: "completed",
      output_data: { analysis: "ok", text: "a summary" },
      error_message: null,
      progress: 100,
      credits_actual: 3,
    }
    await advance(1 * MINUTE)
    await running
    expect(settled[0].ok, String((settled[0].value as Error)?.message)).toBe(true)
  }, 30_000)
})
