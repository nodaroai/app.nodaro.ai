/**
 * Podcast Track 0.11 — the orchestrator's workflow cap grows by the excess of
 * the long renders the run dispatched; a run with nothing budgeted keeps 120
 * minutes exactly. Drives the REAL `runOrchestratorJob` level loop (harness
 * mirrors orchestrator-drain.test.ts: only leaf I/O mocked). The mocked
 * `executeNode` stands in for the node executor, which grows
 * `ctx.budgetExcessMs` at dispatch — that half is pinned for real in
 * services/workflow-engine/__tests__/node-executor-budget-ceilings.test.ts.
 *
 * Also pins the boot sweep's abandon threshold (4 h + the run's excess, the
 * same line the 90-s cron draws).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob, OrchestratorContext } from "../../services/workflow-engine/types.js"

const MIN = 60_000

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  let executeNodeImpl: (nodeId: string, ctx: Record<string, unknown>) => Promise<unknown> =
    async () => ({ output: { text: "x" }, creditsUsed: 0 })
  const executeNode = vi.fn(async (node: { id: string }, ...rest: unknown[]) => {
    executeNodeCalls.push(node.id)
    return executeNodeImpl(node.id, rest[4] as Record<string, unknown>)
  })
  const executionWrites: Array<{ id: string; updates: Record<string, unknown> }> = []
  let workflowRow: Record<string, unknown> | null = null
  let staleRows: Array<Record<string, unknown>> = []
  let queueJobState: string | null = null
  const budgetExcess = new Map<string, number>()
  const budgetReads: string[] = []

  function makeChain(table: string, columns?: string) {
    const rowResult = (() => {
      if (table === "workflows") return { data: workflowRow, error: workflowRow ? null : { message: "nf" } }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states")
        return { data: { status: "queued", node_states: {} }, error: null }
      return { data: null, error: null }
    })()
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: vi.fn(self), eq: vi.fn(self), or: vi.fn(self), is: vi.fn(self), in: vi.fn(self),
      neq: vi.fn(self), order: vi.fn(self),
      single: vi.fn().mockResolvedValue(rowResult),
      maybeSingle: vi.fn().mockResolvedValue(rowResult),
      limit: vi.fn().mockResolvedValue({ data: staleRows, error: null }),
    })
    return chain
  }
  const from = vi.fn((table: string) => ({
    select: (columns?: string) => (makeChain(table, columns) as { select: (c?: string) => unknown }).select(columns),
    update: () => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    insert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
  }))
  const getJob = vi.fn(async () => (queueJobState === null ? null : { getState: async () => queueJobState }))
  const updateExecutionWithRetry = vi.fn(async (id: string, updates: Record<string, unknown>) => {
    executionWrites.push({ id, updates })
    return { ok: true, cancelledRace: false, attempts: 1 }
  })

  return {
    executeNode, executeNodeCalls, executionWrites, from, getJob, updateExecutionWithRetry,
    budgetExcess, budgetReads,
    setExecuteNodeImpl: (fn: typeof executeNodeImpl) => { executeNodeImpl = fn },
    setWorkflowRow: (row: Record<string, unknown> | null) => { workflowRow = row },
    setStaleRows: (rows: Array<Record<string, unknown>>) => { staleRows = rows },
    setQueueJobState: (state: string | null) => { queueJobState = state },
    reset: () => {
      executeNodeCalls.length = 0
      executionWrites.length = 0
      staleRows = []
      queueJobState = null
      budgetExcess.clear()
      budgetReads.length = 0
      executeNodeImpl = async () => ({ output: { text: "x" }, creditsUsed: 0 })
    },
  }
})

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", ORCHESTRATOR_CONCURRENCY: 2, MAX_CONCURRENT_NODES_PER_EXECUTION: 12 },
  hasCredits: () => false,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/services/workflow-engine/node-executor.js", () => ({
  executeNode: mocks.executeNode,
  loadCompletedFanOutIterations: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock("@/lib/reconcile/node-states.js", () => ({
  reconcileNodeStatesFromJobs: vi.fn(async (states: unknown) => ({ next: states, changed: false })),
}))
vi.mock("@/lib/reconcile/cancel-inflight-jobs.js", () => ({
  cancelInFlightChildJobs: vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() }),
}))
vi.mock("@/lib/execution-writes.js", () => ({ updateExecutionWithRetry: mocks.updateExecutionWithRetry }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { getJob: mocks.getJob } }))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/execution-budget.js", () => ({
  executionBudgetExcessMs: async (id: string) => {
    mocks.budgetReads.push(id)
    return mocks.budgetExcess.get(id) ?? 0
  },
}))

import { runOrchestratorJob, cleanupStaleExecutions } from "../orchestrator-worker.js"
import { cancelInFlightChildJobs } from "@/lib/reconcile/cancel-inflight-jobs.js"

/** Two chained worker nodes → two levels, so the cap is checked between them. */
function makeJob(): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      { id: "cut", type: "generate-image", data: { prompt: "x" } },
      { id: "after", type: "generate-image", data: { prompt: "y" } },
    ],
    edges: [{ id: "e1", source: "cut", target: "after" }],
    settings: {},
    user_id: "owner-1",
  })
  return {
    data: { executionId: "exec-1", workflowId: "wf-1", userId: "owner-1", triggerType: "manual" },
    moveToDelayed: vi.fn(),
  } as unknown as Job<WorkflowExecutionJob>
}

