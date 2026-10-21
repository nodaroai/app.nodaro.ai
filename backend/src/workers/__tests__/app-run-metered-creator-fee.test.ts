/**
 * An app run's creator fee is computed on what its metered LLM nodes were
 * CHARGED (A5, metered LLM pricing Task 11) — REAL orchestrator path.
 *
 * The node executor reports a metered node's `credits_actual` (the settle's
 * receipt), never the hold it reserved (`llm-metered-dag.test.ts` proves that
 * half: a Generate Script node holding 368 reports 27). The orchestrator sums
 * what nodes report into `totalCredits` and charges the creator's percentage
 * on it — so the fee is on the actual. And a SYNC LLM node (Generate Text),
 * whose route used to leave `credits_actual` unset (so it was left out of the
 * total), now counts: app runs charge the creator's percentage on LLM spend.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const reported: Record<string, number> = { script: 27, chat: 6 }
  const executeNode = vi.fn(async (node: { id: string; type: string }) => ({
    output: node.type === "llm-chat" ? { text: "hi" } : { script: { title: "Heist", scenes: [] } },
    jobId: `job-${node.id}`,
    creditsUsed: reported[node.id],
  }))
  const apps = new Map<string, Record<string, unknown>>()
  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "published_apps") {
        const row = apps.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: { status: "queued", node_states: {} }, error: null }
      if (table === "app_runs") return { data: { id: "run-1", app_id: "app-1", input_values: null }, error: null }
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
    update: () => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }))
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  return { executeNode, apps, from, rpc, updateExecutionWithRetry, reported }
})

vi.mock("@nodaro/shared/credits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared/credits")>()
  return { ...actual, calculateMonetizationMarkup: vi.fn(actual.calculateMonetizationMarkup) }
})
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", ORCHESTRATOR_CONCURRENCY: 2, MAX_CONCURRENT_NODES_PER_EXECUTION: 12 },
  hasCredits: () => true,
  llmMeteredPricing: () => true,
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
vi.mock("@/lib/execution-writes.js", () => ({ updateExecutionWithRetry: mocks.updateExecutionWithRetry }))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { calculateMonetizationMarkup } from "@nodaro/shared/credits"
import { processWorkflowExecution } from "../orchestrator-worker.js"

function job(): Job<WorkflowExecutionJob> {
  return {
    data: { executionId: "exec-1", workflowId: "wf-1", userId: "runner-1", triggerType: "app_run", appVersionId: "app-1", reviewerPresent: true },
  } as unknown as Job<WorkflowExecutionJob>
}

function app(nodes: Array<{ id: string; type: string }>) {
  mocks.apps.set("app-1", {
    snapshot_nodes: nodes.map((n) => ({ ...n, data: { label: n.id } })),
    snapshot_edges: [],
    snapshot_settings: {},
    creator_id: "creator-1",
    publish_type: "app",
    monetization_enabled: true,
    monetization_flat_fee: 0,
    monetization_percent: 20,
  })
}

const monetizationCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === "process_app_monetization")

beforeEach(() => {
  vi.clearAllMocks()
  mocks.apps.clear()
})

describe("an app run's creator fee on metered LLM spend", () => {
  it("generate-script node in an app run: creator fee on the actual 27, not the hold", async () => {
    app([{ id: "script", type: "generate-script" }])
    await processWorkflowExecution(job())
    expect(calculateMonetizationMarkup).toHaveBeenCalledWith(27, 0, 20) // = 6 (on a 368 hold it would have been 74)
    expect(monetizationCalls()).toHaveLength(1)
    expect(monetizationCalls()[0]![1]).toMatchObject({ p_base_cost: 27, p_markup_amount: 6, p_percent_fee: 6 })
  })

  it("sync llm-chat node in an app run now counts toward totalCredits", async () => {
    app([{ id: "chat", type: "llm-chat" }, { id: "script", type: "generate-script" }])
    await processWorkflowExecution(job())
    expect(calculateMonetizationMarkup).toHaveBeenCalledWith(33, 0, 20)
    expect(monetizationCalls()[0]![1]).toMatchObject({ p_base_cost: 33, p_markup_amount: 7 })
  })
})
