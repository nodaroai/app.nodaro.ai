import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetJobStatusLean = vi.fn()
const mockCancelJob = vi.fn().mockResolvedValue({ success: true, cancelled: 1 })
const mockToastInfo = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastWarning = vi.fn()
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
    warning: (...args: unknown[]) => mockToastWarning(...args),
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
  // The hold-flag twin. Written through, so the "awaiting review" cases below
  // can assert on the patch the wrapper produces.
  updateAwaitingReviewIfChanged: (nodeId: string, awaiting: boolean, updateFn: (id: string, data: Record<string, unknown>) => void) => {
    updateFn(nodeId, { jobAwaitingReview: awaiting })
  },
}))

vi.mock("@nodaro/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared")>()
  return {
    ...actual,
    calculateProgress: (_elapsed: number, _estimate: number) => 0,
  }
})

import { pollJobToCompletion, pollJobWithNodeUpdate, pollImageRefineToNode } from "../poll-job"
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

// ---------------------------------------------------------------------------
// Media-typed completion: an ORDERED LIST of output keys.
// ---------------------------------------------------------------------------
//
// voice-changer-pro with a video input wired can legitimately deliver AUDIO —
// the backend decides the mode from the media's actual streams (an audio-only
// .mp4 has no video to remux onto). With a single static key the poller saw
// `output_data.videoUrl === undefined` and failed the node with "No output URL
// returned" even though the job completed. A key list says "take the first
// key the job actually produced".

describe("pollJobWithNodeUpdate — media-typed completion (outputKey list)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function run(outputData: Record<string, unknown>) {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({ status: "completed", output_data: outputData })
    mockNodes.push({ id: "n1", data: { generatedResults: [], generatedVideoUrl: "https://cdn.example.com/stale.mp4" } })
    const promise = pollJobWithNodeUpdate(
      "n1", apiCall, ["generatedVideoUrl", "generatedAudioUrl"], "Voice Changer Pro", makeCtx(),
    )
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    return promise
  }

  it("resets EVERY listed key on start (no stale video result survives into an audio run)", async () => {
    await run({ audioUrl: "https://cdn.example.com/out.mp3" })
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      executionStatus: "running",
      generatedVideoUrl: undefined,
      generatedAudioUrl: undefined,
    }))
  })

  it("writes the FIRST key the job actually produced — a video-wired run that delivered audio lands on generatedAudioUrl", async () => {
    const url = await run({ audioUrl: "https://cdn.example.com/out.mp3" })
    expect(url).toBe("https://cdn.example.com/out.mp3")
    const completed = mockUpdateNodeData.mock.calls
      .map((c) => c[1])
      .find((p) => p.executionStatus === "completed")
    expect(completed).toBeDefined()
    expect(completed!.generatedAudioUrl).toBe("https://cdn.example.com/out.mp3")
    expect("generatedVideoUrl" in completed!).toBe(false)
    expect(mockToastSuccess).toHaveBeenCalledWith("Voice Changer Pro complete")
  })

  it("prefers the earlier key when the job produced both", async () => {
    const url = await run({ videoUrl: "https://cdn.example.com/out.mp4", audioUrl: "https://cdn.example.com/out.mp3" })
    expect(url).toBe("https://cdn.example.com/out.mp4")
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      executionStatus: "completed",
      generatedVideoUrl: "https://cdn.example.com/out.mp4",
    }))
  })

  it("still rejects when the job produced none of the listed keys", async () => {
    await expect(run({ imageUrl: "https://cdn.example.com/out.png" })).rejects.toThrow("No output URL returned from job")
  })
})

