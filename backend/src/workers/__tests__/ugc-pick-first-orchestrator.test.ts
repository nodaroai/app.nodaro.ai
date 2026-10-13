/**
 * UGC Creator's pause — the REAL orchestrator path.
 *
 * An editor run (a reviewer present) that would execute a UGC Creator whose
 * options wait for the person's pick is refused before any node runs ("Pick a
 * creator first."), and an editor run whose creator draws two options that pass
 * stops there: everything forward of it is skipped and the run ends completed.
 *
 * Drives `processWorkflowExecution` with only leaf I/O mocked (the harness of
 * preview-gate-orchestrator.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import { UGC_PICK_FIRST_MESSAGE } from "@nodaro/shared"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  const outputs = new Map<string, Record<string, unknown>>()
  /** Each node's state while it runs, as the run persists it. */
  const runningStates = new Map<string, Record<string, unknown>>()
  /** A node that fails, by id: what it throws. */
  const failures = new Map<string, unknown>()
  const executeNode = vi.fn(async (node: { id: string }, _inputs: unknown, _edges: unknown, _nodes: unknown, nodeStates: Record<string, Record<string, unknown>>) => {
    executeNodeCalls.push(node.id)
    runningStates.set(node.id, { ...nodeStates[node.id] })
    if (failures.has(node.id)) throw failures.get(node.id)
    return { output: outputs.get(node.id) ?? { text: `${node.id} done` }, creditsUsed: 1 }
  })
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const directUpdates: Array<Record<string, unknown>> = []
  const workflows = new Map<string, Record<string, unknown>>()
  const execSelectRow = { status: "queued", node_states: {} as Record<string, unknown> }

  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "workflows") {
        const row = workflows.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
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
    update: (row: Record<string, unknown>) => {
      directUpdates.push(row)
      return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
    },
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }))
  const cancelInFlightChildJobs = vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() })

  return { executeNode, executeNodeCalls, outputs, failures, runningStates, updateExecutionWithRetry, directUpdates, from, workflows, execSelectRow, cancelInFlightChildJobs }
})

vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", ORCHESTRATOR_CONCURRENCY: 2, MAX_CONCURRENT_NODES_PER_EXECUTION: 12 },
  hasCredits: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
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
vi.mock("@/lib/reconcile/cancel-inflight-jobs.js", () => ({ cancelInFlightChildJobs: mocks.cancelInFlightChildJobs }))
vi.mock("@/lib/execution-writes.js", () => ({ updateExecutionWithRetry: mocks.updateExecutionWithRetry }))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"

const OWNER = "owner-1"
const OPTION = { imageUrl: "https://cdn.example/a.png", record: { v: 1 } }
const PAIR = [OPTION, { imageUrl: "https://cdn.example/b.png", record: { v: 1 } }]

/** script → creator → clips → clip, with the script's plan also wired into the clips. */
function graphWith(creatorData: Record<string, unknown>) {
  return {
    nodes: [
      { id: "script", type: "ugc-script", data: { label: "script", targetDurationSec: 15 } },
      { id: "creator", type: "ugc-creator", data: { label: "creator", source: "sampled", gender: "woman", keepResult: false, ...creatorData } },
      { id: "clips", type: "ugc-clips", data: { label: "clips" } },
      { id: "clip", type: "ugc-clip", data: { label: "clip", rerender: {} } },
    ],
    edges: [
      { id: "e1", source: "script", target: "creator", sourceHandle: "category", targetHandle: "category" },
      { id: "e2", source: "script", target: "clips", sourceHandle: "plan", targetHandle: "plan" },
      { id: "e3", source: "creator", target: "clips", sourceHandle: "creator", targetHandle: "creator" },
      { id: "e4", source: "clips", target: "clip", sourceHandle: "clips", targetHandle: "clip" },
    ],
    settings: {},
    user_id: OWNER,
  }
}

async function runJob(opts: { graph: Record<string, unknown>; reviewerPresent?: boolean; nodeIds?: string[]; legacy?: boolean }) {
  mocks.workflows.set("wf-1", opts.graph)
  const data = {
    executionId: "exec-1", workflowId: "wf-1", userId: OWNER, triggerType: "manual",
    ...(opts.legacy ? {} : { reviewerPresent: opts.reviewerPresent ?? false }),
    ...(opts.nodeIds ? { nodeIds: opts.nodeIds } : {}),
  }
  await processWorkflowExecution({ data } as unknown as Job<WorkflowExecutionJob>)
}
function writeWith(status: string): Record<string, unknown> | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === status)
  return call?.[1] as Record<string, unknown> | undefined
}
const failedWith = () => writeWith("failed")?.error_message as string | undefined
const dispatched = () => [...mocks.executeNodeCalls].sort()

beforeEach(() => {
  mocks.executeNode.mockClear()
  mocks.executeNodeCalls.length = 0
  mocks.outputs.clear()
  mocks.runningStates.clear()
  mocks.failures.clear()
  mocks.updateExecutionWithRetry.mockClear()
  mocks.directUpdates.length = 0
  mocks.workflows.clear()
  mocks.execSelectRow.status = "queued"
  mocks.execSelectRow.node_states = {}
  mocks.cancelInFlightChildJobs.mockClear()
})

