/**
 * RECORDING — what a run does when ONE node of a level is refused before its
 * reservation (a deterministic refusal of its own inputs, with a code: the
 * shape node-executor.ts throws for a reference clip out of bounds, a
 * restricted file or an input link this deployment refuses). REAL
 * orchestrator path, leaf I/O only (harness of empty-input-skip-orchestrator).
 *
 * Three siblings in one level, then a node after them:
 *  - dispatched together (the level's width covers them): the siblings that
 *    started run to the end and keep what they charged; the refused node fails
 *    with its message and code; nothing after the level starts; the run fails.
 *  - one at a time (width 1): a sibling that has not started when the refusal
 *    lands never starts. It is marked failed with "Execution cancelled"
 *    (fail-fast), not skipped, and charges nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  const settings = { width: 12 }
  const executeNode = vi.fn(async (node: { id: string; type: string }) => {
    executeNodeCalls.push(node.id)
    if (node.id === "bad") {
      const err = new Error("This input was refused before anything was reserved.") as Error & { errorCode?: string }
      err.errorCode = "input_refused"
      throw err
    }
    return { output: { videoUrl: `https://media.example/${node.id}.mp4` }, creditsUsed: 5 }
  })
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const executionUpdates: Array<Record<string, unknown>> = []
  let workflowRow: Record<string, unknown> | null = null
  const execSelectRow = { status: "queued", node_states: {} }

  function makeChain(table: string, columns?: string) {
    const result = (() => {
      if (table === "workflows") return { data: workflowRow, error: workflowRow ? null : { message: "nf" } }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
      return { data: null, error: null }
    })()
    const single = vi.fn().mockResolvedValue(result)
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eqInner = { single, maybeSingle, eq: vi.fn() }
    eqInner.eq = vi.fn().mockReturnValue(eqInner)
    const eq = vi.fn().mockReturnValue(eqInner)
    return {
      select: vi.fn().mockReturnValue({ eq, single, maybeSingle, is: vi.fn().mockReturnValue({ single, eq }) }),
      update: vi.fn((patch: Record<string, unknown>) => {
        if (table === "workflow_executions") executionUpdates.push(patch)
        return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }),
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
    }
  }
  const from = vi.fn((table: string) => ({
    select: (columns?: string) => makeChain(table, columns).select(columns),
    update: (patch: Record<string, unknown>) => makeChain(table).update(patch),
    insert: () => makeChain(table).insert(),
  }))
  return {
    settings,
    executeNode,
    executeNodeCalls,
    updateExecutionWithRetry,
    executionUpdates,
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
    get MAX_CONCURRENT_NODES_PER_EXECUTION() {
      return mocks.settings.width
    },
  },
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
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

/** The orchestrator, loaded fresh: its dispatch width is read once, when it loads. */
async function loadOrchestrator(width: number) {
  mocks.settings.width = width
  vi.resetModules()
  return (await import("../orchestrator-worker.js")).processWorkflowExecution
}

/** Three trims of one uploaded clip, then a combine of all three. */
function makeJob(order: readonly string[]): Job<WorkflowExecutionJob> {
  const trim = (id: string) => ({ id, type: "trim-video", data: { label: id, startTime: 0, endTime: 2 } })
  mocks.setWorkflowRow({
    nodes: [
      { id: "clip", type: "upload-video", data: { label: "Clip", videoUrl: "https://media.example/clip.mp4" } },
      ...order.map(trim),
      { id: "join", type: "combine-videos", data: { label: "Join" } },
    ],
    edges: [
      ...order.map((id) => ({ id: `in-${id}`, source: "clip", target: id, sourceHandle: "video", targetHandle: "video" })),
      ...order.map((id, i) => ({ id: `out-${id}`, source: id, target: "join", sourceHandle: "video", targetHandle: `video-${i + 1}` })),
    ],
    settings: {},
    user_id: "owner-1",
  })
  return { data: { executionId: "exec-1", workflowId: "wf-1", userId: "owner-1", triggerType: "manual" } } as unknown as Job<WorkflowExecutionJob>
}

type NodeState = { status: string; error?: string; errorCode?: string; creditsUsed?: number }
type Terminal = { status?: string; node_states?: Record<string, NodeState>; error_message?: string; total_credits_used?: number }

function terminalWrite(): Terminal | undefined {
  const retried = mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => u as Terminal)
  const all = [...retried, ...(mocks.executionUpdates as Terminal[])]
  return all.find((u) => u?.status === "completed" || u?.status === "failed")
}

/** The last write that carried the level's node states. */
function lastStates(): Record<string, NodeState> {
  const all = [...mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => u as Terminal), ...(mocks.executionUpdates as Terminal[])]
  return all.filter((u) => u?.node_states).at(-1)!.node_states!
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.executeNodeCalls.length = 0
  mocks.executionUpdates.length = 0
})

describe("recording: one node of a level refused before its reservation", () => {
  it("dispatched together: the started siblings finish and keep their charge, the refused node fails with its code, nothing after the level runs, the run fails", async () => {
    const processWorkflowExecution = await loadOrchestrator(12)
    await processWorkflowExecution(makeJob(["a", "bad", "b"]))
    expect([...mocks.executeNodeCalls].sort()).toEqual(["a", "b", "bad"])
    const end = terminalWrite()
    expect(end?.status).toBe("failed")
    expect(end?.error_message).toMatch(/bad: This input was refused/)
    const states = lastStates()
    expect(states.bad).toMatchObject({ status: "failed", errorCode: "input_refused" })
    expect(states.a?.status).toBe("completed")
    expect(states.b?.status).toBe("completed")
    expect(states.join?.status ?? "pending").not.toBe("completed")
    expect(mocks.executeNodeCalls).not.toContain("join")
  })

  it("one at a time: the refused node stops the siblings not yet started — failed with \"Execution cancelled\", never dispatched", async () => {
    const processWorkflowExecution = await loadOrchestrator(1)
    await processWorkflowExecution(makeJob(["a", "bad", "b"]))
    expect(mocks.executeNodeCalls).toContain("a")
    expect(mocks.executeNodeCalls).toContain("bad")
    expect(mocks.executeNodeCalls).not.toContain("b")
    expect(mocks.executeNodeCalls).not.toContain("join")
    const states = lastStates()
    expect(states.a?.status).toBe("completed")
    expect(states.bad).toMatchObject({ status: "failed", errorCode: "input_refused" })
    expect(states.b).toMatchObject({ status: "failed", error: "Execution cancelled" })
    expect(terminalWrite()?.status).toBe("failed")
  })
})
