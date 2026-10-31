// @test-reads-none an in-memory database double; reads no repo file
// Every existing sweep spares a job that waits for a concurrency slot (decided
// 2026-10-30: nothing fails for waiting). A waiting job is a `jobs` row in
// `queued`; a waiting run stays `pending` (an execution) or `queued` (a
// pipeline). The failure write itself (markJobFailed) accepts `queued`, so
// what spares a waiting row is each sweep's OWN selection — which is what
// these cases pin, by running the real sweep over an in-memory database that
// applies its filters.
//
// Every case has a positive control: a row like the spared one that differs
// in what the sweep judges — its status, its child's (or inner run's) status,
// or how stale its stamp is — and that the sweep DOES act on. Without it, a
// sweep that ignored a filter would pass here unnoticed.
//
// Not here: the concurrency lanes' own queued sweep (queued-sweep.ts), which
// is the one that DOES end a waiting job — at the queue timeout, in its own
// environment only; its suite proves both. Clocks that queued time can still
// outgrow (a run's 4-hour backstop, a coordinator's stuck sweep, a pipeline's
// 6-hour abandon) grow by the queued time in a later change: they are the
// `it.todo` cases below, and none can fail a job while enforcement is off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeSweepDb, type Row, type SweepDb } from "./fake-sweep-db.js"

const h = vi.hoisted(() => ({
  db: null as unknown as { client: { from(t: string): unknown; rpc(fn: string, args?: unknown): unknown } },
  /** BullMQ entries by id, as `getJob` finds them: id → state. */
  orchestration: new Map<string, string>(),
  pipelineJobs: new Map<string, string>(),
  refunds: [] as string[],
  pipelineRefunds: [] as string[],
  pipelineEnqueues: [] as string[],
  withdrawn: [] as string[],
}))

