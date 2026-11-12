// @test-watches tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/** backend/src/nodes/**
/**
 * A node unit's app fields at the orchestrator — REAL `processWorkflowExecution` path.
 *
 * Every lane (an app run, a share-token run, a component's inner run, the workflow run API, an API token
 * run, a Retry or Render final re-applying a stored run's inputs) enqueues this one job, and its overrides
 * meet the graph in ONE place: `applyInputOverridesToNodes`. There an override that sets a unit's app field
 * (unit.json `appFields`) outside its declaration — `null` included — throws `UnitFieldOverrideError`, and the
 * orchestrator's outer catch fails the execution with its message before any node is dispatched. The routes
 * refuse first with a 400 (their own tests); this pins the merge, which holds for a lane that forgot.
 * Same harness as locked-override-fails-execution.test.ts; the fixture unit `fixture-echo` (size: auto, 1K,
 * 1.5K, 2K; maxLayers: 1–99) comes through its golden descriptor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNode = vi.fn(async () => ({ output: { text: "x" }, creditsUsed: 0 }))
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })

  let workflowRow: Record<string, unknown> | null = null
  const execSelectRow = { status: "queued", node_states: {} }

  function makeChain(table: string, columns?: string) {
    const result = (() => {
      if (table === "workflows") return { data: workflowRow, error: workflowRow ? null : { message: "nf" } }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states")
        return { data: execSelectRow, error: null }
      return { data: null, error: null }
    })()
    const single = vi.fn().mockResolvedValue(result)
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eqInner = { single, maybeSingle, eq: vi.fn() }
    eqInner.eq = vi.fn().mockReturnValue(eqInner)
    const eq = vi.fn().mockReturnValue(eqInner)
    return {
      select: vi.fn().mockReturnValue({ eq, single, maybeSingle, is: vi.fn().mockReturnValue({ single, eq }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
    }
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) => makeChain(table, columns).select(columns),
    update: () => makeChain(table).update(),
    insert: () => makeChain(table).insert(),
  }))

  return {
    executeNode,
    updateExecutionWithRetry,
    from,
    setWorkflowRow: (row: Record<string, unknown>) => {
      workflowRow = row
    },
  }
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

vi.mock("@/lib/unit-descriptors.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/unit-descriptors.js")>()
  const { descriptor } = await import("../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js")
  const units = [...real.UNIT_NODE_DESCRIPTORS, descriptor as unknown as (typeof real.UNIT_NODE_DESCRIPTORS)[number]]
  return { ...real, UNIT_NODE_DESCRIPTORS: units, unitDescriptorOf: (t: string | undefined) => units.find((u) => u.type === t) }
})

import { processWorkflowExecution } from "../orchestrator-worker.js"

function makeJob(inputOverrides: Record<string, Record<string, unknown>>): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      { id: "text-1", type: "text-prompt", data: { text: "hello" } },
      { id: "split", type: "fixture-echo", data: { label: "Layers", size: "1K", maxLayers: 9 } },
    ],
    edges: [],
    settings: {},
    user_id: "owner-1",
  })
  return {
    data: { executionId: "exec-1", workflowId: "wf-1", userId: "viewer-1", triggerType: "manual", inputOverrides },
  } as unknown as Job<WorkflowExecutionJob>
}

function failedWrite(): Record<string, unknown> | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    (c) => (c[1] as Record<string, unknown> | undefined)?.status === "failed",
  )
  return call?.[1] as Record<string, unknown> | undefined
}

describe("orchestrator — an override outside a unit's app-field declaration fails the run before any node runs", () => {
  beforeEach(() => {
    mocks.executeNode.mockClear()
    mocks.updateExecutionWithRetry.mockClear()
  })

  it("a value outside the declaration: the execution fails with its wording, nothing dispatched", async () => {
    await processWorkflowExecution(makeJob({ split: { maxLayers: 500 } }))
    expect(mocks.executeNode).not.toHaveBeenCalled()
    expect(failedWrite()?.error_message).toBe("Invalid value for maxLayers: 500. Use a whole number between 1 and 99.")
  })

  it("null: the execution fails too, nothing dispatched", async () => {
    await processWorkflowExecution(makeJob({ split: { size: null } }))
    expect(mocks.executeNode).not.toHaveBeenCalled()
    expect(failedWrite()?.error_message).toBe("Invalid value for size: null. Allowed: auto, 1K, 1.5K, 2K")
  })

  it("a declared value runs the graph as usual", async () => {
    await processWorkflowExecution(makeJob({ split: { size: "2K", maxLayers: 42 } }))
    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNode).toHaveBeenCalled()
  })
})
