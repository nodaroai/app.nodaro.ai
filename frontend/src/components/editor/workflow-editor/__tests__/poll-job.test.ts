import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetJobStatusLean = vi.fn()
const mockCancelJob = vi.fn().mockResolvedValue({ success: true, cancelled: 1 })
const mockToastInfo = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockNodes: Array<{ id: string; data: Record<string, unknown> }> = []
// Apply writes to mockNodes so node state (e.g. currentJobId, which the
// abandon-guard reads) reflects what the real store would hold mid-poll.
const mockUpdateNodeData = vi.fn((id: string, patch: Record<string, unknown>) => {
  const node = mockNodes.find((n) => n.id === id)
  if (node) node.data = { ...node.data, ...patch }
})

vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      updateNodeData: mockUpdateNodeData,
      nodes: mockNodes,
    }),
  },
}))

vi.mock("@/lib/api", () => ({
  getJobStatusLean: (...args: unknown[]) => mockGetJobStatusLean(...args),
  getExecutionEstimate: vi.fn().mockResolvedValue(null),
  cancelJob: (...args: unknown[]) => mockCancelJob(...args),
}))

vi.mock("../types", () => ({
  WorkflowStaleError: class WorkflowStaleError extends Error {
    constructor() { super("Workflow changed during execution") }
  },
  MAX_CONSECUTIVE_POLL_FAILURES: 3,
  checkStorageError: () => false,
  updateProgressIfChanged: (nodeId: string, progress: number, updateFn: (id: string, data: Record<string, unknown>) => void) => {
    updateFn(nodeId, { currentJobProgress: progress })
  },
  // Self-heal "Recovering" flag writer — no-op in these tests (transition
  // detection is covered by the real impl; tests here pin progress flow).
  updateRecoveringIfChanged: () => {},
}))

vi.mock("@nodaro/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared")>()
  return {
    ...actual,
    calculateProgress: (_elapsed: number, _estimate: number) => 0,
  }
})

import { pollJobToCompletion, pollJobWithNodeUpdate } from "../poll-job"
import type { ExecutionContext } from "../types"

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
    ...overrides,
  } as ExecutionContext
}

describe("pollJobToCompletion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves with imageUrl on completed job", async () => {
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { imageUrl: "https://cdn.example.com/img.png" },
    })

    const ctx = makeCtx()
    const promise = pollJobToCompletion("job-1", ctx)
    await vi.advanceTimersByTimeAsync(2000)
    const result = await promise

    expect(result).toBe("https://cdn.example.com/img.png")
    expect(mockGetJobStatusLean).toHaveBeenCalledWith("job-1")
  })

  it("resolves with empty string when no imageUrl", async () => {
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: {},
    })

    const ctx = makeCtx()
    const promise = pollJobToCompletion("job-1", ctx)
    await vi.advanceTimersByTimeAsync(2000)
    const result = await promise

    expect(result).toBe("")
  })

  it("rejects on failed job", async () => {
    mockGetJobStatusLean.mockResolvedValue({
      status: "failed",
      error_message: "Out of memory",
    })

    const ctx = makeCtx()
    const promise = pollJobToCompletion("job-1", ctx)
    promise.catch(() => {}) // prevent unhandled rejection warning
    await vi.advanceTimersByTimeAsync(2000)

    await expect(promise).rejects.toThrow("Out of memory")
  })

  it("rejects with WorkflowStaleError when workflow is stale", async () => {
    const ctx = makeCtx({ isWorkflowStale: () => true })
    const promise = pollJobToCompletion("job-1", ctx)
    promise.catch(() => {}) // prevent unhandled rejection warning
    await vi.advanceTimersByTimeAsync(2000)

    await expect(promise).rejects.toThrow("Workflow changed during execution")
  })

  it("rejects after MAX_CONSECUTIVE_POLL_FAILURES consecutive errors", async () => {
    mockGetJobStatusLean.mockRejectedValue(new Error("Network error"))

    const ctx = makeCtx()
    const promise = pollJobToCompletion("job-1", ctx)
    promise.catch(() => {}) // prevent unhandled rejection warning

    // 3 failures (MAX_CONSECUTIVE_POLL_FAILURES mocked to 3)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)

    await expect(promise).rejects.toThrow("Network error")
  })

  it("resets failure count on successful poll", async () => {
    let callCount = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      callCount++
      if (callCount <= 2) throw new Error("Network error")
      return { status: "completed", output_data: { imageUrl: "ok" } }
    })

    const ctx = makeCtx()
    const promise = pollJobToCompletion("job-1", ctx)

    await vi.advanceTimersByTimeAsync(2000) // fail 1
    await vi.advanceTimersByTimeAsync(2000) // fail 2
    await vi.advanceTimersByTimeAsync(2000) // success

    const result = await promise
    expect(result).toBe("ok")
  })
})

