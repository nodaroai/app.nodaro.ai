/**
 * A UGC Clip fan-out that fails on one clip — REAL orchestrator path.
 *
 * UGC Clip is all-or-nothing: one failed clip fails the node, and a Bundle
 * edge after it never receives a partial list. The clips that finished are
 * still on the failed state — the item count, how many finished and their
 * jobs — so a later run can see what was made and paid for; the state hands
 * no list on (`output` stays absent).
 *
 * Harness mirrors fan-out-progress-orchestrator.test.ts (leaf I/O only).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const TICKETS = [0, 1, 2].map((i) => JSON.stringify({ v: 1, index: i, durationSec: 8, video: { tool: "t", args: {} } }))
  const executeNodeCalls: string[] = []
  /** The clip numbers (0-based) whose render fails. */
  let failing = new Set<number>()
  const executeNode = vi.fn(async (node: { id: string; type: string }, _inputs: unknown, _edges: unknown, _nodes: unknown, _states: unknown, _ctx: unknown, i?: number) => {
    executeNodeCalls.push(node.id)
    if (node.type === "ugc-clips") {
      return { output: { listResults: TICKETS, ugcOutputs: { clips: TICKETS[0] } }, creditsUsed: 0 }
    }
    if (failing.has(i ?? 0)) throw new Error(`Clip ${(i ?? 0) + 1} failed`)
    return { output: { videoUrl: `https://cdn/clip-${i}.mp4` }, jobId: `job-clip-${i}`, creditsUsed: 400 }
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
    executeNode,
    executeNodeCalls,
    updateExecutionWithRetry,
    executionUpdates,
    from,
    setWorkflowRow: (row: Record<string, unknown>) => {
      workflowRow = row
    },
    setFailing: (clips: number[]) => {
      failing = new Set(clips)
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
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"
import { continuationSeeds, fromFailedRunSet } from "../../services/workflow-engine/run-continuation.js"
import type { NodeExecutionState } from "../../services/workflow-engine/types.js"

function makeJob(): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      { id: "clips", type: "ugc-clips", data: { label: "UGC Clips" } },
      { id: "clip", type: "ugc-clip", data: { label: "UGC Clip", rerender: {} } },
      { id: "join", type: "combine-videos", data: { label: "Join" } },
    ],
    edges: [
      { id: "e1", source: "clips", target: "clip", sourceHandle: "clips", targetHandle: "clip" },
      { id: "e2", source: "clip", target: "join", sourceHandle: "video-out", targetHandle: "videos", data: { outputMode: "bundle" } },
    ],
    settings: {},
    user_id: "owner-1",
  })
  return { data: { executionId: "exec-1", workflowId: "wf-1", userId: "owner-1", triggerType: "manual" } } as unknown as Job<WorkflowExecutionJob>
}

type Write = { status?: string; node_states?: Record<string, NodeExecutionState> }
function lastStates(): Record<string, NodeExecutionState> {
  const all = [...mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => u as Write), ...(mocks.executionUpdates as Write[])]
  const withStates = all.filter((u) => u.node_states?.clip)
  return withStates.at(-1)!.node_states!
}

describe("orchestrator — a failed UGC Clip fan-out keeps what it finished", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeNodeCalls.length = 0
    mocks.executionUpdates.length = 0
  })

  it("the failed state carries the clip count, how many finished and their jobs, and hands no list on", async () => {
    mocks.setFailing([1])
    await processWorkflowExecution(makeJob())
    const clip = lastStates().clip!
    expect(clip.status).toBe("failed")
    expect(clip.iterationTotal).toBe(3)
    expect(clip.iterationCompleted).toBe(2)
    // In settle order, never by position: compared as a set.
    expect([...(clip.jobIds ?? [])].sort()).toEqual(["job-clip-0", "job-clip-2"])
    // Each finished job beside the row (the clip) it ran.
    const rowOf = Object.fromEntries((clip.jobIds ?? []).map((id, i) => [id, clip.jobRows?.[i]]))
    expect(rowOf).toEqual({ "job-clip-0": 0, "job-clip-2": 2 })
    expect(clip.creditsUsed).toBe(800)
    expect(clip.output).toBeUndefined()
    // The join after it never ran on a partial list.
    expect(mocks.executeNodeCalls).not.toContain("join")
  })

  it("a continuation still reads it as not completed: it runs again, and the node after it is never seeded with a list", async () => {
    mocks.setFailing([1])
    await processWorkflowExecution(makeJob())
    const states = lastStates()
    const source = { id: "exec-1", userId: "owner-1", workflowId: "wf-1", status: "failed", appVersionId: null, nodeStates: states }
    expect(fromFailedRunSet(["clips", "clip", "join"], source)).toEqual(expect.arrayContaining(["clip", "join"]))
    const seeds = continuationSeeds([{ id: "clip", type: "ugc-clip", data: {} }, { id: "join", type: "combine-videos", data: {} }], source, new Set())
    expect(seeds.get("clip")).toMatchObject({ status: "skipped" })
    expect(seeds.get("clip")?.output).toBeUndefined()
  })

  it("every clip finished: the node completes as before", async () => {
    mocks.setFailing([])
    await processWorkflowExecution(makeJob())
    const clip = lastStates().clip!
    expect(clip.status).toBe("completed")
    expect(clip.output?.listResults).toEqual(["https://cdn/clip-0.mp4", "https://cdn/clip-1.mp4", "https://cdn/clip-2.mp4"])
  })
})
