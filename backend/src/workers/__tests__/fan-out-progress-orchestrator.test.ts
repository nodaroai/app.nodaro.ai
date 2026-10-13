/**
 * Progress of a fan-out whose list is made IN the run — REAL orchestrator path.
 *
 * Upload → Split into Chunks → Trim (Each). The pre-scan sizes the run before
 * the split has run, so Trim counts once (or as many times as the split's
 * saved parts, from an earlier run). Production run 8bda813a (2026-10-13) ended
 * at completed_nodes 4 of total_nodes 2 — the published-app runner reads that
 * as "4 of 2 nodes". The total is corrected to the iterations Trim really runs,
 * up or down, so every run ends with completed == total.
 *
 * Harness mirrors empty-input-skip-orchestrator.test.ts (leaf I/O only).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  let parts: string[] = []
  const executeNode = vi.fn(async (node: { id: string; type: string }) => {
    executeNodeCalls.push(node.id)
    if (node.type === "split-media") {
      return { output: { videoUrl: parts[0], videoUrls: parts }, creditsUsed: 0 }
    }
    return { output: { videoUrl: `https://cdn/trim-${executeNodeCalls.length}.mp4` }, creditsUsed: 0 }
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
    setParts: (urls: string[]) => {
      parts = urls
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

const part = (i: number) => `https://cdn/split-video-${i}.mp4`

function makeJob(splitData: Record<string, unknown> = {}): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      { id: "up", type: "upload-video", data: { label: "Upload Video", url: "https://cdn/src.mp4" } },
      { id: "split", type: "split-media", data: { label: "Split", chunkDuration: 10, minPartDuration: 4, ...splitData } },
      { id: "trim", type: "trim-video", data: { label: "Trim", startTime: 0, endTime: 0, fieldMappings: {}, trimMode: "keep-first-seconds", keepFirstSeconds: 2 } },
    ],
    edges: [
      { id: "e1", source: "up", target: "split", sourceHandle: "video", targetHandle: "video" },
      { id: "e2", source: "split", target: "trim", sourceHandle: "video", targetHandle: "in", data: { outputMode: "each" } },
    ],
    settings: {},
    user_id: "owner-1",
  })
  return {
    data: { executionId: "exec-1", workflowId: "wf-1", userId: "owner-1", triggerType: "manual" },
  } as unknown as Job<WorkflowExecutionJob>
}

type Write = { status?: string; completed_nodes?: number; total_nodes?: number }

function writes(): Write[] {
  const retried = mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => u as Write)
  return [...retried, ...(mocks.executionUpdates as Write[])]
}
const terminalWrite = () => writes().find((u) => u?.status === "completed" || u?.status === "failed")
const trimRuns = () => mocks.executeNodeCalls.filter((id) => id === "trim").length

describe("orchestrator — a fan-out over a list made in the run counts every iteration it runs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeNodeCalls.length = 0
    mocks.executionUpdates.length = 0
  })

  it("a split with no saved parts: the total grows from 2 to 4 and the run ends 4 of 4", async () => {
    mocks.setParts([part(0), part(1), part(2)])
    await processWorkflowExecution(makeJob())
    expect(trimRuns()).toBe(3)
    const end = terminalWrite()
    expect(end?.status).toBe("completed")
    expect(end?.total_nodes).toBe(4)
    expect(end?.completed_nodes).toBe(4)
    // The corrected total is persisted before the iterations run, so a poller
    // never sees more nodes done than the total.
    expect(writes().some((u) => u.total_nodes === 4 && u.status === undefined)).toBe(true)
  })

  it("saved parts from an earlier, longer split: the total shrinks to the parts this run made", async () => {
    mocks.setParts([part(0), part(1)])
    await processWorkflowExecution(makeJob({ generatedVideoUrls: [part(0), part(1), part(2), part(3), part(4)] }))
    expect(trimRuns()).toBe(2)
    const end = terminalWrite()
    expect(end?.status).toBe("completed")
    expect(end?.completed_nodes).toBe(3)
    expect(end?.total_nodes).toBe(3)
  })
})