describe("pollJobWithNodeUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("sets running status on start", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "https://cdn.example.com/vid.mp4" },
    })
    mockNodes.push({ id: "n1", data: { generatedResults: [] } })

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    await vi.advanceTimersByTimeAsync(100) // let apiCall resolve
    await vi.advanceTimersByTimeAsync(2000) // first poll
    await promise

    // First call sets running status
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      executionStatus: "running",
    }))
  })

  it("resolves and sets completed status on success", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "https://cdn.example.com/vid.mp4" },
    })
    mockNodes.push({ id: "n1", data: { generatedResults: [] } })

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      executionStatus: "completed",
      generatedVideoUrl: "https://cdn.example.com/vid.mp4",
    }))
    expect(mockToastSuccess).toHaveBeenCalledWith("Video complete")
  })

  it("rejects and sets failed status on job failure", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "failed",
      error_message: "Render error",
    })
    mockNodes.push({ id: "n1", data: {} })

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    promise.catch(() => {}) // prevent unhandled rejection warning
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)

    await expect(promise).rejects.toThrow("Render error")
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      executionStatus: "failed",
      errorMessage: "Render error",
    }))
  })

  it("rejects when apiCall fails", async () => {
    const apiCall = vi.fn().mockRejectedValue(new Error("API down"))

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    promise.catch(() => {}) // prevent unhandled rejection warning
    await vi.advanceTimersByTimeAsync(100)

    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      executionStatus: "failed",
    }))
  })

  it("rejects when no output URL returned", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: {},
    })
    mockNodes.push({ id: "n1", data: {} })

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    promise.catch(() => {}) // prevent unhandled rejection warning
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)

    await expect(promise).rejects.toThrow("No output URL returned from job")
  })

  it("updates progress on processing status", async () => {
    let callCount = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      callCount++
      if (callCount === 1) return { status: "processing", progress: 50 }
      return { status: "completed", output_data: { videoUrl: "url" } }
    })
    mockNodes.push({ id: "n1", data: { generatedResults: [] } })

    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000) // progress update
    await vi.advanceTimersByTimeAsync(2000) // completion
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", { currentJobProgress: 50 })
  })

  it("calls extraOutputFields when provided", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { audioUrl: "url", duration: 5.2 },
    })
    mockNodes.push({ id: "n1", data: { generatedResults: [] } })

    const extraFn = vi.fn().mockReturnValue({ audioDuration: 5.2 })
    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedAudioUrl", "Audio", ctx, extraFn)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(extraFn).toHaveBeenCalledWith({ audioUrl: "url", duration: 5.2 })
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      audioDuration: 5.2,
    }))
  })

  // --- abandon-guard interaction at the live poll loop ---

  it("abandons the completion write when currentJobId points at a different job", async () => {
    // Negative-path / discard-detach proof: the node's currentJobId was
    // replaced (re-run) or cleared (discard) while job j1 was in flight. The
    // completion must NOT be written to the canvas and the promise resolves "".
    // pollJobWithNodeUpdate's start write sets currentJobId: undefined, then the
    // apiCall .then sets currentJobId = "j1". We overwrite it to a DIFFERENT job
    // right before the first poll fires, simulating a concurrent re-run/discard.
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "https://cdn.example.com/vid.mp4" },
    })
    mockNodes.push({ id: "n1", data: { generatedResults: [] } })

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    await vi.advanceTimersByTimeAsync(100) // apiCall resolves → currentJobId = "j1"
    // Simulate a concurrent discard/re-run: node now points at a different job.
    mockNodes[0].data.currentJobId = "job-OTHER"
    mockUpdateNodeData.mockClear()
    await vi.advanceTimersByTimeAsync(2000) // first poll → completed → abandoned

    const result = await promise
    expect(result).toBe("")
    // No terminal write landed for the polled job.
    const wroteCompleted = mockUpdateNodeData.mock.calls.some(
      ([, patch]) => (patch as Record<string, unknown>).executionStatus === "completed",
    )
    const wroteResults = mockUpdateNodeData.mock.calls.some(
      ([, patch]) => "generatedResults" in (patch as Record<string, unknown>),
    )
    expect(wroteCompleted).toBe(false)
    expect(wroteResults).toBe(false)
    expect(mockUpdateNodeData).not.toHaveBeenCalledWith("n1", expect.objectContaining({
      generatedVideoUrl: "https://cdn.example.com/vid.mp4",
    }))
  })

  it("does NOT abandon mid-list-fan-out even when currentJobId points at a different job", async () => {
    // Parallel-fan-out regression (Task 6 HIGH): during a list fan-out, N
    // iterations share one currentJobId slot. Iteration A's job (j1) completes
    // while currentJobId already holds iteration B's job (job-OTHER). Pre-fix,
    // the guard returned true → A's result was dropped (resolve("")), silently
    // losing most batch results. With __listRunning set, the result MUST land.
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "https://cdn.example.com/vidA.mp4" },
    })
    // __listRunning marks the fan-out window (set by executeNodeForList).
    mockNodes.push({ id: "n1", data: { generatedResults: [], __listRunning: true } })

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    await vi.advanceTimersByTimeAsync(100) // apiCall resolves → currentJobId = "j1"
    // A concurrent iteration overwrote the shared slot with its own job id.
    mockNodes[0].data.currentJobId = "job-OTHER"
    await vi.advanceTimersByTimeAsync(2000) // poll → completed → must be written

    const result = await promise
    expect(result).toBe("https://cdn.example.com/vidA.mp4")
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      executionStatus: "completed",
      generatedVideoUrl: "https://cdn.example.com/vidA.mp4",
    }))
  })

  // --- pre-currentJobId discard race (the production bug) ---

  it("bails without re-attaching currentJobId when the run was aborted before create-job resolved", async () => {
    // Discard-during-create-job race proof. The user presses Discard while the
    // create-job request is still in flight: ctx.signal aborts, then apiCall
    // resolves with the new job id. Pre-fix, the .then() unconditionally ran
    // `updateNodeData(nodeId, { currentJobId: jobId })`, re-establishing the
    // node→job link the discard had just cleared, then the poll completed and
    // shouldAbandonNode matched → the discarded result painted over the
    // existing one. The fix bails right after apiCall resolves if the signal is
    // already aborted: no currentJobId re-attach, no poll, resolve("").
    const controller = new AbortController()
    // apiCall aborts (mirrors Discard pressed mid-flight), THEN resolves with
    // the new job id — exactly the window where currentJobId is still undefined.
    const apiCall = vi.fn().mockImplementation(() => {
      controller.abort()
      return Promise.resolve({ jobId: "new-job" })
    })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "https://cdn.example.com/NEW.mp4" },
    })
    // Prior run already produced R1; activeResultIndex points at it.
    mockNodes.push({
      id: "n1",
      data: {
        generatedResults: [{ url: "R1", timestamp: "t0", jobId: "old-job" }],
        activeResultIndex: 0,
      },
    })

    const ctx = makeCtx({ signal: controller.signal })
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    await vi.advanceTimersByTimeAsync(100) // apiCall resolves (already aborted)
    await vi.advanceTimersByTimeAsync(2000) // would-be first poll (must NOT run)

    const result = await promise

    // Discard is not a failure — the loop unwinds by resolving "".
    expect(result).toBe("")
    // The re-attach that defeats the discard must NOT have happened.
    expect(mockUpdateNodeData).not.toHaveBeenCalledWith("n1", { currentJobId: "new-job" })
    expect(mockUpdateNodeData).not.toHaveBeenCalledWith("n1", expect.objectContaining({
      currentJobId: "new-job",
    }))
    // No poll began for the discarded job.
    expect(mockGetJobStatusLean).not.toHaveBeenCalled()
    // The existing result is preserved and the new one never painted.
    expect(mockNodes[0].data.generatedResults).toEqual([
      { url: "R1", timestamp: "t0", jobId: "old-job" },
    ])
    expect(mockUpdateNodeData).not.toHaveBeenCalledWith("n1", expect.objectContaining({
      generatedVideoUrl: "https://cdn.example.com/NEW.mp4",
    }))
    // Phase-aware cancel fired for the in-flight job (pre-call cancels+refunds;
    // in-flight finishes → My Library). Idempotent + only called here for this id.
    expect(mockCancelJob).toHaveBeenCalledWith("new-job")
  })

  it("normal (non-aborted) path still sets currentJobId and writes the result", async () => {
    // Guard the fix: an un-aborted run must behave exactly as before — the
    // create-job .then() sets currentJobId, the poll runs, and the result is
    // written. (signal present but never aborted.)
    const controller = new AbortController()
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "https://cdn.example.com/vid.mp4" },
    })
    mockNodes.push({ id: "n1", data: { generatedResults: [] } })

    const ctx = makeCtx({ signal: controller.signal })
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    const result = await promise

    expect(result).toBe("https://cdn.example.com/vid.mp4")
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", { currentJobId: "j1" })
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      executionStatus: "completed",
      generatedVideoUrl: "https://cdn.example.com/vid.mp4",
    }))
    expect(mockCancelJob).not.toHaveBeenCalled()
  })
})
