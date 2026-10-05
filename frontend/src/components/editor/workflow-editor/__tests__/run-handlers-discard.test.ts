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
    new Set(["generate-image", "image-to-video", "generate-video"]).has(n.type ?? ""),
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

import { attachToRunningExecution, detachActiveWorkflowStream, handleRun, handleRunFromHere, handleRunSelected, hasActiveWorkflowStream, isStreaming, streamBackendExecution, teardownActiveWorkflowStream } from "../run-handlers"
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

// trackInterval must return a real timer id (not the interval object) so the
// stale-check / poll intervals advance under fake timers.
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
        "done-node": { status: "completed", startedAt: "2026-10-03T10:00:00Z", output: { imageUrl: "https://cdn.example.com/discarded.png" } },
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
        "done-node": { status: "completed", startedAt: "2026-10-03T10:00:00Z", output: { imageUrl: "https://cdn.example.com/discarded.png" } },
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

// ---------------------------------------------------------------------------
// Partial-failure settle
//
// When the orchestrator aborts on a bad node it never reaches the rest of the
// graph, so every unreached node keeps the optimistic "pending" flip handleRun
// applied and shows the animated running border forever — long after the run
// is over. Only the discard path used to reset them. Meanwhile the nodes that
// DID finish must keep their results: they were generated and billed.
// ---------------------------------------------------------------------------

describe("streamBackendExecution — failed run settles orphaned nodes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes = []
    mockEdges = []
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  /** One node that succeeded, one that failed, one the run never reached. */
  function partialFailureNodes() {
    return [
      { id: "done", type: "generate-image", data: { label: "a", executionStatus: "running", currentJobId: "job-1" } },
      { id: "bad", type: "generate-image", data: { label: "b", executionStatus: "running", currentJobId: "job-2" } },
      { id: "never-reached", type: "generate-image", data: { label: "c", executionStatus: "pending" } },
    ]
  }

  const failedStates = {
    done: { status: "completed", startedAt: "2026-10-03T10:00:00Z", output: { imageUrl: "https://cdn.example.com/done.png" } },
    bad: { status: "failed", error: "Invalid aspect ratio setting." },
  }

  it("SSE onFailed: keeps the completed result, resets the never-reached node to idle", async () => {
    mockNodes = partialFailureNodes()
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })

    streamBackendExecution("exec-fail-sse", makeCtx(), vi.fn(), vi.fn())

    // Mirror api.ts: the final nodeStates are delivered BEFORE onFailed.
    const cb = lastSseCallbacks()
    cb.onNodeStatesChanged?.(failedStates as Record<string, unknown>)
    cb.onFailed?.({ errorMessage: "Node execution failed: bad" })

    const byId = Object.fromEntries(mockNodes.map((n) => [n.id, n.data]))
    // The paid-for result survives — this is the whole point.
    expect(byId.done.generatedImageUrl).toBe("https://cdn.example.com/done.png")
    expect(byId.done.executionStatus).toBe("completed")
    // The node that really failed keeps its failure (not reset to idle).
    expect(byId.bad.executionStatus).toBe("failed")
    // The orphan stops pretending to run.
    expect(mockUpdateNodeData).toHaveBeenCalledWith("never-reached", {
      executionStatus: "idle",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
  })

  it("poll path reaches the same end state as SSE (whichever wins the race)", async () => {
    mockNodes = partialFailureNodes()
    mockGetWorkflowExecution.mockResolvedValue({
      status: "failed",
      errorMessage: "Node execution failed: bad",
      nodeStates: failedStates,
    })

    streamBackendExecution("exec-fail-poll", makeCtx(), vi.fn(), vi.fn())
    await vi.advanceTimersByTimeAsync(1000)

    const byId = Object.fromEntries(mockNodes.map((n) => [n.id, n.data]))
    expect(byId.done.generatedImageUrl).toBe("https://cdn.example.com/done.png")
    expect(byId.bad.executionStatus).toBe("failed")
    expect(mockUpdateNodeData).toHaveBeenCalledWith("never-reached", {
      executionStatus: "idle",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
  })

  it("a COMPLETED run is left alone (no blanket revert)", async () => {
    mockNodes = [
      { id: "done", type: "generate-image", data: { label: "a", executionStatus: "running", currentJobId: "job-1" } },
    ]
    mockGetWorkflowExecution.mockResolvedValue({
      status: "completed",
      nodeStates: { done: { status: "completed", startedAt: "2026-10-03T10:00:00Z", output: { imageUrl: "https://cdn.example.com/done.png" } } },
    })

    streamBackendExecution("exec-ok", makeCtx(), vi.fn(), vi.fn())
    await vi.advanceTimersByTimeAsync(1000)

    const revertedToIdle = mockUpdateNodeData.mock.calls.find(
      (c: any[]) => c[1]?.executionStatus === "idle",
    )
    expect(revertedToIdle).toBeUndefined()
    expect(mockToastSuccess).toHaveBeenCalledWith("Backend execution completed")
  })

  it("paints a Choose Best (reduce) winner + reasoning from the orchestrator's `result` / `reduceMeta`", async () => {
    // Regression: an Execute / Run-from-here run of Choose Best completed on
    // the backend ("Backend execution completed") while the node kept saying
    // "Run to see the result" — syncNodeStatesToStore never copied
    // `output.result` into node data; only the single-node Run (execute-node)
    // wrote `result`. Cloud and community alike (2026-08-16).
    mockNodes = [
      { id: "best", type: "reduce", data: { label: "Choose Best", executionStatus: "running", strategyId: "pick-best-llm" } },
    ]
    const meta = { selectedIndex: 1, reasoning: "sharper and better lit", summary: "Chose #2 of 2" }
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })

    streamBackendExecution("exec-reduce", makeCtx(), vi.fn(), vi.fn())
    const cb = lastSseCallbacks()
    cb.onNodeStatesChanged?.({
      best: { status: "completed", startedAt: "2026-10-03T10:00:00Z", jobId: "job-9", output: { result: "https://cdn.example.com/b.png", reduceMeta: meta } },
    } as Record<string, unknown>)

    const best = mockNodes.find((n) => n.id === "best")!.data as Record<string, unknown>
    expect(best.executionStatus).toBe("completed")
    expect(best.result).toBe("https://cdn.example.com/b.png")
    expect(best.lastMeta).toEqual(meta)
  })
})

