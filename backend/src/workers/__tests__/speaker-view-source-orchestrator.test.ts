/**
 * THE PRE-RUN REFUSALS FOR A VIDEO-FED SPEAKER VIEW — REAL orchestrator path
 * (decided 2026-10-12, R5 and F5).
 *
 * Once Speaker View is priced, a run that cannot succeed is still refused
 * before any node dispatches, so Transcribe never charges for it:
 *   - an edit and a video together, no transcript wired — in the top graph and
 *     in every sub-workflow graph;
 *   - a source that EXISTS at run start and is too narrow for the target (D18),
 *     or has no face for a node that opts in (R2), from the one cached
 *     measurement. A source the run produces is checked at the dispatch gate.
 * Each names the node by its LABEL. Harness mirrors
 * speaker-view-unpriced-preflight-orchestrator.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// `priced`: Speaker View; `frames`: Speaker Frames. Video mode runs only with both (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) =>
  (await import("../../__tests__/helpers/speaker-view-video-gate-mock.js")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag),
)
const measure = vi.hoisted(() => vi.fn(async (_url: string): Promise<{ durationMs: number; width?: number; height?: number; faces?: "present" | "none" | "unknown" }> => ({ durationMs: 14_600, width: 3840, height: 2160, faces: "present" })))
vi.mock("@/lib/clip-measure.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/clip-measure.js")>()),
  measureClip: measure,
}))
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// Mocks — leaf I/O only.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  const executeNode = vi.fn(async (node: { id: string }) => {
    executeNodeCalls.push(node.id)
    return { output: { text: "x" }, creditsUsed: 0 }
  })

  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })

  /** The `workflows` table: id → row. The parent and every referenced graph. */
  const workflows = new Map<string, Record<string, unknown>>()
  /** Owner scoping of each nested (`nodes, edges`) load. */
  const nestedLoads: Array<{ id: unknown; userId: unknown }> = []
  const execSelectRow = { status: "queued", node_states: {} }

  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "workflows") {
        if (columns === "nodes, edges") nestedLoads.push({ id: filters.id, userId: filters.user_id })
        const row = workflows.get(filters.id as string)
        if (!row) return { data: null, error: { message: "nf" } }
        // The nested load is owner-scoped; an unscoped parent load has no filter.
        if (filters.user_id !== undefined && row.user_id !== filters.user_id) {
          return { data: null, error: { message: "nf" } }
        }
        return { data: row, error: null }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") {
        return { data: execSelectRow, error: null }
      }
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

  return { executeNode, executeNodeCalls, updateExecutionWithRetry, from, workflows, nestedLoads }
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

import { processWorkflowExecution } from "../orchestrator-worker.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = "owner-1"
const VIDEO = "https://cdn.example.test/uploads/videos/clip.mp4"

const wire = (id: string, source: string, target: string, targetHandle: string | null) => ({ id, source, target, sourceHandle: null, targetHandle })

/** The video-fed graph: an Upload (or Generate Video) -> Transcribe -> Speaker View, and the video straight into the Speaker View. */
function videoGraph(opts: { source?: "upload-video" | "generate-video"; transcript?: boolean; svData?: Record<string, unknown> } = {}) {
  const sourceType = opts.source ?? "upload-video"
  return {
    nodes: [
      { id: "up", type: sourceType, data: sourceType === "upload-video" ? { label: "Video", url: VIDEO } : { label: "Gen", prompt: "a cat" } },
      { id: "tx", type: "transcribe", data: { label: "Transcribe" } },
      { id: "sv", type: "speaker-view", data: { label: "Vertical cut", ...opts.svData } },
    ],
    edges: [
      wire("e1", "up", "tx", "audio"),
      wire("e2", "up", "sv", "video"),
      ...(opts.transcript === false ? [] : [wire("e3", "tx", "sv", "transcript")]),
    ],
  }
}

function makeJob(opts: { graph?: ReturnType<typeof videoGraph>; nested?: ReturnType<typeof videoGraph>; subset?: string[] } = {}): Job<WorkflowExecutionJob> {
  const g = opts.graph ?? videoGraph()
  mocks.workflows.set("wf-parent", {
    nodes: opts.nested ? [{ id: "gv1", type: "generate-video", data: { prompt: "a cat" } }, { id: "sw1", type: "sub-workflow", data: { workflowId: "wf-child" } }] : g.nodes,
    edges: opts.nested ? [wire("e1", "gv1", "sw1", null)] : g.edges,
    settings: {},
    user_id: OWNER,
  })
  mocks.workflows.set("wf-child", { nodes: opts.nested?.nodes ?? [], edges: opts.nested?.edges ?? [], user_id: OWNER })
  return {
    data: {
      executionId: "exec-1", workflowId: "wf-parent", userId: OWNER, triggerType: "manual",
      ...(opts.subset ? { nodeIds: opts.subset } : {}),
    },
  } as unknown as Job<WorkflowExecutionJob>
}

