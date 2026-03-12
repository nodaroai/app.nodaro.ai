import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock variables (declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mockUpdateNodeData = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastInfo = vi.fn()
const mockGetJobStatus = vi.fn()
let mockNodes: Array<{
  id: string
  type?: string
  data: Record<string, unknown>
}> = []
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
  getJobStatus: (...args: unknown[]) => mockGetJobStatus(...args),
  getUserCredits: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  }),
}))

vi.mock("@/lib/edition", () => ({
  hasCredits: () => false,
}))

vi.mock("@/lib/query-client", () => ({
  queryClient: { fetchQuery: vi.fn() },
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    credits: { balance: (id: string) => ["credits", "balance", id] },
  },
}))

vi.mock("@/hooks/use-model-credits", () => ({
  getCachedCredits: vi.fn(),
}))

vi.mock("../types", () => ({
  WorkflowStaleError: class WorkflowStaleError extends Error {
    constructor() {
      super("Workflow changed during execution")
    }
  },
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  NODE_CREDIT_COSTS: { "generate-image": 1 } as Record<string, number>,
  isExecutableNode: (n: any) => {
    const EXECUTABLE = new Set([
      "generate-image",
      "image-to-video",
      "generate-script",
      "text-to-speech",
    ])
    return EXECUTABLE.has(n.type ?? "")
  },
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

import { restorePollingForRunningJobs } from "../run-handlers"
import type { ExecutionContext } from "../types"

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

function makeNode(
  id: string,
  type = "generate-image",
  extras: Record<string, unknown> = {},
) {
  return {
    id,
    type,
    data: { label: type, ...extras },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("restorePollingForRunningJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockNodes = []
    mockEdges = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 1. No running nodes - returns immediately without polling
  it("returns immediately when runningJobs is empty", () => {
    const setIsRunning = vi.fn()
    const ctx = makeCtx()

    restorePollingForRunningJobs([], ctx, setIsRunning)

    expect(setIsRunning).not.toHaveBeenCalled()
    expect(mockGetJobStatus).not.toHaveBeenCalled()
  })

  // 2. Sets isRunning(true) when there are running jobs
  it("calls setIsRunning(true) when there are running jobs", () => {
    mockNodes = [makeNode("n1")]
    const setIsRunning = vi.fn()
    const ctx = makeCtx()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    expect(setIsRunning).toHaveBeenCalledWith(true)
  })

  // 3. Single running node completes with imageUrl
  it("updates node with generatedImageUrl when job completes with imageUrl", async () => {
    mockNodes = [makeNode("n1", "generate-image", { generatedResults: [] })]
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      output_data: { imageUrl: "https://cdn.example.com/img.png" },
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    // Advance past the 3000ms interval
    await vi.advanceTimersByTimeAsync(3000)

    expect(mockGetJobStatus).toHaveBeenCalledWith("j1")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedImageUrl: "https://cdn.example.com/img.png",
        activeResultIndex: 0,
        currentJobId: undefined,
        currentJobProgress: undefined,
      }),
    )
    expect(ctx.untrackInterval).toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledWith("Background job completed")
  })

  // 4. Single running node completes with videoUrl
  it("updates node with generatedVideoUrl when job completes with videoUrl", async () => {
    mockNodes = [makeNode("n1", "image-to-video", { generatedResults: [] })]
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "https://cdn.example.com/vid.mp4" },
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "image-to-video" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedVideoUrl: "https://cdn.example.com/vid.mp4",
      }),
    )
  })

  // 5. Single running node completes with audioUrl
  it("updates node with generatedAudioUrl when job completes with audioUrl", async () => {
    mockNodes = [makeNode("n1", "text-to-speech", { generatedResults: [] })]
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      output_data: { audioUrl: "https://cdn.example.com/audio.mp3" },
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "text-to-speech" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedAudioUrl: "https://cdn.example.com/audio.mp3",
      }),
    )
  })

  // 6. Job completes with script output
  it("updates node with generatedScript when job completes with script", async () => {
    mockNodes = [makeNode("n1", "generate-script", { generatedResults: [] })]
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      output_data: { script: "Once upon a time..." },
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-script" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedScript: "Once upon a time...",
      }),
    )
  })

  // 7. Job fails - updates node status to failed with error message
  it("updates node to failed status when job fails", async () => {
    mockNodes = [makeNode("n1")]
    mockGetJobStatus.mockResolvedValue({
      status: "failed",
      error_message: "Provider timeout",
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", {
      executionStatus: "failed",
      errorMessage: "Provider timeout",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
    expect(ctx.untrackInterval).toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith("Job failed", {
      description: "Provider timeout",
    })
  })

  // 8. Job fails with no error_message - defaults to "Unknown error"
  it("uses 'Unknown error' when job fails without error_message", async () => {
    mockNodes = [makeNode("n1")]
    mockGetJobStatus.mockResolvedValue({
      status: "failed",
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", {
      executionStatus: "failed",
      errorMessage: "Unknown error",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
  })

  // 9. Job cancelled - resets node to idle
  it("resets node to idle when job is cancelled", async () => {
    mockNodes = [makeNode("n1")]
    mockGetJobStatus.mockResolvedValue({
      status: "cancelled",
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", {
      executionStatus: "idle",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
    expect(ctx.untrackInterval).toHaveBeenCalled()
  })

  // 10. Poll failure counter - after 5 consecutive failures, stops and marks error
  it("marks node as failed after 5 consecutive poll failures", async () => {
    mockNodes = [makeNode("n1")]
    mockGetJobStatus.mockRejectedValue(new Error("Network error"))

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    // Advance through 5 poll intervals (5 * 3000ms)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(3000)
    }

    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", {
      executionStatus: "failed",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
    expect(ctx.untrackInterval).toHaveBeenCalled()
  })

  // 11. Poll failures reset on successful poll
  it("resets failure counter on successful poll", async () => {
    mockNodes = [makeNode("n1", "generate-image", { generatedResults: [] })]
    let callCount = 0
    mockGetJobStatus.mockImplementation(async () => {
      callCount++
      // Fail 4 times, then succeed with processing, then fail 4 more, then complete
      if (callCount <= 4) throw new Error("Network error")
      if (callCount === 5) return { status: "processing", progress: 50 }
      if (callCount <= 9) throw new Error("Network error")
      return {
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/img.png" },
      }
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    // Advance through 10 poll intervals
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(3000)
    }

    // Should not have been marked as failed because failures reset at call 5
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedImageUrl: "https://cdn.example.com/img.png",
      }),
    )
  })

  // 12. Multiple running nodes - polls all concurrently
  it("polls multiple running jobs concurrently", async () => {
    mockNodes = [
      makeNode("n1", "generate-image", { generatedResults: [] }),
      makeNode("n2", "image-to-video", { generatedResults: [] }),
    ]

    mockGetJobStatus.mockImplementation(async (jobId: string) => {
      if (jobId === "j1") {
        return {
          status: "completed",
          output_data: { imageUrl: "https://cdn.example.com/img.png" },
        }
      }
      return {
        status: "completed",
        output_data: { videoUrl: "https://cdn.example.com/vid.mp4" },
      }
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [
        { nodeId: "n1", jobId: "j1", nodeType: "generate-image" },
        { nodeId: "n2", jobId: "j2", nodeType: "image-to-video" },
      ],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(mockGetJobStatus).toHaveBeenCalledWith("j1")
    expect(mockGetJobStatus).toHaveBeenCalledWith("j2")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedImageUrl: "https://cdn.example.com/img.png",
      }),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n2",
      expect.objectContaining({
        executionStatus: "completed",
        generatedVideoUrl: "https://cdn.example.com/vid.mp4",
      }),
    )
  })

  // 13. Progress updates during polling
  it("updates progress when job reports progress", async () => {
    mockNodes = [makeNode("n1", "generate-image", { generatedResults: [] })]
    let callCount = 0
    mockGetJobStatus.mockImplementation(async () => {
      callCount++
      if (callCount === 1) return { status: "processing", progress: 40 }
      return {
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/img.png" },
      }
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    // First poll - processing with progress
    await vi.advanceTimersByTimeAsync(3000)

    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", {
      currentJobProgress: 40,
    })

    // Second poll - completed
    await vi.advanceTimersByTimeAsync(3000)

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
      }),
    )
  })

  // 14. Workflow stale stops polling
  it("stops polling when workflow becomes stale", async () => {
    mockNodes = [makeNode("n1")]
    mockGetJobStatus.mockResolvedValue({ status: "processing", progress: 50 })

    const ctx = makeCtx({ isWorkflowStale: () => true })
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(mockGetJobStatus).not.toHaveBeenCalled()
    expect(ctx.untrackInterval).toHaveBeenCalled()
  })

  // 15. Node removed from store stops polling
  it("stops polling when node is no longer in the store", async () => {
    // Start with node present, but it will not be found by getState
    mockNodes = []
    mockGetJobStatus.mockResolvedValue({ status: "processing", progress: 50 })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    // Should have checked for node but stopped since not found
    expect(ctx.untrackInterval).toHaveBeenCalled()
    expect(mockGetJobStatus).not.toHaveBeenCalled()
  })

  // 16. trackInterval is called for each running job
  it("calls trackInterval for each running job", () => {
    mockNodes = [makeNode("n1"), makeNode("n2")]
    const trackInterval = vi.fn((i) => i)
    const ctx = makeCtx({ trackInterval })
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [
        { nodeId: "n1", jobId: "j1", nodeType: "generate-image" },
        { nodeId: "n2", jobId: "j2", nodeType: "generate-image" },
      ],
      ctx,
      setIsRunning,
    )

    expect(trackInterval).toHaveBeenCalledTimes(2)
  })

  // 17. Character node type uses sourceImageUrl instead of generatedImageUrl
  it("sets sourceImageUrl for character node type with imageUrl output", async () => {
    mockNodes = [makeNode("n1", "character", { generatedResults: [] })]
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      output_data: { imageUrl: "https://cdn.example.com/char.png" },
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "character" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        sourceImageUrl: "https://cdn.example.com/char.png",
      }),
    )
  })

  // 18. Face node type uses sourceImageUrl
  it("sets sourceImageUrl for face node type with imageUrl output", async () => {
    mockNodes = [makeNode("n1", "face", { generatedResults: [] })]
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      output_data: { imageUrl: "https://cdn.example.com/face.png" },
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "face" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        sourceImageUrl: "https://cdn.example.com/face.png",
      }),
    )
    // Should NOT have generatedImageUrl
    const updateCall = mockUpdateNodeData.mock.calls.find(
      (call: unknown[]) =>
        call[0] === "n1" &&
        (call[1] as Record<string, unknown>).executionStatus === "completed",
    )
    expect(updateCall).toBeDefined()
    expect((updateCall![1] as Record<string, unknown>).generatedImageUrl).toBeUndefined()
  })

  // 19. generatedResults are prepended correctly
  it("prepends new result to existing generatedResults", async () => {
    const existingResults = [
      { url: "https://cdn.example.com/old.png", timestamp: "2026-01-01T00:00:00.000Z", jobId: "j0" },
    ]
    mockNodes = [makeNode("n1", "generate-image", { generatedResults: existingResults })]
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      output_data: { imageUrl: "https://cdn.example.com/new.png" },
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    const completionCall = mockUpdateNodeData.mock.calls.find(
      (call: unknown[]) =>
        call[0] === "n1" &&
        (call[1] as Record<string, unknown>).executionStatus === "completed",
    )
    expect(completionCall).toBeDefined()
    const results = (completionCall![1] as Record<string, unknown>).generatedResults as Array<{
      url: string
      jobId: string
    }>
    expect(results).toHaveLength(2)
    expect(results[0].url).toBe("https://cdn.example.com/new.png")
    expect(results[0].jobId).toBe("j1")
    expect(results[1].url).toBe("https://cdn.example.com/old.png")
  })

  // 20. Completed job with no recognized output sets empty url in result
  it("sets empty url when completed job has no recognized output type", async () => {
    mockNodes = [makeNode("n1", "generate-image", { generatedResults: [] })]
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      output_data: { someOtherField: "value" },
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    const completionCall = mockUpdateNodeData.mock.calls.find(
      (call: unknown[]) =>
        call[0] === "n1" &&
        (call[1] as Record<string, unknown>).executionStatus === "completed",
    )
    expect(completionCall).toBeDefined()
    const results = (completionCall![1] as Record<string, unknown>).generatedResults as Array<{
      url: string
    }>
    expect(results[0].url).toBe("")
    // Should not set generatedImageUrl, generatedVideoUrl, or generatedAudioUrl
    const updates = completionCall![1] as Record<string, unknown>
    expect(updates.generatedImageUrl).toBeUndefined()
    expect(updates.generatedVideoUrl).toBeUndefined()
    expect(updates.generatedAudioUrl).toBeUndefined()
  })

  // 21. Zero progress is not updated (only > 0 triggers update)
  it("does not update progress when progress is 0", async () => {
    mockNodes = [makeNode("n1", "generate-image", { generatedResults: [] })]
    let callCount = 0
    mockGetJobStatus.mockImplementation(async () => {
      callCount++
      if (callCount === 1) return { status: "processing", progress: 0 }
      return {
        status: "completed",
        output_data: { imageUrl: "url" },
      }
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    await vi.advanceTimersByTimeAsync(3000)

    // Should NOT have called updateNodeData with progress 0
    const progressCalls = mockUpdateNodeData.mock.calls.filter(
      (call: unknown[]) =>
        (call[1] as Record<string, unknown>).currentJobProgress !== undefined,
    )
    expect(progressCalls).toHaveLength(0)
  })

  // 22. Polls at 3000ms intervals
  it("polls at 3000ms intervals", async () => {
    mockNodes = [makeNode("n1", "generate-image", { generatedResults: [] })]
    let callCount = 0
    mockGetJobStatus.mockImplementation(async () => {
      callCount++
      if (callCount < 3) return { status: "processing", progress: callCount * 30 }
      return {
        status: "completed",
        output_data: { imageUrl: "url" },
      }
    })

    const ctx = makeCtx()
    const setIsRunning = vi.fn()

    restorePollingForRunningJobs(
      [{ nodeId: "n1", jobId: "j1", nodeType: "generate-image" }],
      ctx,
      setIsRunning,
    )

    // No poll at time 0
    expect(mockGetJobStatus).not.toHaveBeenCalled()

    // First poll at 3000ms
    await vi.advanceTimersByTimeAsync(3000)
    expect(mockGetJobStatus).toHaveBeenCalledTimes(1)

    // Second poll at 6000ms
    await vi.advanceTimersByTimeAsync(3000)
    expect(mockGetJobStatus).toHaveBeenCalledTimes(2)

    // Third poll at 9000ms -> completes
    await vi.advanceTimersByTimeAsync(3000)
    expect(mockGetJobStatus).toHaveBeenCalledTimes(3)
  })
})