describe("pollJobWithNodeUpdate — the job-policy hold and block", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes.length = 0
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("a job parked in pending_review sets jobAwaitingReview and KEEPS polling", async () => {
    // `pending_review` is in-flight, not terminal: the loop must not resolve,
    // reject, or stop — the job completes normally when the review approves it.
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({ status: "pending_review" })
    mockNodes.push({ id: "n1", data: {} })

    const ctx = makeCtx()
    let settled = false
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    promise.then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)

    expect(settled).toBe(false)
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", { jobAwaitingReview: true })
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("approve (pending_review -> completed, no tick in between) clears the flag on the completion patch", async () => {
    // The staleness scar: an approve skips `processing` entirely, so nothing
    // re-enters a branch that would clear the flag. The terminal patch must.
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    let calls = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      calls++
      return calls === 1
        ? { status: "pending_review" }
        : { status: "completed", output_data: { videoUrl: "https://cdn.example.com/vid.mp4" } }
    })
    mockNodes.push({ id: "n1", data: { generatedResults: [] } })

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    const completed = mockUpdateNodeData.mock.calls
      .map((c) => c[1])
      .find((patch) => patch.executionStatus === "completed")
    expect(completed).toBeDefined()
    expect("jobAwaitingReview" in completed!).toBe(true)
    expect(completed!.jobAwaitingReview).toBeUndefined()
  })

  it("reject (pending_review -> failed) clears the flag and carries the policy hint", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "failed",
      error_message: "Blocked by content policy",
      error_hint: { kind: "policy-block", policyId: "sai", reason: "Blocked by content policy", hookPoint: "result" },
    })
    mockNodes.push({ id: "n1", data: {} })

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(promise).rejects.toThrow("Blocked by content policy")

    const failed = mockUpdateNodeData.mock.calls
      .map((c) => c[1])
      .find((patch) => patch.executionStatus === "failed")
    expect(failed).toBeDefined()
    expect(failed!.errorHint).toEqual({ kind: "policy-block", policyId: "sai", reason: "Blocked by content policy", hookPoint: "result" })
    expect("jobAwaitingReview" in failed!).toBe(true)
    expect(failed!.jobAwaitingReview).toBeUndefined()
  })

  it("the REQUEST gate's 422 synthesizes the same policy-block hint (no job row exists)", async () => {
    // A request-gate block never creates a job, so there is no row and no
    // `jobs.error_hint`. Without this the user got a red "Failed to start"
    // toast and an empty card with nothing to read.
    const apiCall = vi.fn().mockRejectedValue(
      Object.assign(new Error("Requests for public figures are not allowed."), { code: "job_blocked" }),
    )
    mockNodes.push({ id: "n1", data: {} })

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).rejects.toThrow("Requests for public figures are not allowed.")

    const failed = mockUpdateNodeData.mock.calls
      .map((c) => c[1])
      .find((patch) => patch.executionStatus === "failed")
    expect(failed).toBeDefined()
    expect(failed!.errorHint).toEqual({
      kind: "policy-block",
      policyId: "",
      reason: "Requests for public figures are not allowed.",
      hookPoint: "request",
    })
    // A block is a WARNING, not a crash — and never the generic red error.
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockToastWarning).toHaveBeenCalledWith("Video was blocked by content policy")
  })

  it("a non-policy start failure is untouched by the block branch", async () => {
    const apiCall = vi.fn().mockRejectedValue(new Error("boom"))
    mockNodes.push({ id: "n1", data: {} })

    const ctx = makeCtx()
    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedVideoUrl", "Video", ctx)
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).rejects.toThrow("boom")

    const failed = mockUpdateNodeData.mock.calls
      .map((c) => c[1])
      .find((patch) => patch.executionStatus === "failed")
    expect(failed!.errorHint).toBeUndefined()
    expect(mockToastError).toHaveBeenCalled()
  })
})

// ===========================================================================
// Run-start reset: a previous run's failure must not be painted over this one
//
// `updateNodeData` is a SHALLOW merge, so any key the run-start patch omits
// survives from the last run. With the policy overlay in play that is not
// cosmetic: a stale `errorHint.kind === "policy-block"` makes
// <NodePolicyOverlay> paint an opaque "Blocked by content policy: <run 1's
// reason>" panel over run 2's real, unrelated failure — and the node cards
// suppress their own failed block in favour of an empty amber spacer, so the
// actual error is nowhere on screen.
// ===========================================================================

describe("pollJobWithNodeUpdate — stale failure state across runs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes.length = 0
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const STALE = {
    executionStatus: "failed",
    errorMessage: "Run 1 was blocked: public figure",
    errorHint: { kind: "policy-block", policyId: "p1", reason: "Run 1 was blocked: public figure", hookPoint: "request" },
  }

  it("a stale policy-block hint does not survive into the next run's START-FAILURE", async () => {
    const apiCall = vi.fn().mockRejectedValue(new Error("Insufficient credits"))
    mockNodes.push({ id: "n1", data: { ...STALE } })

    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedImageUrl", "Image", makeCtx())
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).rejects.toThrow("Insufficient credits")

    // Assert on the NODE, not the patch: the bug is what the shallow merge
    // LEAVES BEHIND, which a patch-shaped assertion cannot see.
    const data = mockNodes.find((n) => n.id === "n1")!.data
    expect(data.errorHint).toBeUndefined()
    expect(data.errorMessage).not.toBe("Run 1 was blocked: public figure")
  })

  it("a stale policy-block hint does not survive into the next run's GIVE-UP failure", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockRejectedValue(new Error("network"))
    mockNodes.push({ id: "n1", data: { ...STALE } })

    const promise = pollJobWithNodeUpdate("n1", apiCall, "generatedImageUrl", "Image", makeCtx())
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(promise).rejects.toThrow("network")

    const data = mockNodes.find((n) => n.id === "n1")!.data
    expect(data.errorHint).toBeUndefined()
    expect(data.errorMessage).not.toBe("Run 1 was blocked: public figure")
  })

  it("the run-start patch itself clears both error fields", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({ status: "processing", progress: 10 })
    mockNodes.push({ id: "n1", data: { ...STALE } })

    void pollJobWithNodeUpdate("n1", apiCall, "generatedImageUrl", "Image", makeCtx())
    await vi.advanceTimersByTimeAsync(100)

    const start = mockUpdateNodeData.mock.calls.map((c) => c[1]).find((patch) => patch.executionStatus === "running")
    expect(start).toBeDefined()
    expect("errorHint" in start!).toBe(true)
    expect(start!.errorHint).toBeUndefined()
    expect("errorMessage" in start!).toBe(true)
    expect(start!.errorMessage).toBeUndefined()
  })
})