// ---------------------------------------------------------------------------
// Restore-path 404 tolerance (page reload reconnect, Gap 2)
// ---------------------------------------------------------------------------

describe("streamBackendExecution — restore-path 404 race tolerance", () => {
  const notFound = { status: 404 }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes = []
    mockEdges = []
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {})) // silent SSE → poll drives
  })

  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("restore: tolerates a transient 404 race then recovers, with NO scary toast", async () => {
    let n = 0
    mockGetWorkflowExecution.mockImplementation(async () => {
      n++
      if (n <= 2) throw notFound // list→connect read-after-write race
      return { status: "running", nodeStates: {} } // replica catches up
    })

    streamBackendExecution("exec-restore-race", makeCtx(), vi.fn(), undefined, { isRestore: true })

    await vi.advanceTimersByTimeAsync(1000) // poll 1 → 404
    await vi.advanceTimersByTimeAsync(3000) // poll 2 → 404
    await vi.advanceTimersByTimeAsync(3000) // poll 3 → recovers

    expect(n).toBeGreaterThanOrEqual(3)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("restore: a persistently-gone execution gives up QUIETLY (no 'no longer exists' toast)", async () => {
    mockGetWorkflowExecution.mockRejectedValue(notFound)

    streamBackendExecution("exec-restore-gone", makeCtx(), vi.fn(), undefined, { isRestore: true })

    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(3000)

    expect(mockToastError).not.toHaveBeenCalledWith("Backend execution no longer exists")
  })

  it("fresh run (no isRestore): still gives up + toasts after 2 consecutive 404s", async () => {
    mockGetWorkflowExecution.mockRejectedValue(notFound)

    streamBackendExecution("exec-fresh-gone", makeCtx(), vi.fn())

    await vi.advanceTimersByTimeAsync(1000) // poll 1 → 404
    await vi.advanceTimersByTimeAsync(3000) // poll 2 → 404 → give up

    expect(mockToastError).toHaveBeenCalledWith("Backend execution no longer exists")
  })
})

// ---------------------------------------------------------------------------
// A followed trigger-started run (follow-triggered-run.ts): only the states its
// `paintable` lets through reach the canvas, and `settle` runs before the end.
// ---------------------------------------------------------------------------

