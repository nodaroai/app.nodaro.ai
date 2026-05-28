import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mock variables (hoisted above vi.mock calls)
// ---------------------------------------------------------------------------

const mockGetBatchJobStatus = vi.fn()
const mockSupabaseFrom = vi.fn()
const mockLoadWorkflow = vi.fn()
const mockSetWorkflowId = vi.fn()
const mockMarkClean = vi.fn()
const mockSetSaveStatus = vi.fn()
const mockSetLoadedUpdatedAt = vi.fn()
const mockSetRemoteUpdatedAt = vi.fn()

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({
  prefetchModelCredits: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/api", () => ({
  getBatchJobStatus: (...args: unknown[]) => mockGetBatchJobStatus(...args),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } } }),
    },
  }),
}))

vi.mock("@/hooks/use-workflow-store", () => {
  const storeState = {
    workflowId: "w1",
    workflowName: "Test",
    nodes: [],
    edges: [],
    characterDefinitions: [],
    flowPromptTemplates: {},
    saveStatus: "idle",
    loadedUpdatedAt: null as string | null,
    remoteUpdatedAt: null as string | null,
  }
  return {
    useWorkflowStore: Object.assign(
      (selector: (s: Record<string, unknown>) => unknown) =>
        selector({
          ...storeState,
          loadWorkflow: mockLoadWorkflow,
          setWorkflowId: mockSetWorkflowId,
          markClean: mockMarkClean,
          setSaveStatus: mockSetSaveStatus,
          setLoadedUpdatedAt: mockSetLoadedUpdatedAt,
          setRemoteUpdatedAt: mockSetRemoteUpdatedAt,
          applySaveSuccess: vi.fn(),
        }),
      {
        getState: () => ({
          ...storeState,
          loadWorkflow: mockLoadWorkflow,
          setWorkflowId: mockSetWorkflowId,
          markClean: mockMarkClean,
          setSaveStatus: mockSetSaveStatus,
          setLoadedUpdatedAt: mockSetLoadedUpdatedAt,
          setRemoteUpdatedAt: mockSetRemoteUpdatedAt,
          applySaveSuccess: vi.fn(),
        }),
        setState: vi.fn(),
        subscribe: vi.fn(),
        destroy: vi.fn(),
      },
    ),
  }
})

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { useWorkflowPersistence } from "../use-workflow-persistence"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
const VALID_UUID_2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901"

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    type: "generate-image",
    position: { x: 0, y: 0 },
    data: { label: "Test", executionStatus: "idle" },
    ...overrides,
  }
}

function setupSupabaseLoad(workflowData: Record<string, unknown>) {
  // Default updated_at when callers don't supply one — keeps the new
  // optimistic-locking code path happy without forcing every existing
  // fixture to opt in.
  const withUpdatedAt = { updated_at: "2026-01-01T00:00:00Z", ...workflowData }
  mockSupabaseFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: withUpdatedAt, error: null }),
      }),
    }),
    update: () => ({
      eq: () => ({
        // Direct await path (legacy `await .update(...).eq(...)`).
        error: null,
        // New chain: `.eq(...).select("updated_at").maybeSingle()` for the
        // side-save after node-result sync, and (after one more `.eq` for
        // optimistic locking) for the save() path.
        select: () => ({
          maybeSingle: async () => ({ data: { updated_at: "2026-01-02T00:00:00Z" }, error: null }),
        }),
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: { updated_at: "2026-01-02T00:00:00Z" }, error: null }),
          }),
        }),
      }),
    }),
  })
}

/**
 * Extract the synced nodes from the second loadWorkflow call.
 * The load function calls loadWorkflow twice:
 *   1. Clear call: loadWorkflow(id, "", [], [], [])
 *   2. Data call:  loadWorkflow(id, name, syncedNodes, edges, charDefs, flowTemplates)
 * We want the nodes from the second call.
 */