describe("Pick a creator first: the server's backstop for an editor run", () => {
  it("an editor-marked run that executes a creator with options waiting is refused before any node runs", async () => {
    const graph = graphWith({ source: "sampled", gender: "woman", keepResult: false, candidates: [OPTION, OPTION] })
    await runJob({ graph, reviewerPresent: true })
    expect(failedWith()).toBe(UGC_PICK_FIRST_MESSAGE)
    expect(dispatched()).toEqual([])
  })
  it("the same run with the creator outside its subset runs", async () => {
    await runJob({ graph: graphWith({ candidates: [OPTION, OPTION] }), reviewerPresent: true, nodeIds: ["clips"] })
    expect(failedWith()).not.toBe(UGC_PICK_FIRST_MESSAGE)
    expect(dispatched()).toEqual(["clips"])
  })
  it("a run nobody reviews is not refused (it never draws options)", async () => {
    await runJob({ graph: graphWith({ candidates: [OPTION, OPTION] }), reviewerPresent: false })
    expect(failedWith()).not.toBe(UGC_PICK_FIRST_MESSAGE)
  })
})

describe("Pick a creator first: the remaining rules", () => {
  it("a job queued before the field existed is not refused", async () => {
    await runJob({ graph: graphWith({ candidates: [OPTION, OPTION] }), legacy: true })
    expect(failedWith()).not.toBe(UGC_PICK_FIRST_MESSAGE)
  })
  it("a frozen creator does not run, so it is not refused", async () => {
    await runJob({ graph: graphWith({ candidates: [OPTION, OPTION], skipped: true }), reviewerPresent: true })
    expect(failedWith()).not.toBe(UGC_PICK_FIRST_MESSAGE)
  })
  it("a resumed run whose creator already stopped for the pick is not refused for its own options", async () => {
    const at = new Date().toISOString()
    mocks.execSelectRow.status = "running"
    mocks.execSelectRow.node_states = {
      script: { status: "completed", nodeType: "ugc-script", completedAt: at, output: { ugcOutputs: { plan: "{}" } } },
      creator: { status: "completed", nodeType: "ugc-creator", completedAt: at, output: { ugcCandidates: PAIR } },
    }
    // The editor painted this run's options onto the node before the re-pick.
    await runJob({ graph: graphWith({ candidates: PAIR }), reviewerPresent: true })
    expect(failedWith()).toBeUndefined()
    expect(dispatched()).toEqual([])
    const states = writeWith("completed")!.node_states as Record<string, { status: string }>
    expect(states.clips!.status).toBe("skipped")
    expect(states.clip!.status).toBe("skipped")
  })
  it("a refused re-pick cancels the jobs its earlier attempt left running", async () => {
    mocks.execSelectRow.status = "running"
    await runJob({ graph: graphWith({ candidates: PAIR }), reviewerPresent: true })
    expect(failedWith()).toBe(UGC_PICK_FIRST_MESSAGE)
    expect(mocks.cancelInFlightChildJobs).toHaveBeenCalledWith("exec-1", OWNER)
  })
})

describe("the pause: an editor run stops at a creator whose options wait for the pick", () => {
  it("nothing forward of it runs, the clips included, and the run ends completed", async () => {
    mocks.outputs.set("creator", { ugcCandidates: PAIR })
    await runJob({ graph: graphWith({}), reviewerPresent: true })
    expect(failedWith()).toBeUndefined()
    expect(dispatched()).toEqual(["creator", "script"])
    const states = writeWith("completed")!.node_states as Record<string, { status: string; output?: unknown }>
    expect(states.creator!.status).toBe("completed")
    expect(states.creator!.output).toEqual({ ugcCandidates: PAIR })
    expect(states.clips!.status).toBe("skipped")
    expect(states.clip!.status).toBe("skipped")
  })
  it("a running creator's state names its type: what a crash recovery reads to leave it running", async () => {
    mocks.outputs.set("creator", { ugcCandidates: PAIR })
    await runJob({ graph: graphWith({}), reviewerPresent: true })
    expect(mocks.runningStates.get("creator")).toMatchObject({ status: "running", nodeType: "ugc-creator" })
  })
  it("a creator handed on lets the run go on", async () => {
    mocks.outputs.set("creator", { ugcOutputs: { creator: "{}", image: "https://cdn.example/a.png" } })
    await runJob({ graph: graphWith({}), reviewerPresent: true })
    expect(dispatched()).toEqual(["clip", "clips", "creator", "script"])
  })
})

describe("a failed creator's charges count in the run's total", () => {
  it("the failed state shows what the creator was charged, and the run's total counts it", async () => {
    mocks.failures.set("creator", Object.assign(new Error("R"), { creditsUsed: 96 }))
    await runJob({ graph: graphWith({}), reviewerPresent: true })
    const failed = writeWith("failed")!
    const states = failed.node_states as Record<string, { status: string; creditsUsed?: number }>
    expect(states.creator).toMatchObject({ status: "failed", creditsUsed: 96 })
    // The script (1, completed) and the creator's own paid children (96).
    expect(failed.total_credits_used).toBe(1 + 96)
  })
  it("a failure that charged nothing counts nothing", async () => {
    mocks.failures.set("creator", new Error("bad"))
    await runJob({ graph: graphWith({}), reviewerPresent: true })
    const failed = writeWith("failed")!
    expect((failed.node_states as Record<string, { creditsUsed?: number }>).creator!.creditsUsed).toBeUndefined()
    expect(failed.total_credits_used).toBe(1)
  })
})
