/**
 * THE UP-FRONT RE-HOST SIZE SCAN (SV12, decided 2026-10-06) — REAL orchestrator
 * path. On a self-host Speaker View runs on nodaro.ai, and the relay re-hosts
 * each private source of its edit (500 MB cap). A known edit with a source over
 * the cap refuses the whole run BEFORE any node dispatches — otherwise a relayed
 * node upstream (Transcribe here, billed on the connected cloud account) charges
 * first and Speaker View then fails inside the re-host. Inert on the cloud,
 * where nothing relays. Harness mirrors transcribe-preflight-orchestrator.test.ts.
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

  const flags = { cloud: false }
  const rehostByteSize = vi.fn(async (_url: string): Promise<number | undefined> => undefined)
  return {
    flags,
    rehostByteSize,
    executeNode,
    executeNodeCalls,
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

// These cases are about the re-host cap on a Speaker View that WOULD run, so it
// stands as priced: while it is not, the run-start refusal for an unpriced node
// (speaker-view-unpriced-preflight-orchestrator.test.ts) fires first.
vi.mock("@nodaro/render-rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/render-rules")>()
  return { ...actual, SPEAKER_VIEW_PRICED: true }
})

import { processWorkflowExecution } from "../orchestrator-worker.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** A saved Edit Plan (outside the run) --edl--> Speaker View <--transcript-- Transcribe (runs). */
function makeJob(): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      { id: "up1", type: "upload-audio", data: { audioUrl: "https://media.example/mic.wav" } },
      { id: "tr1", type: "transcribe", data: { audioUrl: "https://media.example/mic.wav", provider: "elevenlabs-stt" } },
      { id: "ep1", type: "edit-plan", data: { generatedJson: plan } },
      { id: "sv1", type: "speaker-view", data: {} },
    ],
    edges: [
      { id: "e1", source: "up1", target: "tr1", sourceHandle: "audio", targetHandle: "audio" },
      { id: "e2", source: "ep1", target: "sv1", sourceHandle: "edl", targetHandle: "edl" },
      { id: "e3", source: "tr1", target: "sv1", sourceHandle: "json", targetHandle: "transcript" },
    ],
    settings: {},
    user_id: "owner-1",
  })
  return {
    data: { executionId: "exec-1", workflowId: "wf-1", userId: "owner-1", triggerType: "manual", nodeIds: ["tr1", "sv1"] },
  } as unknown as Job<WorkflowExecutionJob>
}

function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    ([, updates]) => (updates as { status?: string })?.status === "failed",
  )
  return call?.[1] as { error_message?: string } | undefined
}

describe("orchestrator pre-run check — a relayed Speaker View source over the re-host cap", () => {
  beforeEach(() => {
    mocks.executeNode.mockClear()
    mocks.executeNodeCalls.length = 0
    mocks.updateExecutionWithRetry.mockClear()
    mocks.rehostByteSize.mockReset()
    mocks.rehostByteSize.mockResolvedValue(undefined)
    mocks.flags.cloud = false
  })

  it("refuses the run before ANY node dispatches — the relayed Transcribe never runs — naming the node and the source", async () => {
    mocks.rehostByteSize.mockImplementation(async (url: string) => (url === PRIVATE_CAM ? 3_100_000_000 : undefined))
    await processWorkflowExecution(makeJob())

    expect(mocks.executeNodeCalls).toEqual([])
    const failed = failedWrite()
    expect(failed, "the execution row must be failed, not left running").toBeDefined()
    expect(failed!.error_message).toBe(
      'Speaker View sends each source of the edit to nodaro.ai; "camA" is 3.1 GB, over the 500 MB limit. Use a public URL or a smaller file. (Speaker View node sv1)',
    )
  })

  it("runs when every source is within the cap, or its size cannot be read", async () => {
    await processWorkflowExecution(makeJob())
    expect(mocks.executeNodeCalls).toContain("tr1")
    expect(failedWrite()).toBeUndefined()
  })

  it("is inert on the cloud, where Speaker View runs in place and nothing is re-hosted", async () => {
    mocks.flags.cloud = true
    mocks.rehostByteSize.mockResolvedValue(9_000_000_000)
    await processWorkflowExecution(makeJob())
    expect(mocks.rehostByteSize).not.toHaveBeenCalled()
    expect(failedWrite()?.error_message ?? "").not.toMatch(/re-host|nodaro\.ai;/)
  })
})