describe("streamBackendExecution — a followed Telegram run", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockEdges = []
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("paints only the states the follow lets through, and settles it before the run's end", async () => {
    mockNodes = [
      { id: "trig", type: "telegram-account-trigger", data: { label: "t" } },
      { id: "llm", type: "llm-chat", data: { label: "l", executionStatus: "pending" } },
    ]
    const order: string[] = []
    const paintable = vi.fn((states: Record<string, unknown>) => ({ llm: states.llm }) as never)
    const settle = vi.fn(() => void order.push("settle"))
    mockGetWorkflowExecution.mockResolvedValue({ status: "completed", nodeStates: {} })

    streamBackendExecution("exec-tg", makeCtx(), vi.fn(), () => void order.push("ended"), {
      isRestore: true,
      beginTriggered: () => ({ paintable, settle }),
    })
    const cb = lastSseCallbacks()
    cb.onNodeStatesChanged?.({
      trig: { status: "completed", startedAt: "2026-10-03T10:00:00Z", output: { text: "the message" } },
      llm: { status: "completed", startedAt: "2026-10-03T10:00:01Z", output: { text: "the answer" } },
    } as Record<string, unknown>)

    expect(paintable).toHaveBeenCalled()
    expect((mockNodes.find((n) => n.id === "llm")!.data as Record<string, unknown>).generatedText).toBe("the answer")
    expect((mockNodes.find((n) => n.id === "trig")!.data as Record<string, unknown>).generatedText).toBeUndefined()

    cb.onCompleted?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(["settle", "ended"])
  })
})

describe("streamBackendExecution — one stream per run (review round 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes = []
    mockEdges = []
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("asked again for the run it already streams, keeps the first stream", () => {
    const editor = vi.fn()
    streamBackendExecution("exec-same", makeCtx(), editor, vi.fn())
    streamBackendExecution("exec-same", makeCtx(), editor, vi.fn())
    expect(mockStreamWorkflowExecution).toHaveBeenCalledTimes(1)
    expect(isStreaming("exec-same")).toBe(true)
  })

  it("a different run takes the slot only after the old stream ended, naming its own run", () => {
    const editor = vi.fn()
    const oldEnded = vi.fn()
    streamBackendExecution("exec-old-run", makeCtx(), editor, oldEnded)
    streamBackendExecution("exec-new-run", makeCtx(), editor, vi.fn())
    expect(oldEnded).toHaveBeenCalledWith("exec-old-run")
    expect(isStreaming("exec-new-run")).toBe(true)
    expect(isStreaming("exec-old-run")).toBe(false)
  })

  it("a bare end of a run that FAILED says it failed and settles its nodes", async () => {
    mockNodes = [{ id: "never", type: "generate-image", data: { label: "n", executionStatus: "pending" } }]
    mockGetWorkflowExecution.mockResolvedValue({ status: "failed", errorMessage: "boom", nodeStates: {} })
    streamBackendExecution("exec-bare-end", makeCtx(), vi.fn(), vi.fn(), { isRestore: true })
    lastSseCallbacks().onCompleted?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(mockToastError).toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockUpdateNodeData).toHaveBeenCalledWith("never", expect.objectContaining({ executionStatus: "idle" }))
  })
})

describe("attachToRunningExecution — a Run answered 'already running' (review round 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockEdges = []
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("the run already followed: keeps that stream and takes back the click's marks", async () => {
    mockNodes = []
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", triggerType: "telegram_account", nodeStates: {} })
    const editor = vi.fn()
    streamBackendExecution("exec-tg-live", makeCtx(), editor, vi.fn())
    const undo = vi.fn()
    await attachToRunningExecution("exec-tg-live", makeCtx(), editor, vi.fn(), undo)
    expect(undo).toHaveBeenCalled()
    expect(mockStreamWorkflowExecution).toHaveBeenCalledTimes(1)
  })

  it("a Telegram run: followed through its paint rules — the trigger card never takes the message", async () => {
    mockNodes = [
      { id: "trig", type: "telegram-account-trigger", data: { label: "t" } },
      { id: "llm", type: "llm-chat", data: { label: "l" } },
    ]
    const states = {
      trig: { status: "completed", startedAt: "2026-10-03T10:00:00Z", output: { text: "the message" } },
      llm: { status: "running", startedAt: "2026-10-03T10:00:01Z" },
    }
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", triggerType: "telegram_account", nodeStates: states })
    const undo = vi.fn()
    await attachToRunningExecution("exec-tg", makeCtx(), vi.fn(), vi.fn(), undo)
    expect(undo).toHaveBeenCalled()
    lastSseCallbacks().onNodeStatesChanged?.({ ...states, llm: { status: "completed", startedAt: "2026-10-03T10:00:01Z", output: { text: "the answer" } } } as Record<string, unknown>)
    expect((mockNodes.find((n) => n.id === "trig")!.data as Record<string, unknown>).generatedText).toBeUndefined()
    expect((mockNodes.find((n) => n.id === "llm")!.data as Record<string, unknown>).generatedText).toBe("the answer")
  })

  it("any other run: streamed as before, the click's marks kept", async () => {
    mockNodes = []
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", triggerType: "manual", nodeStates: {} })
    const undo = vi.fn()
    await attachToRunningExecution("exec-manual", makeCtx(), vi.fn(), vi.fn(), undo)
    expect(undo).not.toHaveBeenCalled()
    expect(isStreaming("exec-manual")).toBe(true)
  })
})

