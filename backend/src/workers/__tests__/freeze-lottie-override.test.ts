/**
 * Freeze-on-exposure guard (design F16) — REAL orchestrator path.
 *
 * A published-app / presentation run that carries a lottie `motionPlan` override
 * for a slot-exposed motion-graphics node must FREEZE that node: the orchestrator
 * pre-completes it with the overridden plan as output, so the DAG never
 * re-generates it (no 5cr re-charge) and the downstream render-video consumes the
 * frozen plan via `nodeStates.output.plan`.
 *
 * The bug this guards: motion-graphics(engine:"lottie") is EXECUTABLE — without
 * the freeze the orchestrator re-runs it, the fresh plan lands in
 * `nodeStates[id].output.plan`, and payload-builder's render-video case (which
 * reads `nodeStates.output.plan` BEFORE `node.data.motionPlan`) discards the
 * user's slot override. Slot edits in apps then do nothing AND the user is
 * re-charged.
 *
 * This test drives the REAL `processWorkflowExecution` — real seeding loop, real
 * `applyInputOverridesToNodes`, real `buildExecutionLevels`, real per-level
 * executable filter. Only the leaf I/O is mocked (supabase, executeNode, the
 * reconcile/write helpers). It asserts:
 *   (a) `executeNode` is NEVER dispatched for the motion-graphics node, and
 *   (b) when render-video IS dispatched, the `nodeStates` it receives carry the
 *       frozen plan — planType "lottie-graphic" + the OVERRIDDEN slotValues —
 *       which is exactly what payload-builder's render-video case reads.
 *
 * Path coverage note: the freeze gate (`isFrozenLottieOverride`) keys on the
 * PRESENCE of `inputOverrides[nodeId].motionPlan`, which the presentation route
 * AND the app route both set on the same orchestrator job. This test exercises
 * the presentation path (no appVersionId → workflows-table load); the identical
 * seed site covers the app path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// Mocks — leaf I/O only; the orchestration logic (seeding, level build,
// executable filter, override application) runs for real.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Captured (deep-cloned) nodeStates per executeNode dispatch, keyed by node id.
  const executeNodeCalls: Array<{ nodeId: string; nodeStates: unknown }> = []
  const executeNode = vi.fn(
    async (
      node: { id: string; type?: string },
      _inputs: unknown,
      _edges: unknown,
      _nodes: unknown,
      nodeStates: Record<string, unknown>,
    ) => {
      executeNodeCalls.push({
        nodeId: node.id,
        nodeStates: structuredClone(nodeStates),
      })
      // render-video returns a video url; anything else a generic output.
      return {
        output: node.type === "render-video" ? { videoUrl: "https://r2/out.mp4" } : { text: "x" },
        creditsUsed: 5,
      }
    },
  )

  // Routed supabase mock — returns rows by table + selected columns.
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

  const from = vi.fn((table: string) => {
    // Wrap so we can see the selected columns for routing the exec-row read.
    return {
      select: (columns?: string) => makeChain(table, columns).select(columns),
      update: () => makeChain(table).update(),
      insert: () => makeChain(table).insert(),
    }
  })

  return {
    executeNode,
    executeNodeCalls,
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
  // Passthrough — no prior progress to reconcile in this fresh run.
  reconcileNodeStatesFromJobs: vi.fn(async (states: unknown) => ({ next: states, changed: false })),
}))

vi.mock("@/lib/reconcile/cancel-inflight-jobs.js", () => ({
  cancelInFlightChildJobs: vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() }),
}))

vi.mock("@/lib/execution-writes.js", () => ({
  updateExecutionWithRetry: vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 }),
}))

vi.mock("@/services/execution-stats.js", () => ({
  // Returning null short-circuits the post-execute stats upsert.
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOTTIE_PLAN_SNAPSHOT = {
  planType: "lottie-graphic",
  lottie: { v: "5.7.0", layers: [] },
  slots: { primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } } },
  slotValues: { primaryColor: [1, 0, 0, 1] },
}

// What the frontend composer sends: the full plan with the user's edited slot.
const OVERRIDE_PLAN = {
  planType: "lottie-graphic",
  lottie: { v: "5.7.0", layers: [] },
  slots: { primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } } },
  slotValues: { primaryColor: [0, 1, 0, 1] }, // green — the user's slot edit
}

function makeJob(): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      {
        id: "mg1",
        type: "motion-graphics",
        data: { engine: "lottie", motionPlan: LOTTIE_PLAN_SNAPSHOT },
      },
      { id: "rv1", type: "render-video", data: {} },
    ],
    edges: [{ id: "e1", source: "mg1", target: "rv1" }],
    settings: {},
    user_id: "owner-1",
  })
  return {
    data: {
      executionId: "exec-1",
      workflowId: "wf-1",
      userId: "owner-1",
      triggerType: "manual",
      inputOverrides: { mg1: { motionPlan: OVERRIDE_PLAN } },
    },
  } as unknown as Job<WorkflowExecutionJob>
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("orchestrator freeze-on-exposure (F16) — real path", () => {
  beforeEach(() => {
    mocks.executeNode.mockClear()
    mocks.executeNodeCalls.length = 0
  })

  it("does NOT dispatch the frozen lottie node, and render-video receives the overridden plan via nodeStates", async () => {
    await processWorkflowExecution(makeJob())

    // (a) The motion-graphics node was pre-completed → never executed (no re-roll,
    //     no 5cr re-charge).
    const mgDispatched = mocks.executeNodeCalls.some((c) => c.nodeId === "mg1")
    expect(mgDispatched).toBe(false)

    // render-video WAS dispatched (it's executable; the frozen node only feeds it).
    const rvCall = mocks.executeNodeCalls.find((c) => c.nodeId === "rv1")
    expect(rvCall, "render-video should have been dispatched").toBeDefined()

    // (b) The nodeStates handed to render-video's executeNode (exactly what
    //     payload-builder's render-video case reads) carry the FROZEN plan:
    //     pre-completed mg1 with output.plan = the overridden plan.
    const states = rvCall!.nodeStates as Record<string, { status: string; output?: { plan?: Record<string, unknown> } }>
    expect(states.mg1.status).toBe("completed")
    const frozenPlan = states.mg1.output?.plan
    expect(frozenPlan?.planType).toBe("lottie-graphic")
    // The user's slot edit (green), NOT the snapshot's red — proving the override
    // survived and a re-roll did not overwrite it.
    expect((frozenPlan?.slotValues as Record<string, unknown>).primaryColor).toEqual([0, 1, 0, 1])
  })

  it("WITHOUT a motionPlan override, the lottie node IS executed (today's generator behavior preserved)", async () => {
    // Apps that DON'T expose slot fields keep re-generating the node as usual.
    const job = makeJob()
    ;(job.data as { inputOverrides?: unknown }).inputOverrides = undefined

    await processWorkflowExecution(job)

    const mgDispatched = mocks.executeNodeCalls.some((c) => c.nodeId === "mg1")
    expect(mgDispatched).toBe(true)
  })
})
