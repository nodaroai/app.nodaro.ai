/**
 * A blocked account's run stops at pickup — REAL orchestrator path.
 *
 * Whoever started it (a schedule, a webhook, a run queued before the block),
 * and whether the blocked one is the runner or the owner of the workflow (a
 * published app's creator), nothing is dispatched. A re-pick after a deploy
 * may find child jobs the run already started: those are cancelled and
 * refunded like a resume would, not left running for a run that is over.
 *
 * Harness mirrors trigger-run-scope-orchestrator.test.ts: only leaf I/O is
 * mocked, so what is asserted is what was dispatched and how the run ended.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  const executeNode = vi.fn(async (node: { id: string }) => {
    executeNodeCalls.push(node.id)
    return { output: { imageUrl: "https://x.png" }, creditsUsed: 0 }
  })

  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const cancelInFlightChildJobs = vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() })
  const blocked = new Set<string>()

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
    executeNodeCalls,
    updateExecutionWithRetry,
    cancelInFlightChildJobs,
    blocked,
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
  isCommunity: () => false,
  isBusiness: () => true,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))

vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access-blocks.js")>()),
  isUserBlocked: async (id: string | null | undefined) => (id ? mocks.blocked.has(id) : false),
  anyUserBlocked: async () => mocks.blocked.size > 0,
}))

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
  cancelInFlightChildJobs: mocks.cancelInFlightChildJobs,
}))

vi.mock("@/lib/execution-writes.js", () => ({
  updateExecutionWithRetry: mocks.updateExecutionWithRetry,
}))

vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"

const OWNER = "owner-1"
const RUNNER = "runner-2"

function makeJob(userId: string): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [{ id: "a", type: "generate-image", data: { label: "a", prompt: "a cat" } }],
    edges: [],
    settings: {},
    user_id: OWNER,
  })
  return {
    data: { executionId: "exec-1", workflowId: "wf-1", userId, triggerType: "manual" },
  } as unknown as Job<WorkflowExecutionJob>
}

/** The terminal write failExecution makes (status "failed" + error_message). */
function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    ([, updates]) => (updates as { status?: string })?.status === "failed",
  )
  return call?.[1] as { error_message?: string } | undefined
}

describe("orchestrator — a blocked account's run stops at pickup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeNodeCalls.length = 0
    mocks.blocked.clear()
  })

  it("a blocked runner: nothing dispatched, the run fails saying so, started children are cancelled first", async () => {
    mocks.blocked.add(OWNER)
    await processWorkflowExecution(makeJob(OWNER))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()?.error_message).toBe("This account is blocked.")
    expect(mocks.cancelInFlightChildJobs).toHaveBeenCalledWith("exec-1", OWNER)
    // Cancelled BEFORE the run is failed.
    const cancelAt = mocks.cancelInFlightChildJobs.mock.invocationCallOrder[0]!
    const failAt = mocks.updateExecutionWithRetry.mock.invocationCallOrder.find(
      (_order, i) => (mocks.updateExecutionWithRetry.mock.calls[i]![1] as { status?: string })?.status === "failed",
    )!
    expect(cancelAt).toBeLessThan(failAt)
  })

  it("a blocked OWNER (someone else running their workflow or app): nothing dispatched, a neutral message", async () => {
    mocks.blocked.add(OWNER)
    await processWorkflowExecution(makeJob(RUNNER))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()?.error_message).toBe("This workflow is unavailable.")
    // The run's children are the RUNNER's (the execution is theirs), not the owner's.
    expect(mocks.cancelInFlightChildJobs).toHaveBeenCalledWith("exec-1", RUNNER)
  })

  it("nobody blocked: the run goes ahead", async () => {
    await processWorkflowExecution(makeJob(RUNNER))
    expect(mocks.executeNodeCalls).toEqual(["a"])
    expect(failedWrite()).toBeUndefined()
  })
})
