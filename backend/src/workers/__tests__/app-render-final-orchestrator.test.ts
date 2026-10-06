/**
 * No creator markup on an app's Render final (decided 2026-10-04) — REAL
 * orchestrator path.
 *
 * An app run settles the creator's markup once, at the end of the execution
 * `app_runs.execution_id` names. Its Render final is a continuation OUTSIDE
 * the run: the final and the nodes after it earn the creator nothing, whatever
 * row a later change links the final to. It still runs as the app's version
 * (`appVersionId`), which is what draws it on the app allowance.
 *
 * The harness of run-continuation-orchestrator.test.ts, with credits on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { NodeExecutionState, WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNodeCalls: Array<{ id: string; inputs: Record<string, unknown>; data: Record<string, unknown> }> = []
  const executeNode = vi.fn(async (node: { id: string; data?: Record<string, unknown> }, inputs: Record<string, unknown>) => {
    executeNodeCalls.push({ id: node.id, inputs, data: { ...(node.data ?? {}) } })
    return { output: { videoUrl: `https://r2/${node.id}.mp4` }, creditsUsed: 1 }
  })
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const directUpdates: Array<Record<string, unknown>> = []
  const workflows = new Map<string, Record<string, unknown>>()
  const apps = new Map<string, Record<string, unknown>>()
  /** Earlier executions, by id: the rows a continuation reads. */
  const executions = new Map<string, Record<string, unknown>>()
  /** app_runs.app_id by execution id. */
  const appRuns = new Map<string, string>()
  /** app_runs.input_values by execution id: the overrides that app run used. */
  const appRunInputs = new Map<string, Record<string, Record<string, unknown>>>()
  const execSelectRow = { status: "queued", node_states: {} }
  /** `jobs` rows, in the projection the canvas-result-ids lookup selects. */
  const jobRows: Array<Record<string, unknown>> = []

  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "workflows") {
        const row = workflows.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "published_apps") {
        const row = apps.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
      if (table === "workflow_executions") return { data: executions.get(filters.id as string) ?? null, error: null }
      if (table === "jobs") return { data: jobRows.filter((r) => r.user_id === filters.user_id), error: null }
      if (table === "app_runs") {
        const appId = appRuns.get(filters.execution_id as string)
        const inputValues = appRunInputs.get(filters.execution_id as string) ?? null
        return { data: appId ? { id: `run-of-${filters.execution_id as string}`, app_id: appId, input_values: inputValues } : null, error: null }
      }
      return { data: null, error: null }
    }
    const self = {
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return self
      },
      is: () => self,
      or: () => self,
      order: () => self,
      range: async () => resolve(),
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
    }
    return self
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) => chain(table, columns),
    update: (row: Record<string, unknown>) => {
      directUpdates.push(row)
      return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
    },
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }))

  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const settleAppRunFinalEdits = vi.fn().mockResolvedValue(undefined)
  return { settleAppRunFinalEdits, executeNode, executeNodeCalls, updateExecutionWithRetry, directUpdates, from, rpc, workflows, apps, executions, appRuns, appRunInputs, execSelectRow, jobRows }
})

vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", ORCHESTRATOR_CONCURRENCY: 2, MAX_CONCURRENT_NODES_PER_EXECUTION: 12 },
  hasCredits: () => true,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
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
vi.mock("@/lib/app-run-final-column.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/app-run-final-column.js")>()),
  settleAppRunFinalEdits: mocks.settleAppRunFinalEdits,
}))
vi.mock("@/lib/execution-writes.js", () => ({ updateExecutionWithRetry: mocks.updateExecutionWithRetry }))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"

const RUNNER = "runner-1"
const at = "2026-10-06T10:00:00.000Z"

const snapshot = {
  nodes: [
    { id: "rec", type: "upload-video", data: { videoUrl: "https://r2/rec.mp4" } },
    { id: "cut", type: "apply-edl", data: { quality: "proxy", output: "video", edl: { version: 1, sources: [], segments: [] } } },
    { id: "cap", type: "add-captions", data: {} },
  ],
  edges: [
    { id: "e1", source: "rec", target: "cut", sourceHandle: null, targetHandle: "sources" },
    { id: "e2", source: "cut", target: "cap", sourceHandle: null, targetHandle: null },
  ],
}

