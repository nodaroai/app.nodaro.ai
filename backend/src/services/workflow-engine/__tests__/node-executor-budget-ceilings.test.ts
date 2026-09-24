/**
 * Podcast Track 0.11 — budget-aware caps, at the node executor.
 *
 * THE BUG THIS PINS: a final-quality apply-edl render inside a workflow (the
 * shipped Tighten Episode / Clip Pack templates render `quality: "final"` in
 * the DAG) was cancelled at 90 minutes by `pollJobToCompletion`'s flat clocks
 * — `NODE_TIMEOUT_MS` (processing) and `POLL_ABSOLUTE_TIMEOUT_MS` (queue wait
 * included) — while its worker, whose heartbeat beats for the handler's own
 * declared budget, kept rendering. The decided rule: a node that declares a
 * budget gets node/poll timeouts = its budget, and the workflow cap grows by
 * the same excess; everything else keeps today's limits exactly.
 *
 * Harness mirrors node-executor-held-job.test.ts: only the external boundaries
 * (Supabase, CreditsService, BullMQ, fetch) are faked, so the real dispatch,
 * the real `buildPayload` apply-edl case and the real poll loop run.
 *
 * Which clock NAMES the timeout: the poll ceiling and the processing ceiling
 * are equal (both 90 min + the same excess) and the poll clock starts first
 * (processing starts at pickup), so the poll check is the one that fires —
 * today as before. The processing ceiling is still pinned: were it left at a
 * flat 90 minutes, it would fire at minute 90 while the poll ceiling waited,
 * and "still running past minute 90" below would fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"

const { mockCheckCredits, mockReserveCredits, mockVideoAdd, mockRenderAdd, mockRefund } = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockVideoAdd: vi.fn(),
  mockRenderAdd: vi.fn(),
  mockRefund: vi.fn(),
}))

const JOB_ID = "job-budget-1"

const db = vi.hoisted(() => ({
  /** The row every status poll reads (the node's job, or a component wrapper). */
  jobRecord: {} as Record<string, unknown>,
  /** `input_data` of the component wrapper job. */
  wrapperInput: {} as Record<string, unknown>,
  /** `jobs` rows of the component's inner execution (the budget scan). */
  innerJobs: [] as Array<Record<string, unknown>>,
  executionStatus: "running",
  jobUpdates: [] as Array<Record<string, unknown>>,
}))

vi.mock("../../../lib/supabase.js", () => {
  function builder(table: string) {
    let op: "select" | "insert" | "update" | "delete" | null = null
    let columns = ""
    const filters: Record<string, unknown> = {}
    const b: Record<string, unknown> = {}
    b.select = (c?: string) => { if (op === null) { op = "select"; columns = c ?? "" } return b }
    b.eq = (col: string, v: unknown) => { filters[`eq:${col}`] = v; return b }
    b.in = (col: string, v: unknown) => { filters[`in:${col}`] = v; return b }
    for (const m of ["not", "order", "limit", "is", "neq"]) b[m] = () => b
    b.insert = () => { op = "insert"; return b }
    b.update = (patch: Record<string, unknown>) => { op = "update"; if (table === "jobs") db.jobUpdates.push(patch); return b }
    b.delete = () => { op = "delete"; return b }
    const one = () => {
      if (table === "jobs") {
        if (op === "insert") return { data: { id: JOB_ID }, error: null }
        if (columns === "input_data") return { data: { input_data: db.wrapperInput }, error: null }
        return { data: db.jobRecord, error: null }
      }
      if (table === "workflow_executions" && columns === "node_states") return { data: { node_states: {} }, error: null }
      return { data: { status: db.executionStatus }, error: null }
    }
    const many = () => {
      if (table === "jobs" && op === "update") {
        return { data: [{ id: JOB_ID, user_id: "user-1", provider_task_id: null }], error: null }
      }
      if (table === "jobs" && op === "select" && filters["eq:workflow_execution_id"] !== undefined) {
        const names = filters["in:job_type"] as string[] | undefined
        return { data: names ? db.innerJobs.filter((r) => names.includes(r.job_type as string)) : [], error: null }
      }
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
vi.mock("../../../ee/billing/service-margin.js", () => ({ applyServiceMarkup: (n: number) => n }))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: mockVideoAdd } }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: mockRenderAdd } }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: mockRefund }))
vi.mock("../../../lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: vi.fn(async () => 0) }))
vi.mock("../../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ cost_markup_percent: 0 }),
}))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))

