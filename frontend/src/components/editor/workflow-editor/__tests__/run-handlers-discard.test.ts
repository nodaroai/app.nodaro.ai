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
    new Set(["generate-image", "image-to-video", "generate-video"]).has(n.type ?? ""),
}))

vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn().mockReturnValue([]),
  getEffectivelySkippedIds: vi.fn().mockReturnValue(new Set()),
  collapseExpandedClones: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
}))

vi.mock("../node-input-resolver", () => ({
  getListInputForNode: vi.fn().mockReturnValue(null),
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

// Pull the SSE callbacks object (2nd arg to streamWorkflowExecution) so a test
// can drive onDiscarded directly instead of relying on the poll loop.
function lastSseCallbacks(): {
  onNodeStatesChanged?: (s: Record<string, unknown>, m?: unknown) => void
  onCompleted?: () => void
  onFailed?: (d: Record<string, unknown>) => void
  onCancelled?: () => void
  onDiscarded?: () => void
} {
  const calls = mockStreamWorkflowExecution.mock.calls
  return calls[calls.length - 1]?.[1] ?? {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests — whole-workflow discard detach
// ---------------------------------------------------------------------------

describe("streamBackendExecution — discarded run detach", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes = []
    mockEdges = []
    // Release any module-level active-stream slot left over from a prior test so
    // each test starts with no stream registered.
    teardownActiveWorkflowStream()
    // Keep the SSE path silent so the poll loop drives the discard. A
    // never-resolving promise means no done-event ever fires.
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("does NOT paint the discarded run's nodeStates and reverts active nodes to idle", async () => {
    // A node that is currently running in THIS run (would be reverted), and a
    // node the discarded execution reports as completed-with-result (must NOT
    // be painted onto the canvas).
    mockNodes = [
      { id: "running-node", type: "generate-image", data: { label: "img", executionStatus: "running", currentJobId: "job-1" } },
      { id: "done-node", type: "generate-image", data: { label: "img2", executionStatus: "pending" } },
    ]

    mockGetWorkflowExecution.mockResolvedValue({
      status: "discarded",
      nodeStates: {
        // The discarded run "completed" done-node with a result. The detach
        // guard must prevent this from landing on the canvas.
        "done-node": { status: "completed", output: { imageUrl: "https://cdn.example.com/discarded.png" } },
      },
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()
    const onExecutionEnded = vi.fn()

    streamBackendExecution("exec-discard-1", ctx, setIsRunning, onExecutionEnded)

    // First poll fires at 1000ms.
    await vi.advanceTimersByTimeAsync(1000)

    // The discarded run's completed nodeState must NEVER be applied — there must
    // be NO updateNodeData call that paints done-node with the result under ANY
    // field (generatedImageUrl, generatedResults, the raw url, etc.). Asserting
    // on a single field would let a result leaking through a different field slip
    // by; instead, scan every patch written to done-node for the discarded url.
    const discardedUrl = "https://cdn.example.com/discarded.png"
    const paintedDone = mockUpdateNodeData.mock.calls.find((c: any[]) => {
      if (c[0] !== "done-node") return false
      const patch = (c[1] ?? {}) as Record<string, unknown>
      if (patch.generatedImageUrl !== undefined) return true
      if (JSON.stringify(patch).includes(discardedUrl)) return true
      // A non-empty generatedResults write also counts as painting the result.
      if (Array.isArray(patch.generatedResults) && patch.generatedResults.length > 0) return true
      return false
    })
    expect(paintedDone).toBeUndefined()

    // The running node from this run is reverted to idle with currentJobId cleared.
    expect(mockUpdateNodeData).toHaveBeenCalledWith("running-node", {
      executionStatus: "idle",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
    // The pending node is also reverted.
    expect(mockUpdateNodeData).toHaveBeenCalledWith("done-node", {
      executionStatus: "idle",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })

    // The stream self-detaches (cleanup → onExecutionEnded) and toasts the discard.
    expect(onExecutionEnded).toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Run discarded — in-flight results will be saved to My Library",
    )
  })

  it("ignores subsequent polls after a discard (idempotent cleanup)", async () => {
    mockNodes = [
      { id: "n1", type: "generate-image", data: { label: "img", executionStatus: "running", currentJobId: "job-1" } },
    ]
    mockGetWorkflowExecution.mockResolvedValue({ status: "discarded", nodeStates: {} })

    const ctx = makeCtx()
    const onExecutionEnded = vi.fn()

    streamBackendExecution("exec-discard-2", ctx, vi.fn(), onExecutionEnded)

    await vi.advanceTimersByTimeAsync(1000)
    // Advance well past further poll intervals.
    await vi.advanceTimersByTimeAsync(9000)

    // onExecutionEnded fires exactly once despite multiple poll ticks.
    expect(onExecutionEnded).toHaveBeenCalledTimes(1)
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
  })

  it("handles discard arriving via the SSE onDiscarded callback (not the poll)", async () => {
    mockNodes = [
      { id: "running-node", type: "generate-image", data: { label: "img", executionStatus: "running", currentJobId: "job-1" } },
      { id: "done-node", type: "generate-image", data: { label: "img2", executionStatus: "pending" } },
    ]
    // Keep the poll loop NON-terminal (status "running") so the ONLY discard
    // signal is the SSE onDiscarded callback we fire below.
    mockGetWorkflowExecution.mockResolvedValue({
      status: "running",
      nodeStates: {
        "done-node": { status: "completed", output: { imageUrl: "https://cdn.example.com/discarded.png" } },
      },
    })

    const ctx = makeCtx()
    const onExecutionEnded = vi.fn()

    streamBackendExecution("exec-sse-discard", ctx, vi.fn(), onExecutionEnded)

    // Drive the SSE discard directly — before the first poll (1000ms) so the
    // poll never runs against a terminal status and the SSE path is the sole
    // driver of the discard.
    lastSseCallbacks().onDiscarded?.()

    // Same outcome as the poll path: active nodes reverted to idle …
    expect(mockUpdateNodeData).toHaveBeenCalledWith("running-node", {
      executionStatus: "idle",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
    expect(mockUpdateNodeData).toHaveBeenCalledWith("done-node", {
      executionStatus: "idle",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })

    // … the discarded result is NEVER painted onto the canvas …
    const discardedUrl = "https://cdn.example.com/discarded.png"
    const paintedDone = mockUpdateNodeData.mock.calls.find((c: any[]) => {
      if (c[0] !== "done-node") return false
      const patch = (c[1] ?? {}) as Record<string, unknown>
      if (patch.generatedImageUrl !== undefined) return true
      if (JSON.stringify(patch).includes(discardedUrl)) return true
      if (Array.isArray(patch.generatedResults) && patch.generatedResults.length > 0) return true
      return false
    })
    expect(paintedDone).toBeUndefined()

    // … cleanup fires onExecutionEnded and exactly one discard toast shows …
    expect(onExecutionEnded).toHaveBeenCalledTimes(1)
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Run discarded — in-flight results will be saved to My Library",
    )

    // … and a LATER poll tick (now non-terminal) must not re-run cleanup.
    await vi.advanceTimersByTimeAsync(4000)
    expect(onExecutionEnded).toHaveBeenCalledTimes(1)
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
  })

  it("teardownActiveWorkflowStream stops the OLD stream so a late discard can't wipe the NEW run", async () => {
    // Start the OLD whole-workflow stream and capture its SSE callbacks.
    mockNodes = [
      { id: "old-node", type: "generate-image", data: { label: "old", executionStatus: "running", currentJobId: "job-old" } },
    ]
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })
    streamBackendExecution("exec-old", makeCtx(), vi.fn(), vi.fn())
    const oldCallbacks = lastSseCallbacks()

    // Discard / Run-instead: tear the old stream down BEFORE the new run starts.
    teardownActiveWorkflowStream()

    // The NEW run is now established: a fresh node is running/pending.
    mockNodes = [
      { id: "new-node", type: "generate-image", data: { label: "new", executionStatus: "running", currentJobId: "job-new" } },
    ]
    mockUpdateNodeData.mockClear()

    // The OLD execution reaches `discarded` server-side seconds later and its
    // (now torn-down) SSE fires onDiscarded. The `finished` guard set by teardown
    // must make this a no-op — the NEW run's running node must NOT be reverted.
    oldCallbacks.onDiscarded?.()

    const revertedNew = mockUpdateNodeData.mock.calls.find(
      (c: any[]) => c[0] === "new-node" && c[1]?.executionStatus === "idle",
    )
    expect(revertedNew).toBeUndefined()
    // The stale onDiscarded also must not toast against the new run.
    expect(mockToastInfo).not.toHaveBeenCalled()
  })

  it("teardownActiveWorkflowStream halts the old stream's poll loop (no further state writes)", async () => {
    mockNodes = [
      { id: "n1", type: "generate-image", data: { label: "img", executionStatus: "running", currentJobId: "job-1" } },
    ]
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })

    streamBackendExecution("exec-teardown", makeCtx(), vi.fn(), vi.fn())

    // Tear the stream down before any poll fires, then clear what teardown did.
    teardownActiveWorkflowStream()
    mockUpdateNodeData.mockClear()
    mockGetWorkflowExecution.mockClear()

    // Advance past several poll intervals — the `finished` guard set by teardown
    // means pollOnce() bails immediately and never fetches or applies state.
    await vi.advanceTimersByTimeAsync(10_000)

    expect(mockGetWorkflowExecution).not.toHaveBeenCalled()
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })
})