function stoppedAppRun(): Record<string, unknown> {
  const states: Record<string, NodeExecutionState> = {
    rec: { status: "completed", output: { videoUrl: "https://r2/rec.mp4" }, completedAt: at, fromSavedData: true },
    cut: { status: "completed", nodeType: "apply-edl", jobId: "job-cut", startedAt: at, completedAt: at, output: { videoUrl: "https://r2/preview.mp4", quality: "proxy" } },
    cap: { status: "skipped", nodeType: "add-captions", completedAt: at },
  }
  return { id: "exec-run", user_id: RUNNER, workflow_id: "wf-1", status: "completed", node_states: states }
}

function job(data: Partial<WorkflowExecutionJob>): Job<WorkflowExecutionJob> {
  return {
    data: {
      executionId: "exec-final",
      workflowId: "wf-1",
      userId: RUNNER,
      triggerType: "app_run",
      appVersionId: "app-1",
      reviewerPresent: true,
      ...data,
    },
  } as unknown as Job<WorkflowExecutionJob>
}

const monetizationCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === "process_app_monetization")
const failed = () => mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === "failed")

beforeEach(() => {
  mocks.executeNode.mockClear()
  mocks.executeNodeCalls.length = 0
  mocks.updateExecutionWithRetry.mockClear()
  mocks.rpc.mockClear()
  mocks.settleAppRunFinalEdits.mockClear()
  mocks.directUpdates.length = 0
  mocks.apps.clear()
  mocks.executions.clear()
  mocks.appRuns.clear()
  mocks.apps.set("app-1", {
    snapshot_nodes: snapshot.nodes,
    snapshot_edges: snapshot.edges,
    snapshot_settings: {},
    creator_id: "creator-1",
    publish_type: "app",
    monetization_enabled: true,
    monetization_flat_fee: 5,
    monetization_percent: 20,
  })
  mocks.executions.set("exec-run", stoppedAppRun())
  // The run's own execution is the one `app_runs.execution_id` names.
  mocks.appRuns.set("exec-run", "app-1")
})

describe("creator markup settles on the app run, never on its Render final", () => {
  it("the app run's own execution settles markup (the baseline)", async () => {
    mocks.appRuns.set("exec-final", "app-1")
    const finalOverride = { cut: { quality: "final" } }
    await processWorkflowExecution(job({ executionId: "exec-final", inputOverrides: finalOverride }))
    expect(failed()).toBeUndefined()
    expect(monetizationCalls()).toHaveLength(1)
  })

  it("the Render final — a continuation of that run — earns the creator nothing, even if a row names it", async () => {
    // Even were a later change to look the final up as a run (say by
    // `final_execution_id`), the continuation itself never settles markup.
    mocks.appRuns.set("exec-final", "app-1")
    await processWorkflowExecution(
      job({ continueFromExecutionId: "exec-run", nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "final" } } }),
    )
    expect(failed()).toBeUndefined()
    expect(mocks.executeNodeCalls.map((c) => c.id).sort()).toEqual(["cap", "cut"])
    expect(monetizationCalls()).toHaveLength(0)
  })

  it("it still runs as the app's version: an app run for the credit pool (the app allowance)", async () => {
    await processWorkflowExecution(
      job({ continueFromExecutionId: "exec-run", nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "final" } } }),
    )
    const ctx = (mocks.executeNode.mock.calls[0] as unknown[])[5] as { isAppRun?: boolean } | undefined
    expect(ctx?.isAppRun).toBe(true)
  })
})

describe("the runner's edits of what a final replaced go once it ENDS (decided 2026-10-06)", () => {
  // Not when it is asked for: a final that fails keeps the preview on show,
  // and the runner's edit of it with it.
  it("a Render final settles them at its end, as the runner's", async () => {
    await processWorkflowExecution(
      job({ continueFromExecutionId: "exec-run", nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "final" } } }),
    )
    expect(mocks.settleAppRunFinalEdits).toHaveBeenCalledWith("exec-final", RUNNER)
  })

  it("a final that fails settles them too (what it did complete replaced the preview)", async () => {
    mocks.executeNode.mockImplementationOnce(async () => {
      throw new Error("provider down")
    })
    await processWorkflowExecution(
      job({ continueFromExecutionId: "exec-run", nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "final" } } }),
    )
    expect(failed()).toBeDefined()
    expect(mocks.settleAppRunFinalEdits).toHaveBeenCalledWith("exec-final", RUNNER)
  })

  it("an app run's own execution is not a final: nothing to settle", async () => {
    await processWorkflowExecution(job({ executionId: "exec-final", inputOverrides: { cut: { quality: "final" } } }))
    expect(mocks.settleAppRunFinalEdits).not.toHaveBeenCalled()
  })
})