import { executeNode } from "../node-executor.js"
import { NODE_TIMEOUT_MS, POLL_ABSOLUTE_TIMEOUT_MS } from "../types.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"
import { BUDGETED_JOB_NAMES, declaredJobBudgetMs } from "../../../lib/job-budget.js"
import { applyEdlRenderBudgetMs } from "../../../providers/video/apply-edl-budget.js"

const MINUTE = 60_000

/** `minutes` one-minute hard cuts on one source — an n-minute video edit. */
function edl(minutes: number): Edl {
  const segments = Array.from({ length: minutes }, (_, i) => ({
    id: `s${i}`, inMs: i * MINUTE, outMs: (i + 1) * MINUTE, video: "A",
  })) as EdlSegment[]
  return {
    version: 1,
    clock: "master",
    sources: [{ id: "A", url: "https://media.test/episode.mp4", kind: "video" }],
    segments,
  } as unknown as Edl
}

function applyEdlNode(minutes: number): SimpleNode {
  return { id: "cut", type: "apply-edl", data: { edl: edl(minutes), output: "video", quality: "final" } }
}
function vaNode(): SimpleNode {
  return { id: "va", type: "video-analysis", data: { youtubeUrl: "https://youtu.be/abc123" } }
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

/** The timeout a budgeted node reports: either clock, naming the budget. */
const timeoutNaming = (ms: number) =>
  new RegExp(`^(Node timeout after ${ms / 1000}s of processing|Poll timeout: job did not complete within ${ms / 1000}s \\(may still be pending in queue\\))$`)
/** Today's message for an unbudgeted node that is processing — byte-identical. */
const TODAY_TIMEOUT = "Poll timeout: job did not complete within 5400s (may still be pending in queue)"

/** Advance fake time in poll-sized bites so the loop actually iterates. */
async function advance(ms: number): Promise<void> {
  const STEP = 5 * MINUTE
  for (let left = ms; left > 0; left -= STEP) {
    await vi.advanceTimersByTimeAsync(Math.min(STEP, left))
  }
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

beforeEach(() => {
  vi.clearAllMocks()
  db.jobUpdates = []
  db.innerJobs = []
  db.wrapperInput = {}
  db.executionStatus = "running"
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50_000, watermark: false })
  mockReserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 30, watermark: false })
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("a node that declares no budget keeps today's ceilings EXACTLY", () => {
  it("processing times out at 90 minutes with today's message, and the run's cap is untouched", async () => {
    db.jobRecord = { status: "processing", output_data: null, error_message: null, progress: 10 }
    const ctx = makeCtx()
    const { settled, done } = run(vaNode(), ctx)

    await advance(89 * MINUTE)
    expect(settled).toHaveLength(0)
    await advance(2 * MINUTE)
    await done

    expect(settled[0].ok).toBe(false)
    expect((settled[0].value as Error).message).toBe(TODAY_TIMEOUT)
    expect(TODAY_TIMEOUT).toMatch(timeoutNaming(NODE_TIMEOUT_MS))
    expect(cancelled()).toHaveLength(1)
    expect("budgetExcessMs" in ctx).toBe(false)
  }, 30_000)

  it("an apply-edl whose budget fits inside 90 minutes: the default ceilings too", async () => {
    const node = applyEdlNode(5)
    expect(applyEdlRenderBudgetMs(edl(5))).toBeLessThanOrEqual(NODE_TIMEOUT_MS)
    db.jobRecord = { status: "processing", output_data: null, error_message: null, progress: 10 }
    const ctx = makeCtx()
    const { settled, done } = run(node, ctx)

    await advance(91 * MINUTE)
    await done
    expect((settled[0].value as Error).message).toBe(TODAY_TIMEOUT)
    expect("budgetExcessMs" in ctx).toBe(false)
  }, 30_000)
})

