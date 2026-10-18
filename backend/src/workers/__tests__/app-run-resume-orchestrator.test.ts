/**
 * An app run's Retry continues its failed execution — REAL orchestrator path, three generations.
 *
 * The run's UGC Clip fails on clip 2 (gen 1). A Retry (gen 2, a continue-from-failed of gen 1)
 * renders only what gen 1 did not finish: clips 1 and 3 are handed back by the clip route, which
 * keys a clip by the run's chain root (`runKey`, lib/continuation-run-root.ts) — the same for
 * every generation. Gen 2 fails on clip 2 again; gen 3, continuing gen 2, still names gen 1's
 * root, and only clip 2 is charged. A Retry is the run going on (`appRunResume`): it settles the
 * creator's markup on what it ran, once.
 *
 * The clip route is simulated at the node executor: a clip of the same row under the same run key
 * already made is handed back at no cost, as the plugin's content key does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { NodeExecutionState, WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const TICKETS = [0, 1, 2].map((i) => JSON.stringify({ v: 1, index: i, durationSec: 8, video: { tool: "t", args: {} } }))
  /** The clip route's rows: `${row}|${runKey}` -> its job. */
  const clipRows = new Map<string, string>()
  /** Each clip request: its row, the run key it named and what it charged. */
  const clipCalls: Array<{ execution: string; row: number; runKey: string | undefined; credits: number }> = []
  let failing = new Set<number>()
  let jobSeq = 0
  const executeNodeCalls: string[] = []
  const executeNode = vi.fn(async (node: { id: string; type: string }, _i: unknown, _e: unknown, _n: unknown, _s: unknown, ctx: Record<string, unknown>, i?: number) => {
    executeNodeCalls.push(node.id)
    if (node.type === "ugc-clips") return { output: { listResults: TICKETS, ugcOutputs: { clips: TICKETS[0] } }, creditsUsed: 30 }
    if (node.type === "ugc-clip") {
      const { ugcClipRunKey } = await import("../../services/workflow-engine/ugc-sync-nodes.js")
      const runKey = ugcClipRunKey(ctx as never)
      const row = i ?? 0
      const key = `${row}|${runKey}`
      const made = clipRows.get(key)
      if (made) {
        clipCalls.push({ execution: ctx.executionId as string, row, runKey, credits: 0 })
        return { output: { videoUrl: `https://cdn/clip-${row}.mp4` }, jobId: made, creditsUsed: 0 }
      }
      if (failing.has(row)) {
        clipCalls.push({ execution: ctx.executionId as string, row, runKey, credits: 0 })
        throw new Error(`Clip ${row + 1} failed`)
      }
      const jobId = `job-clip-${row}-${++jobSeq}`
      clipRows.set(key, jobId)
      clipCalls.push({ execution: ctx.executionId as string, row, runKey, credits: 400 })
      return { output: { videoUrl: `https://cdn/clip-${row}.mp4` }, jobId, creditsUsed: 400 }
    }
    return { output: { videoUrl: `https://cdn/${node.id}.mp4` }, creditsUsed: 10 }
  })
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const directUpdates: Array<Record<string, unknown>> = []
  const apps = new Map<string, Record<string, unknown>>()
  const executions = new Map<string, Record<string, unknown>>()
  const appRuns = new Map<string, string>()
  const execSelectRow = { status: "queued", node_states: {} }

  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "published_apps") {
        const row = apps.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
      if (table === "workflow_executions") return { data: executions.get(filters.id as string) ?? null, error: null }
      if (table === "app_runs") {
        const appId = appRuns.get(filters.execution_id as string)
        return { data: appId ? { id: "run-1", app_id: appId, input_values: null } : null, error: null }
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
  return {
    executeNode, executeNodeCalls, clipCalls, clipRows, updateExecutionWithRetry, directUpdates, from, rpc, apps, executions, appRuns,
    setFailing: (rows: number[]) => { failing = new Set(rows) },
  }
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
vi.mock("@/lib/execution-writes.js", () => ({ updateExecutionWithRetry: mocks.updateExecutionWithRetry }))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"
import { fromFailedRunSet } from "../../services/workflow-engine/run-continuation.js"

const RUNNER = "runner-1"
const NODE_IDS = ["clips", "clip", "join"]

function job(data: Partial<WorkflowExecutionJob>): Job<WorkflowExecutionJob> {
  return {
    data: { executionId: "exec-1", workflowId: "wf-1", userId: RUNNER, triggerType: "app_run", appVersionId: "app-1", reviewerPresent: true, ...data },
  } as unknown as Job<WorkflowExecutionJob>
}

/** What the orchestrator last wrote of an execution's node states. */
function lastStates(): Record<string, NodeExecutionState> {
  const writes = mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => u as { node_states?: Record<string, NodeExecutionState> })
  return writes.filter((u) => u.node_states?.clip).at(-1)!.node_states!
}

/** Store an ended generation as the row the next one continues (its states, its stamps). */
function ended(id: string, triggerData: Record<string, unknown>) {
  mocks.executions.set(id, {
    id, user_id: RUNNER, workflow_id: "wf-1", status: "failed", started_at: "2026-10-18T10:00:00.000Z",
    // An app run's execution (lib/server-started-runs.ts: its stamps are the platform's).
    trigger_type: "app_run", node_states: lastStates(), trigger_data: triggerData,
  })
  mocks.appRuns.set(id, "app-1")
}

/** A Retry of `from`: what it did not complete, continued. */
async function retry(executionId: string, from: string) {
  const source = mocks.executions.get(from)! as { node_states: Record<string, NodeExecutionState> }
  const nodeIds = fromFailedRunSet(NODE_IDS, { nodeStates: source.node_states })
  mocks.updateExecutionWithRetry.mockClear()
  mocks.rpc.mockClear()
  // The route moved the run's pointer to the Retry's execution.
  mocks.appRuns.set(executionId, "app-1")
  await processWorkflowExecution(job({ executionId, continueFromExecutionId: from, continueMode: "from-failed", appRunResume: true, nodeIds }))
  return nodeIds
}

const monetizationCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === "process_app_monetization")