function getSyncedNodes(): Record<string, unknown>[] {
  const calls = mockLoadWorkflow.mock.calls
  const lastCall = calls[calls.length - 1]
  return lastCall[2] as Record<string, unknown>[]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useWorkflowPersistence — syncNodeResultsFromDB (via load)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBatchJobStatus.mockResolvedValue([])
  })

  // -----------------------------------------------------------------------
  // No-sync scenarios
  // -----------------------------------------------------------------------

  it("passes through nodes unchanged when none are running or pending", async () => {
    const nodes = [
      makeNode({ id: "n1", data: { label: "Img", executionStatus: "completed" } }),
      makeNode({ id: "n2", data: { label: "Img2", executionStatus: "idle" } }),
    ]
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    expect(mockGetBatchJobStatus).not.toHaveBeenCalled()
    const synced = getSyncedNodes()
    expect(synced).toHaveLength(2)
    expect((synced[0].data as Record<string, unknown>).executionStatus).toBe("completed")
    expect((synced[1].data as Record<string, unknown>).executionStatus).toBe("idle")
  })

  it("does not call getBatchJobStatus for empty node arrays", async () => {
    setupSupabaseLoad({ id: "w1", name: "Test", nodes: [], edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    expect(mockGetBatchJobStatus).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // Reset to idle (no valid job IDs)
  // -----------------------------------------------------------------------

  it("resets running nodes to idle when no valid job IDs exist", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        data: { label: "Img", executionStatus: "running" },
      }),
    ]
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    expect(mockGetBatchJobStatus).not.toHaveBeenCalled()
    const synced = getSyncedNodes()
    expect((synced[0].data as Record<string, unknown>).executionStatus).toBe("idle")
  })

  it("resets pending nodes to idle when no valid job IDs exist", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        data: { label: "Img", executionStatus: "pending" },
      }),
    ]
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const synced = getSyncedNodes()
    expect((synced[0].data as Record<string, unknown>).executionStatus).toBe("idle")
  })

  it("ignores non-UUID jobIds in generatedResults", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        data: {
          label: "Img",
          executionStatus: "running",
          generatedResults: [
            { url: "img.png", timestamp: "2024-01-01", jobId: "not-a-uuid" },
            { url: "img2.png", timestamp: "2024-01-02", jobId: "local-123" },
          ],
        },
      }),
    ]
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    // No valid UUIDs found, so it resets to idle without API call
    expect(mockGetBatchJobStatus).not.toHaveBeenCalled()
    const synced = getSyncedNodes()
    expect((synced[0].data as Record<string, unknown>).executionStatus).toBe("idle")
  })

  // -----------------------------------------------------------------------
  // Completed jobs — various output types
  // -----------------------------------------------------------------------

  it("updates completed job with imageUrl", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/img.png" },
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const synced = getSyncedNodes()
    const data = synced[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("completed")
    expect(data.generatedImageUrl).toBe("https://cdn.example.com/img.png")
    expect(data.activeResultIndex).toBe(0)
    expect(data.currentJobId).toBeUndefined()
  })

  it("updates completed job with videoUrl", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "image-to-video",
        data: {
          label: "Vid",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { videoUrl: "https://cdn.example.com/vid.mp4" },
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("completed")
    expect(data.generatedVideoUrl).toBe("https://cdn.example.com/vid.mp4")
  })

  it("updates completed job with audioUrl", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "text-to-speech",
        data: {
          label: "TTS",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { audioUrl: "https://cdn.example.com/audio.mp3" },
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("completed")
    expect(data.generatedAudioUrl).toBe("https://cdn.example.com/audio.mp3")
  })

  it("updates completed job with script output", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "generate-script",
        data: {
          label: "Script",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { script: { scenes: [{ title: "Intro" }] } },
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("completed")
    expect(data.generatedScript).toEqual({ scenes: [{ title: "Intro" }] })
  })

  // -----------------------------------------------------------------------
  // Entity nodes — use sourceImageUrl instead of generatedImageUrl
  // -----------------------------------------------------------------------

  it.each(["character", "face", "object", "location"])(
    "uses sourceImageUrl for %s entity node",
    async (nodeType) => {
      const nodes = [
        makeNode({
          id: "n1",
          type: nodeType,
          data: {
            label: nodeType,
            executionStatus: "running",
            currentJobId: VALID_UUID,
            generatedResults: [],
          },
        }),
      ]
      mockGetBatchJobStatus.mockResolvedValue([
        {
          id: VALID_UUID,
          status: "completed",
          output_data: { imageUrl: "https://cdn.example.com/entity.png" },
          error_message: null,
        },
      ])
      setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

      const { result } = renderHook(() => useWorkflowPersistence("p1"))
      await act(async () => {
        await result.current.load("w1")
      })

      const data = getSyncedNodes()[0].data as Record<string, unknown>
      expect(data.sourceImageUrl).toBe("https://cdn.example.com/entity.png")
      expect(data.generatedImageUrl).toBeUndefined()
    },
  )

  // -----------------------------------------------------------------------
  // Failed jobs
  // -----------------------------------------------------------------------

  it("sets failed status with error message", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "failed",
        output_data: null,
        error_message: "Out of memory",
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("failed")
    expect(data.errorMessage).toBe("Out of memory")
    expect(data.currentJobId).toBeUndefined()
  })

  it("uses default error message when error_message is null", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "failed",
        output_data: null,
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("failed")
    expect(data.errorMessage).toBe("Job failed")
  })

  // -----------------------------------------------------------------------
  // Cancelled jobs
  // -----------------------------------------------------------------------

  it("resets cancelled jobs to idle", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "cancelled",
        output_data: null,
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("idle")
    expect(data.currentJobId).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // Still-running jobs (pending/processing status)
  // -----------------------------------------------------------------------

  it("returns still-running jobs for processing status", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "processing",
        output_data: null,
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    let loadResult: { success: boolean; stillRunningJobs?: { nodeId: string; jobId: string; nodeType: string }[] } | undefined
    await act(async () => {
      loadResult = await result.current.load("w1")
    })

    expect(loadResult!.stillRunningJobs).toHaveLength(1)
    expect(loadResult!.stillRunningJobs![0]).toEqual({
      nodeId: "n1",
      jobId: VALID_UUID,
      nodeType: "generate-image",
    })
  })

  it("returns still-running jobs for pending status", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "pending",
        output_data: null,
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    let loadResult: { success: boolean; stillRunningJobs?: { nodeId: string; jobId: string; nodeType: string }[] } | undefined
    await act(async () => {
      loadResult = await result.current.load("w1")
    })

    expect(loadResult!.stillRunningJobs).toHaveLength(1)
    expect(loadResult!.stillRunningJobs![0].jobId).toBe(VALID_UUID)
  })

  // -----------------------------------------------------------------------
  // Job not found in API response
  // -----------------------------------------------------------------------

  it("resets node to idle when job is not found in API response", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("idle")
    expect(data.currentJobId).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // API error handling
  // -----------------------------------------------------------------------

  it("returns nodes unchanged when getBatchJobStatus throws a network error", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockRejectedValue(new Error("Network error"))
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    // On API failure, nodes pass through unchanged
    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("running")
  })

  it("returns nodes unchanged when getBatchJobStatus throws AbortError", async () => {
    const abortError = new DOMException("Aborted", "AbortError")
    const nodes = [
      makeNode({
        id: "n1",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockRejectedValue(abortError)
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("running")
  })

  // -----------------------------------------------------------------------
  // Multiple nodes with different outcomes
  // -----------------------------------------------------------------------

  it("handles multiple running nodes with different job outcomes", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img1",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
      makeNode({
        id: "n2",
        type: "image-to-video",
        data: {
          label: "Vid",
          executionStatus: "running",
          currentJobId: VALID_UUID_2,
          generatedResults: [],
        },
      }),
      makeNode({
        id: "n3",
        type: "text-prompt",
        data: { label: "Text", executionStatus: "completed" },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/img.png" },
        error_message: null,
      },
      {
        id: VALID_UUID_2,
        status: "failed",
        output_data: null,
        error_message: "Render error",
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const synced = getSyncedNodes()
    // First node: completed with image
    const data1 = synced[0].data as Record<string, unknown>
    expect(data1.executionStatus).toBe("completed")
    expect(data1.generatedImageUrl).toBe("https://cdn.example.com/img.png")

    // Second node: failed with error
    const data2 = synced[1].data as Record<string, unknown>
    expect(data2.executionStatus).toBe("failed")
    expect(data2.errorMessage).toBe("Render error")

    // Third node: untouched (was already completed)
    const data3 = synced[2].data as Record<string, unknown>
    expect(data3.executionStatus).toBe("completed")
  })

  it("deduplicates job IDs across multiple nodes sharing the same job", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img1",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
      makeNode({
        id: "n2",
        type: "generate-image",
        data: {
          label: "Img2",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/img.png" },
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    // getBatchJobStatus should be called once with deduplicated IDs
    expect(mockGetBatchJobStatus).toHaveBeenCalledTimes(1)
    expect(mockGetBatchJobStatus).toHaveBeenCalledWith([VALID_UUID])
  })

  // -----------------------------------------------------------------------
  // Job ID sourcing (currentJobId vs generatedResults)
  // -----------------------------------------------------------------------

  it("prefers currentJobId over generatedResults jobId", async () => {
    const otherUuid = "c3d4e5f6-a7b8-9012-cdef-123456789012"
    const nodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [
            { url: "old.png", timestamp: "2024-01-01", jobId: otherUuid },
          ],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/new.png" },
        error_message: null,
      },
      {
        id: otherUuid,
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/old.png" },
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    // Should use the result from currentJobId, not the generatedResults jobId
    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.generatedImageUrl).toBe("https://cdn.example.com/new.png")
  })

  it("falls back to most recent generatedResult jobId when currentJobId is absent", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img",
          executionStatus: "running",
          generatedResults: [
            { url: "", timestamp: "2024-01-01", jobId: VALID_UUID },
          ],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/result.png" },
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    expect(data.executionStatus).toBe("completed")
    expect(data.generatedImageUrl).toBe("https://cdn.example.com/result.png")
  })

  // -----------------------------------------------------------------------
  // generatedResults update behavior
  // -----------------------------------------------------------------------

  it("prepends a result entry when currentJobId has no matching result", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/img.png" },
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    const results = data.generatedResults as { url: string; jobId: string }[]
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe("https://cdn.example.com/img.png")
    expect(results[0].jobId).toBe(VALID_UUID)
  })

  it("updates first result URL when it matches the job and has no URL", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [
            { url: "", timestamp: "2024-01-01", jobId: VALID_UUID },
          ],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/img.png" },
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    await act(async () => {
      await result.current.load("w1")
    })

    const data = getSyncedNodes()[0].data as Record<string, unknown>
    const results = data.generatedResults as { url: string; jobId: string }[]
    // Should update the existing entry, not add a duplicate
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe("https://cdn.example.com/img.png")
  })

  // -----------------------------------------------------------------------
  // load() return value
  // -----------------------------------------------------------------------

  it("returns success: true with empty stillRunningJobs when all jobs resolved", async () => {
    const nodes = [
      makeNode({
        id: "n1",
        data: {
          label: "Img",
          executionStatus: "running",
          currentJobId: VALID_UUID,
          generatedResults: [],
        },
      }),
    ]
    mockGetBatchJobStatus.mockResolvedValue([
      {
        id: VALID_UUID,
        status: "completed",
        output_data: { imageUrl: "https://cdn.example.com/img.png" },
        error_message: null,
      },
    ])
    setupSupabaseLoad({ id: "w1", name: "Test", nodes, edges: [], settings: {} })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    let loadResult: { success: boolean; stillRunningJobs?: unknown[] } | undefined
    await act(async () => {
      loadResult = await result.current.load("w1")
    })

    expect(loadResult!.success).toBe(true)
    expect(loadResult!.stillRunningJobs).toHaveLength(0)
  })

  it("returns success: false when supabase fetch fails", async () => {
    mockSupabaseFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { message: "Not found" } }),
        }),
      }),
    })

    const { result } = renderHook(() => useWorkflowPersistence("p1"))
    let loadResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      loadResult = await result.current.load("w1")
    })

    expect(loadResult!.success).toBe(false)
    expect(loadResult!.error).toBe("Not found")
  })
})