describe("streamBackendExecution — a remounted editor (review round 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes = []
    mockEdges = []
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("restoring the same run from a NEW editor opens its own stream; the gone editor's stream is let go silently", () => {
    const goneEnded = vi.fn()
    streamBackendExecution("exec-long", makeCtx(), vi.fn(), goneEnded)
    streamBackendExecution("exec-long", makeCtx(), vi.fn(), vi.fn(), { isRestore: true })
    expect(mockStreamWorkflowExecution).toHaveBeenCalledTimes(2)
    expect(goneEnded).not.toHaveBeenCalled()
  })

  it("a stream let go with its page frees the slot, so the next editor follows the run again", () => {
    streamBackendExecution("exec-left", makeCtx(), vi.fn(), vi.fn())
    detachActiveWorkflowStream()
    expect(isStreaming("exec-left")).toBe(false)
    expect(hasActiveWorkflowStream()).toBe(false)
  })
})

describe("syncNodeStatesToStore — a trigger's message is never saved as a result (review round 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockEdges = []
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("a plain stream paints the answer but not the trigger card's message", () => {
    mockNodes = [
      { id: "trig", type: "telegram-account-trigger", data: { label: "t", executionStatus: "pending" } },
      { id: "llm", type: "llm-chat", data: { label: "l", executionStatus: "pending" } },
    ]
    streamBackendExecution("exec-plain", makeCtx(), vi.fn(), vi.fn())
    lastSseCallbacks().onNodeStatesChanged?.({
      trig: { status: "completed", startedAt: "2026-10-03T10:00:00Z", output: { text: "the message" } },
      llm: { status: "completed", startedAt: "2026-10-03T10:00:01Z", output: { text: "the answer" } },
    } as Record<string, unknown>)
    const trig = mockNodes.find((n) => n.id === "trig")!.data as Record<string, unknown>
    expect(trig.generatedText).toBeUndefined()
    expect(trig.generatedResults).toBeUndefined()
    expect((mockNodes.find((n) => n.id === "llm")!.data as Record<string, unknown>).generatedText).toBe("the answer")
  })
})

describe("Run while a run is followed (review round 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes = [{ id: "list", type: "list", data: { label: "l", __listResults: ["a", "b"] } }]
    mockEdges = []
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
    streamBackendExecution("exec-followed", makeCtx(), vi.fn(), vi.fn())
    mockUpdateNodeData.mockClear()
    mockToastInfo.mockClear()
  })

  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it.each([
    ["Run", () => handleRun(makeCtx(), "p1", "wf-1", vi.fn(), vi.fn())],
    ["Run from here", () => handleRunFromHere("list", makeCtx(), "p1", vi.fn(), vi.fn())],
    ["Run selected", () => handleRunSelected(makeCtx(), "p1", vi.fn(), vi.fn())],
  ])("%s starts nothing, resets nothing and says so", async (_label, run) => {
    await run()
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
    expect((mockNodes[0]!.data as Record<string, unknown>).__listResults).toEqual(["a", "b"])
    expect(mockStreamWorkflowExecution).toHaveBeenCalledTimes(1)
  })
})

describe("review round 3", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockEdges = []
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("a trigger node takes no result at all — not a photo someone sent either, only its status", () => {
    mockNodes = [{ id: "bot", type: "telegram-trigger", data: { label: "b", executionStatus: "pending" } }]
    streamBackendExecution("exec-photo", makeCtx(), vi.fn(), vi.fn())
    lastSseCallbacks().onNodeStatesChanged?.({
      bot: { status: "completed", startedAt: "2026-10-03T10:00:00Z", output: { text: "look", imageUrl: "https://r2.example.com/tg/p.jpg" } },
    } as Record<string, unknown>)
    const bot = mockNodes[0]!.data as Record<string, unknown>
    expect(bot.executionStatus).toBe("completed")
    expect(bot.generatedImageUrl).toBeUndefined()
    expect(bot.generatedResults).toBeUndefined()
    expect(bot.generatedText).toBeUndefined()
  })

  it("a stream let go paints nothing more, not even a poll already on its way", () => {
    mockNodes = [{ id: "llm", type: "llm-chat", data: { label: "l", executionStatus: "pending" } }]
    streamBackendExecution("exec-left-behind", makeCtx(), vi.fn(), vi.fn())
    const cb = lastSseCallbacks()
    detachActiveWorkflowStream()
    cb.onNodeStatesChanged?.({ llm: { status: "completed", startedAt: "2026-10-03T10:00:01Z", output: { text: "late" } } } as Record<string, unknown>)
    expect((mockNodes[0]!.data as Record<string, unknown>).generatedText).toBeUndefined()
  })
})