beforeEach(() => {
  vi.clearAllMocks()
  mocks.executeNodeCalls.length = 0
  mocks.clipCalls.length = 0
  mocks.clipRows.clear()
  mocks.directUpdates.length = 0
  mocks.executions.clear()
  mocks.appRuns.clear()
  mocks.apps.set("app-1", {
    snapshot_nodes: [
      { id: "clips", type: "ugc-clips", data: { label: "UGC Clips" } },
      { id: "clip", type: "ugc-clip", data: { label: "UGC Clip", rerender: {} } },
      { id: "join", type: "combine-videos", data: { label: "Join" } },
    ],
    snapshot_edges: [
      { id: "e1", source: "clips", target: "clip", sourceHandle: "clips", targetHandle: "clip" },
      { id: "e2", source: "clip", target: "join", sourceHandle: "video-out", targetHandle: "videos", data: { outputMode: "bundle" } },
    ],
    snapshot_settings: {},
    creator_id: "creator-1",
    publish_type: "app",
    monetization_enabled: true,
    monetization_flat_fee: 5,
    monetization_percent: 20,
  })
  mocks.appRuns.set("exec-1", "app-1")
})

describe("an app run's Retry renders and charges only what the failed run did not finish", () => {
  it("three generations: every clip names gen 1's root, the finished clips are handed back, only clip 2 is charged", async () => {
    // Gen 1: the run itself. Clip 2 fails; clips 1 and 3 are made (and charged) under the run's own key.
    mocks.setFailing([1])
    await processWorkflowExecution(job({ executionId: "exec-1" }))
    expect(lastStates().clip?.status).toBe("failed")
    expect(monetizationCalls()).toHaveLength(0)
    ended("exec-1", { appRun: { appRunId: "run-1" } })
    expect(mocks.clipCalls.filter((c) => c.execution === "exec-1").map((c) => c.runKey)).toEqual(["exec-1", "exec-1", "exec-1"])

    // Gen 2: a Retry of gen 1. UGC Clips is seeded (never run, never charged); clip 2 fails again.
    mocks.clipCalls.length = 0
    mocks.executeNodeCalls.length = 0
    const ran2 = await retry("exec-2", "exec-1")
    expect(ran2).toEqual(["clip", "join"])
    expect(mocks.executeNodeCalls).not.toContain("clips")
    expect(mocks.clipCalls.map((c) => [c.row, c.runKey, c.credits]).sort()).toEqual([[0, "exec-1", 0], [1, "exec-1", 0], [2, "exec-1", 0]])
    // The root is written on gen 2 for the next generation.
    expect(mocks.directUpdates.filter((u) => u.trigger_data !== undefined).at(-1)).toMatchObject({ trigger_data: { runRoot: { executionId: "exec-1" } } })
    expect(lastStates().clip?.status).toBe("failed")
    ended("exec-2", { appRun: { appRunId: "run-1", resumedFrom: "exec-1" }, runRoot: { executionId: "exec-1" } })

    // Gen 3: a Retry of gen 2. Clip 2 renders now: the only clip charged.
    mocks.setFailing([])
    mocks.clipCalls.length = 0
    await retry("exec-3", "exec-2")
    expect(mocks.clipCalls.map((c) => [c.row, c.runKey, c.credits]).sort()).toEqual([[0, "exec-1", 0], [1, "exec-1", 400], [2, "exec-1", 0]])
    const states = lastStates()
    expect(states.clip).toMatchObject({ status: "completed", creditsUsed: 400 })
    expect(states.join?.status).toBe("completed")
    expect(states.clips?.status).toBe("completed")
    // The Retry is the run going on: it settles the creator's markup once, on what it ran (clip 2 and the join).
    expect(monetizationCalls()).toHaveLength(1)
    expect(monetizationCalls()[0]![1]).toMatchObject({ p_base_cost: 410 })
  })

  it("a continuation that is no Retry (a Render final) still settles no markup", async () => {
    mocks.setFailing([1])
    await processWorkflowExecution(job({ executionId: "exec-1" }))
    ended("exec-1", { appRun: { appRunId: "run-1" } })
    mocks.setFailing([])
    const source = mocks.executions.get("exec-1")! as { node_states: Record<string, NodeExecutionState> }
    mocks.rpc.mockClear()
    // Even with a run row naming it: only a Retry settles markup.
    mocks.appRuns.set("exec-2", "app-1")
    await processWorkflowExecution(
      job({ executionId: "exec-2", continueFromExecutionId: "exec-1", continueMode: "from-failed", nodeIds: fromFailedRunSet(NODE_IDS, { nodeStates: source.node_states }) }),
    )
    expect(monetizationCalls()).toHaveLength(0)
  })
})
