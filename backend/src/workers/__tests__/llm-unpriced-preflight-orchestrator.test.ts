/**
 * THE RUN-START REFUSAL OF AN UNPRICED METERED LLM CALL (R51) — REAL orchestrator path.
 *
 * A metered LLM call on a model with no price refuses at its own reservation:
 * by then every fixed node upstream of it has run and charged. Every lane
 * passes the orchestrator with its graph in hand — the routes that have no
 * pre-check of their own (a webhook, a Telegram message, a schedule, a plugin
 * trigger, a component's inner run) included — so the orchestrator refuses the
 * whole execution before any node dispatches, with the sentence the 400 says.
 * Harness mirrors speaker-view-unpriced-preflight-orchestrator.test.ts.
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
  hasCredits: () => true,
  llmMeteredPricing: () => true,
  isCloud: () => true,
  isCommunity: () => false,
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

// The estimator's answer (unit-tested in workflow-estimate-metered.test.ts): a
// chat node naming the unpriced model is the call the run would be refused at.
const UNPRICED_MODEL = "unpriced-model"
const estimator = vi.hoisted(() => ({ asked: [] as Array<{ nodes: string[]; runNodeIds?: string[] }> }))
vi.mock("@/ee/billing/credits.js", () => ({
  unpricedMeteredLlmOfRun: (nodes: Array<{ id: string; data?: { llmModel?: string } }>, _edges: unknown, runNodeIds?: Set<string>) => {
    estimator.asked.push({ nodes: nodes.map((n) => n.id), ...(runNodeIds ? { runNodeIds: [...runNodeIds] } : {}) })
    const hit = nodes.find((n) => (!runNodeIds || runNodeIds.has(n.id)) && n.data?.llmModel === UNPRICED_MODEL)
    if (!hit) return null
    return Object.assign(new Error("unpriced"), { name: "LlmUnpricedModelError", code: "llm_model_unpriced", modelId: UNPRICED_MODEL })
  },
}))

// The graphs reached through a component node (unit-tested in llm-unpriced-component-graphs.test.ts):
// a component node's snapshot holds the chat named by its `holds` data.
vi.mock("@/lib/llm-unpriced-component-graphs.js", () => ({
  componentRunGraphs: async (runNodes: Array<{ id: string; type: string; data?: { holds?: string } }>) =>
    runNodes
      .filter((n) => n.type === "component")
      .map((n) => ({ nodes: [{ id: "inner", type: "llm-chat", data: { llmModel: n.data?.holds } }], edges: [], path: [n.id] })),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = "owner-1"
const PAID = { id: "gv1", type: "generate-video", data: { prompt: "a cat" } }
const CHAT = { id: "chat1", type: "llm-chat", data: { llmModel: UNPRICED_MODEL } }

function makeJob(opts: { nested?: boolean; component?: string; subset?: string[]; overrides?: Record<string, Record<string, unknown>>; chatModel?: string } = {}): Job<WorkflowExecutionJob> {
  const chat = opts.chatModel ? { ...CHAT, data: { llmModel: opts.chatModel } } : CHAT
  const second = opts.component !== undefined
    ? { id: "comp1", type: "component", data: { appSlug: "writer", holds: opts.component } }
    : opts.nested ? { id: "sw1", type: "sub-workflow", data: { workflowId: "wf-child" } } : chat
  mocks.workflows.set("wf-parent", {
    nodes: [PAID, second],
    edges: [{ id: "e1", source: "gv1", target: second.id, sourceHandle: null, targetHandle: null }],
    settings: {},
    user_id: OWNER,
  })
  mocks.workflows.set("wf-child", { nodes: [chat], edges: [], user_id: OWNER })
  return {
    data: {
      executionId: "exec-1", workflowId: "wf-parent", userId: OWNER, triggerType: "webhook",
      ...(opts.subset ? { nodeIds: opts.subset } : {}),
      ...(opts.overrides ? { inputOverrides: opts.overrides } : {}),
    },
  } as unknown as Job<WorkflowExecutionJob>
}

function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    ([, updates]) => (updates as { status?: string })?.status === "failed",
  )
  return call?.[1] as { error_message?: string } | undefined
}

describe("orchestrator pre-run check — an unpriced metered LLM call in the run (R51)", () => {
  beforeEach(() => {
    mocks.executeNode.mockClear()
    mocks.executeNodeCalls.length = 0
    mocks.updateExecutionWithRetry.mockClear()
    mocks.workflows.clear()
    estimator.asked.length = 0
  })

  it("refuses before ANY node runs, so the paid upstream node never bills, with the 400's sentence", async () => {
    await processWorkflowExecution(makeJob())

    expect(mocks.executeNodeCalls, "nothing dispatched means nothing reserved").toEqual([])
    const failed = failedWrite()
    expect(failed, "the execution row must be failed, not left running").toBeDefined()
    expect(failed!.error_message).toContain(`The model "${UNPRICED_MODEL}" has no price yet`)
  })

  it("refuses a call inside a sub-workflow and names the path to it", async () => {
    await processWorkflowExecution(makeJob({ nested: true }))

    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toContain("has no price yet")
    expect(failedWrite()!.error_message).toContain("Sub-workflow node sw1")
  })

  it("refuses a call inside a component the run executes — before the parent's paid node runs — and names the component", async () => {
    await processWorkflowExecution(makeJob({ component: UNPRICED_MODEL }))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toContain("has no price yet")
    expect(failedWrite()!.error_message).toContain("Found inside Component node comp1")

    mocks.updateExecutionWithRetry.mockClear()
    await processWorkflowExecution(makeJob({ component: "claude-opus-5.5" }))
    expect(failedWrite()?.error_message ?? "").not.toMatch(/no price yet/)
  })

  it("asks only of the nodes the run executes: a partial run of the upstream node starts", async () => {
    await processWorkflowExecution(makeJob({ subset: ["gv1"] }))

    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNodeCalls).toContain("gv1")
    expect(estimator.asked[0]?.runNodeIds).toEqual(["gv1"])
  })

  it("reads the graph AFTER the run's overrides: a model an override sets is the one it runs", async () => {
    await processWorkflowExecution(makeJob({ chatModel: "claude-opus-5.5", overrides: { chat1: { llmModel: UNPRICED_MODEL } } }))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toContain("has no price yet")

    mocks.updateExecutionWithRetry.mockClear()
    await processWorkflowExecution(makeJob({ overrides: { chat1: { llmModel: "claude-opus-5.5" } } }))
    expect(failedWrite()?.error_message ?? "").not.toMatch(/no price yet/)
  })
})