// ===========================================================================
// pollImageRefineToNode — the reference-board / region-edit refine lane
//
// It owns a real canvas node (reference-board-node.tsx re-roll + global/masked
// edit, refine-regions-section.tsx region edit) and its jobs are hold-eligible
// (single-node, finalize funnel), so it must behave like every other node lane:
// the hold overlay, the policy-block hint on a 422, and the row's own hint on a
// reject.
// ===========================================================================

describe("pollImageRefineToNode — the job-policy hold and block", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes.length = 0
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("a HELD refine job paints the awaiting-review overlay instead of a bare spinner", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({ status: "pending_review", progress: 90 })
    mockNodes.push({ id: "n1", data: {} })

    void pollImageRefineToNode("n1", apiCall, "Refine")
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)

    const data = mockNodes.find((n) => n.id === "n1")!.data
    expect(data.jobAwaitingReview).toBe(true)
    // A hold is IN FLIGHT — the loop keeps polling and the node stays live.
    expect(data.executionStatus).toBe("running")
  })

  it("the run-start patch clears a previous run's held flag and stale hint", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({ status: "processing", progress: 5 })
    mockNodes.push({
      id: "n1",
      data: { jobAwaitingReview: true, errorHint: { kind: "policy-block", policyId: "p1", reason: "old", hookPoint: "result" } },
    })

    void pollImageRefineToNode("n1", apiCall, "Refine")
    await vi.advanceTimersByTimeAsync(100)

    const data = mockNodes.find((n) => n.id === "n1")!.data
    expect(data.jobAwaitingReview).toBeUndefined()
    expect(data.errorHint).toBeUndefined()
  })

  it("a REJECTED hold carries the row's policy hint onto the node and clears the flag", async () => {
    const apiCall = vi.fn().mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "failed",
      error_message: "Blocked by content policy",
      error_hint: { kind: "policy-block", policyId: "sai", reason: "Blocked by content policy", hookPoint: "result" },
    })
    mockNodes.push({ id: "n1", data: { jobAwaitingReview: true } })

    const promise = pollImageRefineToNode("n1", apiCall, "Refine")
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(promise).rejects.toThrow("Blocked by content policy")

    const data = mockNodes.find((n) => n.id === "n1")!.data
    expect(data.errorHint).toEqual({ kind: "policy-block", policyId: "sai", reason: "Blocked by content policy", hookPoint: "result" })
    expect(data.jobAwaitingReview).toBeUndefined()
  })

  it("a REQUEST-gate 422 synthesizes the policy hint and warns (not a red system error)", async () => {
    const apiCall = vi.fn().mockRejectedValue(
      Object.assign(new Error("Requests for public figures are not allowed."), { code: "job_blocked" }),
    )
    mockNodes.push({ id: "n1", data: {} })

    const promise = pollImageRefineToNode("n1", apiCall, "Refine")
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).rejects.toThrow("Requests for public figures are not allowed.")

    const data = mockNodes.find((n) => n.id === "n1")!.data
    expect(data.errorHint).toEqual({
      kind: "policy-block",
      policyId: "",
      reason: "Requests for public figures are not allowed.",
      hookPoint: "request",
    })
    expect(data.errorMessage).toBe("Requests for public figures are not allowed.")
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockToastWarning).toHaveBeenCalledWith("Refine was blocked by content policy")
  })

  it("an ordinary start failure still reads as an error, with its message on the card", async () => {
    const apiCall = vi.fn().mockRejectedValue(new Error("boom"))
    mockNodes.push({ id: "n1", data: {} })

    const promise = pollImageRefineToNode("n1", apiCall, "Refine")
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).rejects.toThrow("boom")

    const data = mockNodes.find((n) => n.id === "n1")!.data
    expect(data.errorHint).toBeUndefined()
    expect(data.errorMessage).toBe("boom")
    expect(mockToastError).toHaveBeenCalled()
  })
})
