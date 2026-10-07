/**
 * THE UP-FRONT RE-HOST SIZE SCAN, NESTED (SV12, decided 2026-10-06) — REAL
 * orchestrator path. A Speaker View inside a SUB-WORKFLOW relays like any
 * other on a self-host, so its edit's private sources over the re-host cap
 * refuse the whole run before ANY node dispatches — otherwise the parent's
 * relayed Transcribe (billed on the connected cloud account) charges first and
 * the nested Speaker View fails when its turn comes. Harness mirrors
 * transcribe-preflight-nested-orchestrator.test.ts (a `workflows` table keyed
 * by id), with the size probe mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  const executeNode = vi.fn(async (node: { id: string }) => {
    executeNodeCalls.push(node.id)
    return { output: { text: "x" }, creditsUsed: 0 }
  })
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const workflows = new Map<string, Record<string, unknown>>()
  const execSelectRow = { status: "queued", node_states: {} }

  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "workflows") {
        const row = workflows.get(filters.id as string)
        if (!row) return { data: null, error: { message: "nf" } }
        if (filters.user_id !== undefined && row.user_id !== filters.user_id) return { data: null, error: { message: "nf" } }
        return { data: row, error: null }
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
    update: () => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }))

  const flags = { cloud: false }
  const rehostByteSize = vi.fn(async (_url: string): Promise<number | undefined> => undefined)
  return { executeNode, executeNodeCalls, updateExecutionWithRetry, from, workflows, flags, rehostByteSize }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    REDIS_URL: "redis://localhost:6379",
    ORCHESTRATOR_CONCURRENCY: 2,
    MAX_CONCURRENT_NODES_PER_EXECUTION: 12,
  },
  hasCredits: () => mocks.flags.cloud,
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

vi.mock("@/providers/nodaro/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/nodaro/client.js")>()),
  rehostByteSize: mocks.rehostByteSize,
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"

const OWNER = "owner-1"
const PRIVATE_CAM = "http://localhost:9000/nodaro-assets/uploads/cam-a.mp4"
const plan = {
  version: 1,
  clock: "master",
  sources: [
    { id: "camA", url: PRIVATE_CAM, kind: "video" },
    { id: "mic", url: "https://media.example/mic.wav", kind: "audio", role: "master-audio" },
  ],
  segments: [{ id: "s0", inMs: 0, outMs: 30_000, video: "camA", speaker: "Host" }],
}

/** Parent: Transcribe (relayed, runs first) → sub-workflow S; S (or S's own
 *  sub-workflow) holds a Speaker View whose edit is written on the node. */
function makeJob(opts: { nested?: boolean } = {}): Job<WorkflowExecutionJob> {
  const inner = { nodes: [{ id: "sv1", type: "speaker-view", data: { edl: plan } }], edges: [] }
  mocks.workflows.set("wf-parent", {
    nodes: [
      { id: "tr1", type: "transcribe", data: { audioUrl: "https://media.example/mic.wav", provider: "elevenlabs-stt" } },
      { id: "sw1", type: "sub-workflow", data: { workflowId: "wf-child" } },
    ],
    edges: [{ id: "e1", source: "tr1", target: "sw1", sourceHandle: null, targetHandle: null }],
    settings: {},
    user_id: OWNER,
  })
  mocks.workflows.set("wf-child", {
    nodes: opts.nested ? [{ id: "sw2", type: "sub-workflow", data: { workflowId: "wf-grandchild" } }] : inner.nodes,
    edges: opts.nested ? [] : inner.edges,
    user_id: OWNER,
  })
  mocks.workflows.set("wf-grandchild", { ...inner, user_id: OWNER })
  return {
    data: { executionId: "exec-1", workflowId: "wf-parent", userId: OWNER, triggerType: "manual" },
  } as unknown as Job<WorkflowExecutionJob>
}

function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    ([, updates]) => (updates as { status?: string })?.status === "failed",
  )
  return call?.[1] as { error_message?: string } | undefined
}

describe("orchestrator pre-run check — a relayed Speaker View INSIDE a sub-workflow with a source over the re-host cap", () => {
  beforeEach(() => {
    mocks.executeNode.mockClear()
    mocks.executeNodeCalls.length = 0
    mocks.updateExecutionWithRetry.mockClear()
    mocks.workflows.clear()
    mocks.rehostByteSize.mockReset()
    mocks.rehostByteSize.mockImplementation(async (url: string) => (url === PRIVATE_CAM ? 3_100_000_000 : undefined))
    mocks.flags.cloud = false
  })

  it("refuses the run before ANY node dispatches — the parent's relayed Transcribe never runs — naming the path", async () => {
    await processWorkflowExecution(makeJob())
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()?.error_message).toBe(
      'Speaker View sends each source of the edit to nodaro.ai; "camA" is 3.1 GB, over the 500 MB limit. Use a public URL or a smaller file. (Sub-workflow node sw1 → Speaker View node sv1)',
    )
  })

  it("reaches a sub-workflow nested in a sub-workflow", async () => {
    await processWorkflowExecution(makeJob({ nested: true }))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()?.error_message).toMatch(/\(Sub-workflow node sw1 → sw2 → Speaker View node sv1\)$/)
  })

  it("runs when the nested edit's sources are within the cap", async () => {
    mocks.rehostByteSize.mockResolvedValue(undefined)
    await processWorkflowExecution(makeJob())
    expect(mocks.executeNodeCalls).toContain("tr1")
    expect(failedWrite()).toBeUndefined()
  })

  it("is inert on the cloud, where nothing is relayed", async () => {
    mocks.flags.cloud = true
    await processWorkflowExecution(makeJob())
    expect(mocks.rehostByteSize).not.toHaveBeenCalled()
    expect(failedWrite()?.error_message ?? "").not.toMatch(/nodaro\.ai;/)
  })
})
