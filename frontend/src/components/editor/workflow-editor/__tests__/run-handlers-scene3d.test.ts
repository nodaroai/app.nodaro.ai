import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock variables (declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mockUpdateNodeData = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastInfo = vi.fn()
const mockGetWorkflowExecution = vi.fn()
const mockStreamWorkflowExecution = vi.fn()
let mockNodes: Array<{ id: string; type?: string; data: Record<string, unknown> }> = []
let mockEdges: unknown[] = []

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes,
      edges: mockEdges,
      updateNodeData: mockUpdateNodeData,
    }),
    // syncNodeStatesToStore batches its patches through setState (one React
    // re-render instead of N). The partial-failure tests below drive that real
    // path, so the mock has to actually commit the new nodes — otherwise the
    // subsequent revert step would still see pre-sync statuses.
    setState: (updater: unknown) => {
      const next =
        typeof updater === "function"
          ? (updater as (s: { nodes: typeof mockNodes }) => { nodes?: typeof mockNodes })({ nodes: mockNodes })
          : (updater as { nodes?: typeof mockNodes })
      if (next?.nodes) mockNodes = next.nodes
    },
  },
}))

vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getUserCredits: vi.fn(),
  getWorkflowExecution: (...args: unknown[]) => mockGetWorkflowExecution(...args),
  streamWorkflowExecution: (...args: unknown[]) => mockStreamWorkflowExecution(...args),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  }),
}))

vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))

vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))

vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: vi.fn() } }))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } },
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))

vi.mock("../types", () => ({
  WorkflowStaleError: class WorkflowStaleError extends Error {
    constructor() { super("Workflow changed during execution") }
  },
  MAX_CONSECUTIVE_POLL_FAILURES: 20,
  NODE_CREDIT_COSTS: { "generate-image": 1 } as Record<string, number>,
  isExecutableNode: (n: any) =>
    new Set(["generate-image", "generate-3d-scene", "edit-3d-scene"]).has(n.type ?? ""),
}))

vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn().mockReturnValue([]),
  getEffectivelySkippedIds: vi.fn().mockReturnValue(new Set()),
  collapseExpandedClones: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
}))

vi.mock("../node-input-resolver", () => ({
  getListInputForNode: vi.fn().mockReturnValue(null),
  getListFanOutForNode: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../execute-node", () => ({
  executeNode: vi.fn().mockResolvedValue(undefined),
  rejectAllManualEdits: vi.fn(),
}))