const timedOut = () =>
  mocks.executionWrites.filter((w) => w.updates.status === "failed" && w.updates.error_message === "Workflow execution timed out")

describe("orchestrator workflow cap — WORKFLOW_TIMEOUT_MS + the run's budget excess", () => {
  beforeEach(() => {
    mocks.reset()
    vi.useFakeTimers({ toFake: ["Date"] })
  })
  afterEach(() => vi.useRealTimers())

  /** The first node takes `tookMs` of wall clock and (optionally) declares an
   *  excess the way the real executor does at dispatch. */
  function firstNodeTakes(tookMs: number, excessMs?: number) {
    mocks.setExecuteNodeImpl(async (nodeId, ctx) => {
      if (nodeId === "cut") {
        if (excessMs !== undefined) (ctx as unknown as OrchestratorContext).budgetExcessMs = excessMs
        vi.setSystemTime(Date.now() + tookMs)
      }
      return { output: { text: "x" }, creditsUsed: 0 }
    })
  }

  it("nothing budgeted: a run past 120 minutes still times out at the next level (today's cap, exactly)", async () => {
    firstNodeTakes(121 * MIN)
    await runOrchestratorJob(makeJob(), "tok")
    expect(mocks.executeNodeCalls).toEqual(["cut"])
    expect(timedOut()).toHaveLength(1)
  })

  it("nothing budgeted: 119 minutes is inside the cap", async () => {
    firstNodeTakes(119 * MIN)
    await runOrchestratorJob(makeJob(), "tok")
    expect(mocks.executeNodeCalls).toEqual(["cut", "after"])
    expect(timedOut()).toHaveLength(0)
  })

  it("a long render that grew the cap by 3 hours: a 4-hour run continues to its next level", async () => {
    firstNodeTakes(240 * MIN, 180 * MIN)
    await runOrchestratorJob(makeJob(), "tok")
    expect(mocks.executeNodeCalls).toEqual(["cut", "after"])
    expect(timedOut()).toHaveLength(0)
  })

  it("…but not past 120 minutes + the excess", async () => {
    firstNodeTakes(301 * MIN, 180 * MIN)
    await runOrchestratorJob(makeJob(), "tok")
    expect(mocks.executeNodeCalls).toEqual(["cut"])
    expect(timedOut()).toHaveLength(1)
  })
})

describe("orchestrator boot sweep — abandon threshold grows by the run's excess", () => {
  const HOUR = 60 * MIN
  beforeEach(() => mocks.reset())

  it("a 5-hour-old dead run with nothing budgeted is abandoned (unchanged)", async () => {
    mocks.setStaleRows([{ id: "exec-a", started_at: new Date(Date.now() - 5 * HOUR).toISOString(), node_states: { n: { status: "running" } } }])
    await cleanupStaleExecutions()
    expect(mocks.executionWrites).toHaveLength(1)
    expect(mocks.executionWrites[0].updates.error_message).toMatch(/abandoned/)
  })

  it("a 5-hour-old run whose long render added 2 hours is left for BullMQ's stall re-pick", async () => {
    mocks.setStaleRows([{ id: "exec-b", started_at: new Date(Date.now() - 5 * HOUR).toISOString(), node_states: { n: { status: "running" } } }])
    mocks.budgetExcess.set("exec-b", 2 * HOUR)
    await cleanupStaleExecutions()
    expect(mocks.budgetReads).toEqual(["exec-b"])
    expect(mocks.executionWrites).toHaveLength(0)
  })

  it("a young run never pays for the lookup", async () => {
    mocks.setStaleRows([{ id: "exec-c", started_at: new Date(Date.now() - 30 * MIN).toISOString(), node_states: { n: { status: "running" } } }])
    await cleanupStaleExecutions()
    expect(mocks.budgetReads).toEqual([])
    expect(mocks.executionWrites).toHaveLength(0)
  })
})

describe("orchestrator resume — a live budgeted render is re-attached, not restarted (Track 0.11 follow-up)", () => {
  beforeEach(() => mocks.reset())

  it("the resume asks cancelInFlightChildJobs to adopt live renders, and hands its adoptions to the node executor", async () => {
    const adopted = {
      jobId: "j-render",
      budgetMs: 4 * 60 * MIN,
      clocks: { dispatchedAtMs: Date.now() - 61 * MIN, processingStartedAtMs: Date.now() - 60 * MIN },
    }
    vi.mocked(cancelInFlightChildJobs).mockResolvedValueOnce({ cancelled: 0, adoptable: new Map([["cut", adopted]]) })
    let seen: OrchestratorContext["adoptableJobs"]
    mocks.setExecuteNodeImpl(async (nodeId, ctx) => {
      if (nodeId === "cut") seen = (ctx as unknown as OrchestratorContext).adoptableJobs
      return { output: { text: "x" }, creditsUsed: 0 }
    })

    await runOrchestratorJob(makeJob(), "tok")

    expect(cancelInFlightChildJobs).toHaveBeenCalledWith("exec-1", { adoptLiveBudgetedRenders: true })
    expect(seen?.get("cut")).toEqual(adopted)
  })
})
