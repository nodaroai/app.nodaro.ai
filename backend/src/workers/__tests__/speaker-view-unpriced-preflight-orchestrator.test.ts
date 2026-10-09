/**
 * THE PRE-RUN REFUSAL FOR AN UNPRICED SPEAKER VIEW — REAL orchestrator path.
 *
 * Speaker View has no price until C4 and its own dispatch refuses every run.
 * That refusal fires only when the DAG reaches the node, after Transcribe,
 * Edit Plan and Camera Switch upstream have run and charged for a render that
 * cannot succeed. The orchestrator refuses the whole execution before any node
 * dispatches, and names the node. Harness mirrors
 * transcribe-preflight-nested-orchestrator.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// Mocks — leaf I/O only.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  const executeNode = vi.fn(async (node: { id: string }) => {
    executeNodeCalls.push(node.id)
    return { output: { text: "x" }, creditsUsed: 0 }
  })

  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })

  /** The `workflows` table: id → row. The parent and every referenced graph. */
  const workflows = new Map<string, Record<string, unknown>>()
  /** Owner scoping of each nested (`nodes, edges`) load. */
  const nestedLoads: Array<{ id: unknown; userId: unknown }> = []
  const execSelectRow = { status: "queued", node_states: {} }

  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "workflows") {
        if (columns === "nodes, edges") nestedLoads.push({ id: filters.id, userId: filters.user_id })
        const row = workflows.get(filters.id as string)
        if (!row) return { data: null, error: { message: "nf" } }
        // The nested load is owner-scoped; an unscoped parent load has no filter.
        if (filters.user_id !== undefined && row.user_id !== filters.user_id) {
          return { data: null, error: { message: "nf" } }
        }
        return { data: row, error: null }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") {
        return { data: execSelectRow, error: null }
      }
      return { data: null, error: null }
    }
    const self = {
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return self
      },
      is: () => self,
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
    }
    return self
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) => chain(table, columns),
    update: () => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }))

  return { executeNode, executeNodeCalls, updateExecutionWithRetry, from, workflows, nestedLoads }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    REDIS_URL: "redis://localhost:6379",
    ORCHESTRATOR_CONCURRENCY: 2,
    MAX_CONCURRENT_NODES_PER_EXECUTION: 12,
  },
  hasCredits: () => false,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

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

vi.mock("@/lib/execution-writes.js", () => ({
  updateExecutionWithRetry: mocks.updateExecutionWithRetry,
}))

vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = "owner-1"

const SPEAKER_VIEW = { id: "sv1", type: "speaker-view", data: { label: "Speakers" } }

function makeJob(opts: { nested?: boolean; skipped?: boolean; subset?: string[]; type?: string } = {}): Job<WorkflowExecutionJob> {
  const base = opts.type ? { ...SPEAKER_VIEW, type: opts.type } : SPEAKER_VIEW
  const sv = opts.skipped ? { ...base, data: { ...base.data, skipped: true } } : base
  mocks.workflows.set("wf-parent", {
    nodes: opts.nested
      ? [
          { id: "gv1", type: "generate-video", data: { prompt: "a cat" } },
          { id: "sw1", type: "sub-workflow", data: { workflowId: "wf-child" } },
        ]
      : [{ id: "gv1", type: "generate-video", data: { prompt: "a cat" } }, sv],
    edges: [{ id: "e1", source: "gv1", target: opts.nested ? "sw1" : "sv1", sourceHandle: null, targetHandle: null }],
    settings: {},
    user_id: OWNER,
  })
  mocks.workflows.set("wf-child", { nodes: [sv], edges: [], user_id: OWNER })
  return {
    data: {
      executionId: "exec-1", workflowId: "wf-parent", userId: OWNER, triggerType: "manual",
      ...(opts.subset ? { nodeIds: opts.subset } : {}),
    },
  } as unknown as Job<WorkflowExecutionJob>
}

function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    ([, updates]) => (updates as { status?: string })?.status === "failed",
  )
  return call?.[1] as { error_message?: string } | undefined
}

describe("orchestrator pre-run check — an unpriced Speaker View in the run", () => {
  beforeEach(() => {
    mocks.executeNode.mockClear()
    mocks.executeNodeCalls.length = 0
    mocks.updateExecutionWithRetry.mockClear()
    mocks.workflows.clear()
    mocks.nestedLoads.length = 0
  })

  it("refuses before ANY node runs, so the paid upstream node never bills, and names the Speaker View node", async () => {
    await processWorkflowExecution(makeJob())

    expect(mocks.executeNodeCalls, "nothing dispatched means nothing reserved").toEqual([])
    const failed = failedWrite()
    expect(failed, "the execution row must be failed, not left running").toBeDefined()
    expect(failed!.error_message).toContain("Speaker View is not priced yet")
    expect(failed!.error_message).toContain("sv1")
  })

  it("refuses a Speaker View inside a sub-workflow and names the path to it", async () => {
    await processWorkflowExecution(makeJob({ nested: true }))

    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toContain("Speaker View is not priced yet")
    expect(failedWrite()!.error_message).toContain("Sub-workflow node sw1")
  })

  it("does not refuse a run that does not execute the Speaker View (a partial run of the upstream node)", async () => {
    await processWorkflowExecution(makeJob({ subset: ["gv1"] }))

    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNodeCalls).toContain("gv1")
  })

  it("does not refuse a skipped Speaker View", async () => {
    await processWorkflowExecution(makeJob({ skipped: true }))

    expect(failedWrite()?.error_message ?? "").not.toMatch(/not priced/)
    expect(mocks.executeNodeCalls).toContain("gv1")
  })

  // Speaker Frames (P3.6): the same refusal until P3.7 prices it.
  it("refuses an unpriced Speaker Frames before ANY node runs, top level and nested", async () => {
    await processWorkflowExecution(makeJob({ type: "speaker-frames" }))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toContain("Speaker Frames is not priced yet")
    mocks.updateExecutionWithRetry.mockClear()
    await processWorkflowExecution(makeJob({ type: "speaker-frames", nested: true }))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toContain("Sub-workflow node sw1")
  })
})