vi.mock("../../supabase.js", () => ({
  supabase: { from: (t: string) => h.db.client.from(t), rpc: (fn: string, args?: unknown) => h.db.client.rpc(fn, args) },
}))
vi.mock("../../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config.js")>()),
  hasCredits: () => false,
}))
// The reconcile cron's queue (only the gvp/evp resume reads it) — never a connection.
vi.mock("../../queue.js", () => ({
  redis: {},
  videoQueue: { getJob: async () => null, getJobs: async () => [], add: async () => ({ id: "x" }) },
}))
vi.mock("../../orchestration-queue.js", () => ({
  orchestrationQueue: {
    getJob: async (id: string) => (h.orchestration.has(id) ? { getState: async () => h.orchestration.get(id), attemptsMade: 0, failedReason: null } : null),
  },
}))
vi.mock("../../../ee/pipelines/queue.js", () => ({
  pipelineOrchestrationQueue: {
    getJob: async (id: string) => (h.pipelineJobs.has(id) ? { getState: async () => h.pipelineJobs.get(id) } : null),
  },
  enqueuePipelineRun: async (data: { pipelineId: string }) => { h.pipelineEnqueues.push(data.pipelineId) },
}))
vi.mock("../../../ee/pipelines/credits.js", () => ({
  refundPipelineCredits: async (args: { pipelineId: string }) => { h.pipelineRefunds.push(args.pipelineId) },
}))
vi.mock("../../../ee/pipelines/resume.js", () => ({ MAX_RESUME: 3 }))
vi.mock("../../access-blocks.js", () => ({
  isUserQuietStopped: async () => false,
  isUserBlocked: async () => false,
  QUIET_STOP_RECHECK_MS: 600_000,
}))
vi.mock("../../credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: async (jobId: string) => { h.refunds.push(jobId); return 0 },
  refundJobHoldsConfirmed: async () => true,
}))
// What a failure write does after it wins (both lazy, both best-effort).
vi.mock("../withdraw.js", () => ({ withdrawFromLane: async (jobId: string) => { h.withdrawn.push(jobId) } }))
vi.mock("../../mcp/flows/hydrate.js", () => ({ hydrateFlowNodeForJob: async () => undefined }))
// The lanes' own queued sweep (its suite) and the tick's passes over other
// populations (trend masks, review holds, use-case wrappers, cancelled jobs'
// holds, side holds — the last proven on its own below).
vi.mock("../queued-sweep.js", () => ({ sweepLaneQueuedJobs: async () => undefined, sweepLaneGhosts: async () => undefined }))
vi.mock("../../reconcile/trend-variant-anchor-sweep.js", () => ({ sweepIdleTrendVariantAnchors: async () => undefined }))
vi.mock("../../reconcile/hold-expiry.js", () => ({ sweepExpiredHolds: async () => ({ expired: 0, errors: 0 }) }))
vi.mock("../../reconcile/use-case-wrapper-sweep.js", () => ({
  sweepUseCaseWrappers: async () => ({ scanned: 0, swept: 0, recovered: 0, notStale: 0, errors: 0 }),
}))
vi.mock("../../reconcile/cancelled-metered-holds.js", () => ({ sweepCancelledMeteredHolds: async () => undefined }))
vi.mock("../../reconcile/side-llm-holds.js", () => ({ sweepSideLlmHolds: async () => undefined }))
// The orchestrator module's own runtime, which the boot sweep never reaches.
vi.mock("../../../services/workflow-engine/node-executor.js", () => ({
  executeNode: vi.fn(),
  loadCompletedFanOutIterations: vi.fn(async () => new Map()),
}))
vi.mock("../../reconcile/cancel-inflight-jobs.js", () => ({
  cancelInFlightChildJobs: vi.fn(async () => ({ cancelled: 0, adoptable: new Map() })),
}))
vi.mock("../../../services/execution-stats.js", () => ({ buildStatsKey: () => null, upsertExecutionStats: async () => undefined }))
vi.mock("../../admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => false }))

const { reconcileInflightJobs } = await import("../../reconcile/cron.js")
const { reconcileWorkflowExecutionsTick } = await import("../../reconcile/workflow-executions-cron.js")
const { cleanupStaleExecutions } = await import("../../../workers/orchestrator-worker.js")
const { collectAppExpungeTargets } = await import("../../app-expunge-targets.js")
const { reconcilePipelinesTick } = await import("../../../ee/pipelines/reconcile-cron.js")

const MIN = 60_000
const USER = "00000000-0000-4000-8000-0000000000a1"
const APP = "00000000-0000-4000-8000-0000000000a9"
const WORKFLOW = "00000000-0000-4000-8000-0000000000f1"
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

let db: SweepDb

/** A jobs row as the sweeps read it; `over` sets what the case is about. */
function job(n: number, over: Row): Row {
  const r: Row = {
    id: id(n), user_id: USER, status: "pending", created_at: ago(2 * MIN), started_at: null,
    provider: null, provider_kind: null, provider_task_id: null, provider_call_started_at: null,
    reconcile_attempts: 0, reconcile_last_error: null, finalize_claimed_at: null, job_type: "generate-image",
    input_data: { type: "generate-image" }, output_data: null, parent_job_id: null, workflow_execution_id: null,
    pipeline_id: null, usage_log_id: null, lane_queued_at: null, ...over,
  }
  db.rows("jobs").push(r)
  return r
}

/** A workflow_executions row of this environment. */
function execution(n: number, over: Row): Row {
  const r: Row = {
    id: id(n), user_id: USER, workflow_id: WORKFLOW, status: "running", runtime_env: "staging",
    created_at: ago(30 * MIN), started_at: ago(30 * MIN), node_states: {}, trigger_type: "manual", trigger_data: null, ...over,
  }
  db.rows("workflow_executions").push(r)
  return r
}

const status = (table: string, n: number) => db.row(table, id(n))?.status
const jobWrites = () => db.writes.filter((w) => w.table === "jobs")

beforeEach(() => {
  db = makeSweepDb()
  h.db = db
  h.orchestration.clear()
  h.pipelineJobs.clear()
  h.refunds.length = 0
  h.pipelineRefunds.length = 0
  h.pipelineEnqueues.length = 0
  h.withdrawn.length = 0
  vi.stubEnv("RUNTIME_ENV", "staging")
  vi.spyOn(console, "log").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// ------------------------------------------------------------ reconcile tick

describe("the job reconcile tick (lib/reconcile/cron.ts)", () => {
  it("the never-started sweep spares a job waiting for its slot past its 30 minutes", async () => {
    job(1, { status: "queued", created_at: ago(45 * MIN), lane_queued_at: ago(44 * MIN) })
    job(2, { status: "pending", created_at: ago(45 * MIN) }) // control: never started, not waiting
    await reconcileInflightJobs()
    expect(status("jobs", 1)).toBe("queued")
    expect(status("jobs", 2)).toBe("failed")
    expect(h.refunds).toEqual([id(2)])
  })

  it("the main scan spares a waiting job whatever provider stamp it carries", async () => {
    // A waiting job never had a provider call, but even a stale stamp left on it does not bring it in.
    job(1, { status: "queued", provider_kind: "elevenlabs-sync", provider_call_started_at: ago(60 * MIN), lane_queued_at: ago(61 * MIN) })
    job(2, { status: "processing", provider_kind: "elevenlabs-sync", provider_call_started_at: ago(60 * MIN), started_at: ago(61 * MIN) })
    await reconcileInflightJobs()
    expect(status("jobs", 1)).toBe("queued")
    expect(status("jobs", 2)).toBe("failed")
  })

  it("the pre-task sentinel spares a waiting job, and a running parent whose children wait", async () => {
    // Admission runs before the pickup claim, so a refused job is never stamped
    // `pre-task` (video-worker.test.ts: a parked job is never set processing);
    // a stale stamp on a `queued` row is still not read.
    job(1, { status: "queued", provider_kind: "pre-task", provider_call_started_at: ago(40 * MIN), lane_queued_at: ago(41 * MIN) })
    // A running coordinator (heartbeat fresh) whose two children have waited 45 minutes.
    job(2, { status: "processing", provider_kind: "pre-task", provider_call_started_at: ago(1 * MIN), started_at: ago(50 * MIN), job_type: "generate-video-pro" })
    job(3, { status: "queued", parent_job_id: id(2), created_at: ago(45 * MIN), lane_queued_at: ago(45 * MIN) })
    job(4, { status: "queued", parent_job_id: id(2), created_at: ago(45 * MIN), lane_queued_at: ago(45 * MIN) })
    // Control: a running job whose sentinel went stale (its worker died).
    job(5, { status: "processing", provider_kind: "pre-task", provider_call_started_at: ago(40 * MIN), started_at: ago(41 * MIN) })
    await reconcileInflightJobs()
    expect([1, 2, 3, 4].map((n) => status("jobs", n))).toEqual(["queued", "processing", "queued", "queued"])
    expect(status("jobs", 5)).toBe("failed")
    expect(jobWrites().flatMap((w) => w.ids)).toEqual([id(5)])
  })

  it("the component-wrapper sweep spares a wrapper whose inner run waits to start", async () => {
    execution(10, { status: "pending", started_at: null, created_at: ago(100 * MIN) })
    execution(11, { status: "failed" })
    job(1, { status: "processing", provider: "component", started_at: ago(100 * MIN), input_data: { type: "component", _executionId: id(10) } })
    job(2, { status: "processing", provider: "component", started_at: ago(100 * MIN), input_data: { type: "component", _executionId: id(11) } })
    await reconcileInflightJobs()
    expect(status("jobs", 1)).toBe("processing")
    expect(status("jobs", 2)).toBe("failed")
  })

  it.todo("the stuck-orchestrator sweep spares a director whose children were queued: its 90 minutes grow by the row's lane_wait_ms")
})

// --------------------------------------------------------------- side holds

describe("the side-LLM-hold sweep (ee/billing/llm-side-hold-impl.ts)", () => {
  it("never reads or writes a job, and leaves a running parent's hold while its children wait", async () => {
    const { sweepSideHoldsImpl } = await import("../../../ee/billing/llm-side-hold-impl.js")
    job(1, { status: "queued", lane_queued_at: ago(30 * MIN) })
    job(2, { status: "processing", started_at: ago(20 * MIN) })
    job(3, { status: "queued", parent_job_id: id(2), lane_queued_at: ago(19 * MIN) })
    const hold = (n: number, over: Row): Row => ({
      usage_log_id: id(n), job_id: id(2), charge_id: "ugc-frame-check:gemini-3.8-flash", hold_credits: 4, pre_call: false,
      call_started_at: ago(5 * MIN), closed_at: null, ledger: null, settled_at: null, sweep_attempts: 0, sweep_billed: false,
      created_at: ago(6 * MIN), usage_logs: { status: "reserved", credits_used: 4 }, ...over,
    })
    // The parent's call, in flight; control: a hold its log already settled.
    db.rows("llm_side_holds").push(hold(100, {}), hold(101, { usage_logs: { status: "refunded", credits_used: 4 } }))
    const r = { scanned: 0, settled: 0, notStale: 0, retried: 0, errors: 0 }
    await sweepSideHoldsImpl(r, { graceMs: 120 * MIN, limit: 500 })
    expect(r).toMatchObject({ scanned: 2, notStale: 1, settled: 1, errors: 0 })
    expect(db.rows("llm_side_holds").find((x) => x.usage_log_id === id(100))?.closed_at).toBeNull()
    expect(db.reads).not.toContain("jobs")
    expect(jobWrites()).toEqual([])
    expect([1, 2, 3].map((n) => status("jobs", n))).toEqual(["queued", "processing", "queued"])
  })

  it.todo("a toolkit call that waits for its slot opens its side hold only once admitted, so a long wait never settles a hold whose call has not run")
})

// ------------------------------------------------------ workflow executions

describe("the workflow-executions cron (lib/reconcile/workflow-executions-cron.ts)", () => {
  it("a run whose node's job waits is neither finished nor called orphaned", async () => {
    execution(10, { node_states: { n1: { status: "running", jobId: id(1), startedAt: ago(9 * MIN) } } })
    job(1, { status: "queued", workflow_execution_id: id(10), lane_queued_at: ago(9 * MIN), input_data: { type: "generate-image", node_id: "n1" } })
    // Control: the same run whose node's job is gone, with no orchestrator job.
    execution(11, { node_states: { n1: { status: "running", jobId: id(2), startedAt: ago(9 * MIN) } } })
    await reconcileWorkflowExecutionsTick()
    expect(status("workflow_executions", 10)).toBe("running")
    expect(status("workflow_executions", 11)).toBe("failed")
    expect(status("jobs", 1)).toBe("queued")
  })

  it("a run whose node's job waits is not failed beside a sibling that failed", async () => {
    execution(10, {
      node_states: {
        n1: { status: "running", jobId: id(1), startedAt: ago(9 * MIN) },
        n2: { status: "running", jobId: id(2), startedAt: ago(9 * MIN) },
      },
    })
    job(1, { status: "queued", workflow_execution_id: id(10), lane_queued_at: ago(9 * MIN) })
    job(2, { status: "failed", workflow_execution_id: id(10) })
    // Control: no node still waiting → the failure is the run's.
    execution(11, { node_states: { n1: { status: "running", jobId: id(3), startedAt: ago(9 * MIN) } } })
    job(3, { status: "failed", workflow_execution_id: id(11) })
    await reconcileWorkflowExecutionsTick()
    expect(status("workflow_executions", 10)).toBe("running")
    expect(status("workflow_executions", 11)).toBe("failed")
  })

  it("a run waiting to start (pending, lane-stamped) is never scanned", async () => {
    execution(10, { status: "pending", started_at: ago(3 * 60 * MIN), lane_queued_at: ago(3 * 60 * MIN) })
    execution(11, { status: "running", started_at: ago(3 * 60 * MIN) }) // control: only the status differs
    await reconcileWorkflowExecutionsTick()
    expect(status("workflow_executions", 10)).toBe("pending")
    expect(status("workflow_executions", 11)).toBe("failed")
  })

  it.todo("the 4-hour backstop of a run grows by the run's queued time (lane_wait_ms)")
})

describe("the orchestrator boot sweep (workers/orchestrator-worker.ts cleanupStaleExecutions)", () => {
  it("a run whose node's job waits is left for its orchestrator", async () => {
    execution(10, { node_states: { n1: { status: "running", jobId: id(1) } } })
    job(1, { status: "queued", workflow_execution_id: id(10), lane_queued_at: ago(20 * MIN) })
    execution(11, { node_states: { n1: { status: "running", jobId: id(2) } } }) // control
    job(2, { status: "failed", workflow_execution_id: id(11) })
    await cleanupStaleExecutions()
    expect(status("workflow_executions", 10)).toBe("running")
    expect(status("workflow_executions", 11)).toBe("failed")
    expect(status("jobs", 1)).toBe("queued")
  })

  it("a run waiting to start is never scanned", async () => {
    execution(10, { status: "pending", started_at: null, lane_queued_at: ago(20 * MIN) })
    execution(11, { status: "running", started_at: null }) // control: "never claimed" — abandoned
    await cleanupStaleExecutions()
    expect(status("workflow_executions", 10)).toBe("pending")
    expect(status("workflow_executions", 11)).toBe("failed")
  })
})

// ------------------------------------------------------------- app expunge

describe("app-expunge targets (lib/app-expunge-targets.ts)", () => {
  function run(n: number, executionNo: number): void {
    db.rows("app_runs").push({ id: id(n), app_id: APP, runner_id: USER, execution_id: id(executionNo), final_execution_id: null })
  }

  it("a run with a waiting job is skipped, even when its execution is past the stale backstop", async () => {
    run(20, 10)
    execution(10, { status: "running", started_at: ago(5 * 60 * MIN), trigger_type: "app" })
    job(1, { status: "queued", workflow_execution_id: id(10), lane_queued_at: ago(10 * MIN) })
    run(21, 11) // control: the same run whose job has finished
    execution(11, { status: "running", started_at: ago(5 * 60 * MIN), trigger_type: "app" })
    job(2, { status: "completed", workflow_execution_id: id(11) })
    const targets = await collectAppExpungeTargets(APP, WORKFLOW)
    expect(targets.skippedRunIds).toEqual([id(20)])
    expect(targets.runIds).toEqual([id(21)])
  })

  it("a run whose execution waits to start is skipped", async () => {
    run(20, 10)
    execution(10, { status: "pending", started_at: null, created_at: ago(30 * MIN), trigger_type: "app" })
    run(21, 11) // control
    execution(11, { status: "failed", started_at: null, created_at: ago(30 * MIN), trigger_type: "app" })
    const targets = await collectAppExpungeTargets(APP, WORKFLOW)
    expect(targets.skippedRunIds).toEqual([id(20)])
    expect(targets.runIds).toEqual([id(21)])
  })
})

// -------------------------------------------------------------- pipelines

describe("the pipelines reconcile (ee/pipelines/reconcile-cron.ts)", () => {
  function pipeline(n: number, over: Row): void {
    db.rows("pipelines").push({ id: id(n), user_id: USER, status: "running", created_at: ago(7 * 60 * MIN), ...over })
  }

  it("a pipeline waiting for its run slot is never scanned", async () => {
    pipeline(30, { status: "queued", lane_queued_at: ago(7 * 60 * MIN) })
    pipeline(31, {}) // control: running, past 6 hours, no drive → abandoned
    await reconcilePipelinesTick()
    expect(status("pipelines", 30)).toBe("queued")
    expect(status("pipelines", 31)).toBe("failed")
    expect(h.pipelineRefunds).toEqual([id(31)])
  })

  it("a running pipeline whose drive polls a waiting stage job is left alone", async () => {
    pipeline(30, { created_at: ago(60 * MIN) })
    h.pipelineJobs.set(`pipeline-${id(30)}`, "active")
    job(1, { status: "queued", pipeline_id: id(30), lane_queued_at: ago(40 * MIN) })
    pipeline(31, { created_at: ago(60 * MIN) }) // control: no drive → re-driven
    await reconcilePipelinesTick()
    expect(status("pipelines", 30)).toBe("running")
    expect(h.pipelineEnqueues).toEqual([id(31)])
    expect(status("jobs", 1)).toBe("queued")
  })

  it.todo("the 6-hour abandon is measured from admission plus the pipeline's queued time, and a parked drive's delayed entry counts as presence")
})