describe("an apply-edl node with a long EDL runs under its declared budget", () => {
  // 25 one-minute cuts: one video chunk, a budget of ~3 hours.
  const MINUTES = 25

  it("processing ceiling = the budget the worker's handler declares for the SAME payload; the run's cap grows by the excess", async () => {
    const node = applyEdlNode(MINUTES)
    db.jobRecord = { status: "processing", output_data: null, error_message: null, progress: 10 }
    const ctx = makeCtx()
    const { settled, done } = run(node, ctx)
    await advance(1 * MINUTE)

    // Dispatched under its own name — the registry key IS the node type, so a
    // `jobs` row resolves to the same budget before pickup (job_type =
    // node.type) and after it (job_type = job.name).
    expect(mockVideoAdd).toHaveBeenCalledTimes(1)
    const [jobName, payload] = mockVideoAdd.mock.calls[0] as [string, Record<string, unknown>]
    expect(jobName).toBe(node.type)
    const budget = declaredJobBudgetMs(jobName, payload)!
    expect(budget).toBe(applyEdlRenderBudgetMs(payload.edl as Edl, { output: "video" }))
    expect(budget).toBeGreaterThan(NODE_TIMEOUT_MS + 60 * MINUTE)
    expect(ctx.budgetExcessMs).toBe(budget - NODE_TIMEOUT_MS)

    // Past the flat 90-minute ceiling: still running, nothing cancelled.
    await advance(94 * MINUTE)
    expect(settled).toHaveLength(0)
    expect(cancelled()).toHaveLength(0)

    // Just short of the budget: still running.
    await advance(budget - 95 * MINUTE - 1 * MINUTE)
    expect(settled).toHaveLength(0)

    // Past the budget: cancelled, and the message names the budget.
    await advance(2 * MINUTE)
    await done
    expect(settled[0].ok).toBe(false)
    expect((settled[0].value as Error).message).toMatch(timeoutNaming(budget))
    expect(cancelled()).toHaveLength(1)
  }, 60_000)

  it("a job that never leaves the queue: poll ceiling = POLL_ABSOLUTE_TIMEOUT_MS + the same excess", async () => {
    const node = applyEdlNode(MINUTES)
    db.jobRecord = { status: "pending", output_data: null, error_message: null, progress: 0 }
    const ctx = makeCtx()
    const { settled, done } = run(node, ctx)
    await advance(1 * MINUTE)
    const budget = declaredJobBudgetMs("apply-edl", mockVideoAdd.mock.calls[0][1])!
    const pollCeiling = POLL_ABSOLUTE_TIMEOUT_MS + (budget - NODE_TIMEOUT_MS)

    await advance(94 * MINUTE)
    expect(settled).toHaveLength(0)
    await advance(pollCeiling - 95 * MINUTE + 1 * MINUTE)
    await done
    expect((settled[0].value as Error).message).toBe(
      `Poll timeout: job did not complete within ${pollCeiling / 1000}s (may still be pending in queue)`,
    )
  }, 60_000)

  it("a completed long render returns its output and leaves the excess on the run's cap", async () => {
    const node = applyEdlNode(MINUTES)
    db.jobRecord = { status: "processing", output_data: null, error_message: null, progress: 10 }
    const ctx = makeCtx({ budgetExcessMs: 5 * MINUTE })
    const { settled, done } = run(node, ctx)
    await advance(100 * MINUTE)
    db.jobRecord = { status: "completed", output_data: { videoUrl: "https://out.test/cut.mp4" }, error_message: null, progress: 100, credits_actual: 30 }
    await advance(1 * MINUTE)
    await done
    expect(settled[0].ok, String((settled[0].value as Error)?.message)).toBe(true)
    const budget = declaredJobBudgetMs("apply-edl", mockVideoAdd.mock.calls[0][1])!
    // Summed onto what the run already had (sequential renders add up).
    expect(ctx.budgetExcessMs).toBe(5 * MINUTE + budget - NODE_TIMEOUT_MS)
  }, 60_000)
})

describe("an ADOPTED in-flight job (orchestrator resume) polls under the budget its row declares", () => {
  it("not cancelled at minute 90, and the resumed run's cap grows by the same excess", async () => {
    const budget = 4 * 60 * MINUTE
    db.jobRecord = { status: "processing", output_data: null, error_message: null, progress: 50 }
    const ctx = makeCtx({ adoptableJobs: new Map([["cut", { jobId: JOB_ID, budgetMs: budget }]]) })
    const { settled, done } = run(applyEdlNode(25), ctx)
    await advance(95 * MINUTE)
    expect(settled).toHaveLength(0)
    expect(mockVideoAdd).not.toHaveBeenCalled() // adopted, not re-dispatched
    expect(ctx.budgetExcessMs).toBe(budget - NODE_TIMEOUT_MS)
    db.jobRecord = { status: "completed", output_data: { videoUrl: "https://out.test/cut.mp4" }, error_message: null, progress: 100 }
    await advance(1 * MINUTE)
    await done
    expect(settled[0].ok).toBe(true)
  }, 30_000)
})