vi.mock("../list-execution", () => ({
  executeNodeForList: vi.fn().mockResolvedValue(undefined),
  expandLoopResults: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { streamBackendExecution, teardownActiveWorkflowStream } from "../run-handlers"
import type { ExecutionContext } from "../types"

function lastSseCallbacks(): {
  onNodeStatesChanged?: (s: Record<string, unknown>, m?: unknown) => void
  onCompleted?: () => void
} {
  const calls = mockStreamWorkflowExecution.mock.calls
  return calls[calls.length - 1]?.[1] ?? {}
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i) => i,
    untrackInterval: vi.fn(),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    setInsufficientCreditsData: vi.fn(),
    ...overrides,
  } as ExecutionContext
}

const REV_A = "11111111-1111-4111-8111-111111111111"
const REV_B = "22222222-2222-4222-8222-222222222222"
const REV_C = "33333333-3333-4333-8333-333333333333"

const plan = (revisionId: string, parentRevisionId?: string) => ({
  planType: "3d-scene",
  revisionId,
  ...(parentRevisionId ? { parentRevisionId } : {}),
})

/**
 * The FULL BACKEND DAG lane — a Run of the whole graph, results delivered by
 * the orchestrator rather than by the single-node poll.
 *
 * It used to write `updates[mapping.planField] = state.output.plan` straight
 * onto the node. For every other composer that is fine (their plan is not
 * user-editable between runs); for a 3D scene it silently overwrote whatever
 * the user nudged, restored or cleared while the orchestrator worked — the
 * exact race the single-node lane is careful about, on the lane nobody
 * checked.
 */
describe("syncNodeStatesToStore — Scene3D revision guard on the full-DAG path", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes = []
    mockEdges = []
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })
  })
  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  /** Drive one nodeStates delivery and read the node back. */
  function sync(states: Record<string, unknown>) {
    lastSseCallbacks().onNodeStatesChanged?.(states)
    return Object.fromEntries(mockNodes.map((n) => [n.id, n.data]))
  }

  it("captures the base revision on the tick the scene node starts running", () => {
    mockNodes = [{ id: "s1", type: "edit-3d-scene", data: { scenePlan: plan(REV_A), executionStatus: "idle" } }]
    streamBackendExecution("exec-1", makeCtx(), vi.fn(), vi.fn())
    const byId = sync({ s1: { status: "running", nodeType: "edit-3d-scene" } })
    expect(byId.s1.sceneJobBaseRevisionId).toBe(REV_A)
  })

  it("ADOPTS the produced revision when nothing moved underneath the run", () => {
    mockNodes = [{ id: "s1", type: "edit-3d-scene", data: { scenePlan: plan(REV_A), executionStatus: "idle" } }]
    streamBackendExecution("exec-2", makeCtx(), vi.fn(), vi.fn())
    sync({ s1: { status: "running", nodeType: "edit-3d-scene" } })
    const byId = sync({
      s1: { status: "completed", startedAt: "2026-10-03T10:00:00Z", nodeType: "edit-3d-scene", output: { plan: plan(REV_B, REV_A), changeSummary: "moved the wall" } },
    })
    expect((byId.s1.scenePlan as Record<string, unknown>).revisionId).toBe(REV_B)
    expect(byId.s1.expectedRevisionId).toBe(REV_B)
    expect((byId.s1.sceneHistory as Array<{ revisionId: string }>).map((e) => e.revisionId)).toEqual([REV_B])
    expect(byId.s1.sceneJobBaseRevisionId).toBeUndefined()
  })

  it("PARKS it when the user edited the scene while the orchestrator ran", () => {
    mockNodes = [{ id: "s1", type: "edit-3d-scene", data: { scenePlan: plan(REV_A), executionStatus: "idle" } }]
    streamBackendExecution("exec-3", makeCtx(), vi.fn(), vi.fn())
    sync({ s1: { status: "running", nodeType: "edit-3d-scene" } })
    // The manual nudge lands between the ticks.
    mockNodes[0].data = { ...mockNodes[0].data, scenePlan: plan(REV_C, REV_A) }
    const byId = sync({
      s1: { status: "completed", startedAt: "2026-10-03T10:00:00Z", nodeType: "edit-3d-scene", output: { plan: plan(REV_B, REV_A) } },
    })
    // The user's edit is still the active scene…
    expect((byId.s1.scenePlan as Record<string, unknown>).revisionId).toBe(REV_C)
    // …and the billed result is offered, not discarded.
    expect((byId.s1.scenePendingPlan as Record<string, unknown>).revisionId).toBe(REV_B)
    expect((byId.s1.sceneHistory as Array<{ revisionId: string }>).map((e) => e.revisionId)).toEqual([REV_B])
  })

  /**
   * A FAILED node used to be written as `{ executionStatus, errorMessage,
   * errorHint }` and nothing else — the branch never looked at `state.output`,
   * because "only a completed node has one" was an unstated convention.
   *
   * It is not true of a 3D scene. Once the repair budget is spent and only the
   * visual reviewer refuses, the run has already published a real, renderable
   * revision: the job fails, the credits stay committed, and the draft sits in
   * `output_data`. On a workflow Run that draft reached nothing — billed,
   * addressable by the artifact routes, invisible on the canvas.
   *
   * The reason this branch reads `state.output` rather than the error CODE is
   * what makes it survive a new one. `SCENE_QUALITY_FAILED` is no longer the
   * only refusal that retains a draft: a run whose visual review could not reach
   * its provider retains one under `SCENE_REVIEW_UNAVAILABLE`, on deployments
   * that do not deliver unreviewed scenes. The second case below pins that the
   * code is not part of the rule.
   */
  describe("a REFUSED run that retained its draft", () => {
    const refusal = (planRev: string, base?: string) => ({
      s1: {
        status: "failed",
        nodeType: "edit-3d-scene",
        error: "SCENE_QUALITY_FAILED: the reviewer refused the scene after 3 repair passes",
        output: { plan: plan(planRev, base) },
      },
    })

    it("keeps the draft AND the verdict", () => {
      mockNodes = [{ id: "s1", type: "edit-3d-scene", data: { scenePlan: plan(REV_A), executionStatus: "idle" } }]
      streamBackendExecution("exec-5", makeCtx(), vi.fn(), vi.fn())
      sync({ s1: { status: "running", nodeType: "edit-3d-scene" } })
      const byId = sync(refusal(REV_B, REV_A))

      expect((byId.s1.scenePlan as Record<string, unknown>).revisionId).toBe(REV_B)
      expect((byId.s1.sceneHistory as Array<{ revisionId: string }>).map((e) => e.revisionId)).toEqual([REV_B])
      // The refusal is NOT softened by the draft arriving.
      expect(byId.s1.executionStatus).toBe("failed")
      expect(byId.s1.errorMessage).toContain("SCENE_QUALITY_FAILED")
    })

    /**
     * The SAME branch, under the code round 10u added. Nothing here keys on the
     * error string, and that is the assertion: a draft retained because NOBODY
     * could review it reaches the canvas exactly as a refused one does, and the
     * node still fails with the reason it failed for. If this ever needs a new
     * case per error code, the branch has stopped reading the output.
     */
    it("keeps the draft when the review could not be performed at all", () => {
      mockNodes = [{ id: "s1", type: "edit-3d-scene", data: { scenePlan: plan(REV_A), executionStatus: "idle" } }]
      streamBackendExecution("exec-5u", makeCtx(), vi.fn(), vi.fn())
      sync({ s1: { status: "running", nodeType: "edit-3d-scene" } })
      const byId = sync({
        s1: {
          status: "failed",
          nodeType: "edit-3d-scene",
          error: "SCENE_REVIEW_UNAVAILABLE: The scene built and every mandatory assertion passed, "
            + "but the visual review did not reach its provider in 2 attempts; it was retained unreviewed.",
          output: { plan: plan(REV_B, REV_A) },
        },
      })

      expect((byId.s1.scenePlan as Record<string, unknown>).revisionId).toBe(REV_B)
      expect((byId.s1.sceneHistory as Array<{ revisionId: string }>).map((e) => e.revisionId)).toEqual([REV_B])
      expect(byId.s1.executionStatus).toBe("failed")
      // Reported as what it is — never softened into a refusal nobody made.
      expect(byId.s1.errorMessage).toContain("SCENE_REVIEW_UNAVAILABLE")
      expect(byId.s1.errorMessage).not.toMatch(/refus/i)
    })

    it("PARKS the retained draft when the user edited the scene mid-run", () => {
      mockNodes = [{ id: "s1", type: "edit-3d-scene", data: { scenePlan: plan(REV_A), executionStatus: "idle" } }]
      streamBackendExecution("exec-6", makeCtx(), vi.fn(), vi.fn())
      sync({ s1: { status: "running", nodeType: "edit-3d-scene" } })
      mockNodes[0].data = { ...mockNodes[0].data, scenePlan: plan(REV_C, REV_A) }
      const byId = sync(refusal(REV_B, REV_A))

      expect((byId.s1.scenePlan as Record<string, unknown>).revisionId).toBe(REV_C)
      expect((byId.s1.scenePendingPlan as Record<string, unknown>).revisionId).toBe(REV_B)
      expect(byId.s1.executionStatus).toBe("failed")
    })

    it("writes the plain refusal untouched when the run retained nothing", () => {
      mockNodes = [{ id: "s1", type: "edit-3d-scene", data: { scenePlan: plan(REV_A), executionStatus: "idle" } }]
      streamBackendExecution("exec-7", makeCtx(), vi.fn(), vi.fn())
      const byId = sync({
        s1: { status: "failed", nodeType: "edit-3d-scene", error: "Compiler refused every recipe" },
      })
      expect(byId.s1.executionStatus).toBe("failed")
      expect((byId.s1.scenePlan as Record<string, unknown>).revisionId).toBe(REV_A)
      expect(byId.s1.sceneHistory).toBeUndefined()
    })

    it("ignores an output on a failed NON-scene node (no plan field is invented)", () => {
      mockNodes = [{ id: "m1", type: "motion-graphics", data: { executionStatus: "idle" } }]
      streamBackendExecution("exec-8", makeCtx(), vi.fn(), vi.fn())
      const byId = sync({
        m1: { status: "failed", nodeType: "motion-graphics", error: "boom", output: { plan: { kind: "motion" } } },
      })
      expect(byId.m1.executionStatus).toBe("failed")
      expect(byId.m1.motionPlan).toBeUndefined()
    })
  })

  it("leaves every OTHER composer's plan field assigned exactly as before", () => {
    mockNodes = [{ id: "m1", type: "motion-graphics", data: { executionStatus: "idle" } }]
    streamBackendExecution("exec-4", makeCtx(), vi.fn(), vi.fn())
    const byId = sync({
      m1: { status: "completed", startedAt: "2026-10-03T10:00:00Z", nodeType: "motion-graphics", output: { plan: { kind: "motion" } } },
    })
    expect(byId.m1.motionPlan).toEqual({ kind: "motion" })
    expect(byId.m1.sceneHistory).toBeUndefined()
  })
})
