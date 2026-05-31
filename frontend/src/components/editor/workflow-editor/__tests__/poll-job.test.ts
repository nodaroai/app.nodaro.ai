import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetJobStatusLean = vi.fn()
const mockUpdateNodeData = vi.fn()
const mockToastInfo = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockNodes: Array<{ id: string; data: Record<string, unknown> }> = []

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
})