function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    ([, updates]) => (updates as { status?: string })?.status === "failed",
  )
  return call?.[1] as { error_message?: string } | undefined
}

describe("orchestrator pre-run check — a priced, video-fed Speaker View", () => {
  beforeEach(() => {
    flag.priced = true
    flag.frames = true
    measure.mockClear()
    measure.mockImplementation(async () => ({ durationMs: 14_600, width: 3840, height: 2160, faces: "present" as const }))
    mocks.executeNode.mockClear()
    mocks.executeNodeCalls.length = 0
    mocks.updateExecutionWithRetry.mockClear()
    mocks.workflows.clear()
    mocks.nestedLoads.length = 0
  })

  it("lets a wide upload through after ONE measurement, and runs the nodes", async () => {
    await processWorkflowExecution(makeJob())
    expect(failedWrite()).toBeUndefined()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(measure).toHaveBeenCalledWith(VIDEO)
    expect(mocks.executeNodeCalls).toContain("tx")
  })

  it("D18 for every source: refuses a measured-too-narrow upload before ANY node runs, naming the LABEL", async () => {
    measure.mockImplementation(async () => ({ durationMs: 5000, width: 1080, height: 1920, faces: "present" as const }))
    await processWorkflowExecution(makeJob())
    expect(mocks.executeNodeCalls, "Transcribe must never have been dispatched").toEqual([])
    const message = failedWrite()!.error_message!
    expect(message).toMatch(/1080×1920/)
    expect(message).toContain('Speaker View node "Vertical cut"')
    expect(message).not.toMatch(/\bsv\b/)
    expect(message).toMatch(/nothing was charged/)
  })

  it("R2: a faceless clip refuses a node that opts in, and only that node", async () => {
    measure.mockImplementation(async () => ({ durationMs: 5000, width: 3840, height: 2160, faces: "none" as const }))
    await processWorkflowExecution(makeJob({ graph: videoGraph({ svData: { requireFaces: true } }) }))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toMatch(/no faces/i)
    mocks.updateExecutionWithRetry.mockClear()
    await processWorkflowExecution(makeJob())
    expect(failedWrite()).toBeUndefined()
  })

  it("a source the run produces is not measured at run start: the dispatch gate does it once the video exists", async () => {
    await processWorkflowExecution(makeJob({ graph: videoGraph({ source: "generate-video" }) }))
    expect(measure).not.toHaveBeenCalled()
    expect(failedWrite()).toBeUndefined()
    // The feeder waits for the source (the level builder orders it after).
    expect(mocks.executeNodeCalls.indexOf("up")).toBeLessThan(mocks.executeNodeCalls.indexOf("tx"))
  })

  it("refuses a video with no transcript wired, naming the label (top graph)", async () => {
    await processWorkflowExecution(makeJob({ graph: videoGraph({ transcript: false }) }))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toMatch(/Transcribe/)
    expect(failedWrite()!.error_message).toContain('Speaker View node "Vertical cut"')
  })

  it("F5: refuses the same inside a sub-workflow graph, and names the path to it", async () => {
    await processWorkflowExecution(makeJob({ nested: videoGraph({ transcript: false }) }))
    expect(mocks.executeNodeCalls).toEqual([])
    const message = failedWrite()!.error_message!
    expect(message).toMatch(/Transcribe/)
    expect(message).toContain('Speaker View node "Vertical cut"')
    expect(message).toContain("Found inside Sub-workflow node sw1")
  })

  it("does not refuse a run that does not execute the Speaker View (a partial run of the upstream node)", async () => {
    measure.mockImplementation(async () => ({ durationMs: 5000, width: 1080, height: 1920 }))
    await processWorkflowExecution(makeJob({ subset: ["tx"] }))
    expect(failedWrite()).toBeUndefined()
    expect(measure).not.toHaveBeenCalled()
  })

  it("is quiet while Speaker View has no price: the unpriced refusal speaks, nothing is measured", async () => {
    flag.priced = false
    await processWorkflowExecution(makeJob())
    expect(failedWrite()!.error_message).toContain("Speaker View is not priced yet")
    expect(measure).not.toHaveBeenCalled()
  })

  it("R15: while Speaker Frames is unpriced, video mode is refused at run start and nothing is measured", async () => {
    flag.frames = false
    await processWorkflowExecution(makeJob())
    expect(failedWrite()!.error_message).toContain("Speaker View from a video is not available yet")
    expect(measure).not.toHaveBeenCalled()
    expect(mocks.executeNode).not.toHaveBeenCalled()
  })
})