describe("every registered budgeted job is dispatched under its node type's own name", () => {
  // A registry entry is keyed by BullMQ job name, and a `jobs` row carries the
  // NODE type in `job_type` until the video worker's pickup overwrites it with
  // the job name. The row readers (stale sweeps, component waits) therefore
  // need the two to be the same string for every budgeted type.
  const FIXTURES: Record<string, () => SimpleNode> = { "apply-edl": () => applyEdlNode(3) }

  it("has a dispatch fixture for every registered name, and each dispatches as its node type", async () => {
    for (const name of BUDGETED_JOB_NAMES) {
      const make = FIXTURES[name]
      expect(make, `add a dispatch fixture for budgeted job "${name}"`).toBeTypeOf("function")
      mockVideoAdd.mockClear()
      db.jobRecord = { status: "completed", output_data: { videoUrl: "https://out.test/x.mp4" }, error_message: null, progress: 100 }
      const node = make()
      const { done } = run(node, makeCtx())
      await advance(1 * MINUTE)
      await done
      expect(mockVideoAdd.mock.calls[0]?.[0]).toBe(node.type)
      expect(node.type).toBe(name)
    }
  }, 30_000)
})

describe("a component node waits COMPONENT_TIMEOUT_MS + its inner execution's excess", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ jobId: "wrap-1" }) })))
  })

  it("nothing budgeted inside: times out at 90 minutes with today's message", async () => {
    db.jobRecord = { status: "processing", output_data: null, error_message: null, progress: 10 }
    db.wrapperInput = { _executionId: "inner-1" }
    const ctx = makeCtx()
    const { settled, done } = run(componentNode(), ctx)
    await advance(89 * MINUTE)
    expect(settled).toHaveLength(0)
    await advance(2 * MINUTE)
    await done
    expect((settled[0].value as Error).message).toBe("Component execution timed out after 90 minutes")
    expect("budgetExcessMs" in ctx).toBe(false)
  }, 30_000)

  it("an inner long render: not abandoned at minute 90; on completion the parent's cap grows by the inner excess", async () => {
    const innerRow = { job_type: "apply-edl", input_data: { edl: edl(25), output: "video", type: "apply-edl" } }
    const innerExcess = declaredJobBudgetMs("apply-edl", innerRow.input_data)! - NODE_TIMEOUT_MS
    expect(innerExcess).toBeGreaterThan(30 * MINUTE)
    db.innerJobs = [innerRow]
    db.wrapperInput = { _executionId: "inner-1" }
    db.jobRecord = { status: "processing", output_data: null, error_message: null, progress: 40 }
    const ctx = makeCtx()
    const { settled, done } = run(componentNode(), ctx)

    await advance(90 * MINUTE + innerExcess - 5 * MINUTE)
    expect(settled).toHaveLength(0)

    db.jobRecord = { status: "completed", output_data: { _executionId: "inner-1" }, error_message: null, progress: 100, credits_actual: 30 }
    await advance(1 * MINUTE)
    await done
    expect(settled[0].ok, String((settled[0].value as Error)?.message)).toBe(true)
    expect(ctx.budgetExcessMs).toBe(innerExcess)
  }, 60_000)

  it("a component that finishes INSIDE 90 minutes still grows the parent's cap by its inner excess (as a direct long render would)", async () => {
    const innerRow = { job_type: "apply-edl", input_data: { edl: edl(25), output: "video", type: "apply-edl" } }
    const innerExcess = declaredJobBudgetMs("apply-edl", innerRow.input_data)! - NODE_TIMEOUT_MS
    db.innerJobs = [innerRow]
    db.jobRecord = { status: "processing", output_data: null, error_message: null, progress: 40 }
    const ctx = makeCtx()
    const { settled, done } = run(componentNode(), ctx)
    await advance(30 * MINUTE)
    db.jobRecord = { status: "completed", output_data: { _executionId: "inner-1" }, error_message: null, progress: 100, credits_actual: 30 }
    await advance(1 * MINUTE)
    await done
    expect(settled[0].ok).toBe(true)
    expect(ctx.budgetExcessMs).toBe(innerExcess)
  }, 30_000)

  it("an inner long render past its grown limit still times out — naming the grown limit", async () => {
    const innerRow = { job_type: "apply-edl", input_data: { edl: edl(25), output: "video", type: "apply-edl" } }
    const innerExcess = declaredJobBudgetMs("apply-edl", innerRow.input_data)! - NODE_TIMEOUT_MS
    db.innerJobs = [innerRow]
    db.wrapperInput = { _executionId: "inner-1" }
    db.jobRecord = { status: "processing", output_data: null, error_message: null, progress: 40 }
    const { settled, done } = run(componentNode(), makeCtx())
    await advance(90 * MINUTE + innerExcess + 1 * MINUTE)
    await done
    expect((settled[0].value as Error).message).toBe(
      `Component execution timed out after ${Math.round((90 * MINUTE + innerExcess) / MINUTE)} minutes`,
    )
  }, 60_000)
})
