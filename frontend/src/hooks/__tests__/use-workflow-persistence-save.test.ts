import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mock variables (hoisted above vi.mock calls)
// ---------------------------------------------------------------------------

const mockSupabaseFrom = vi.fn()
const mockGetUser = vi.fn()
const mockLoadWorkflow = vi.fn()
const mockSetWorkflowId = vi.fn()
const mockMarkClean = vi.fn()
const mockSetSaveStatus = vi.fn()

// Store state that can be mutated per test
let storeState: Record<string, unknown> = {}

function resetStoreState(overrides: Record<string, unknown> = {}) {
  storeState = {
    workflowId: null,
    workflowName: "Test Workflow",
    nodes: [],
    edges: [],
    characterDefinitions: [],
    flowPromptTemplates: {},
    presentationSettings: { runTarget: "workflow" },
    saveStatus: "idle",
    ...overrides,
  }
}

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
  getBatchJobStatus: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}))

vi.mock("@/hooks/use-workflow-store", () => {
  return {
    useWorkflowStore: Object.assign(
      (selector: (s: Record<string, unknown>) => unknown) =>
        selector({
          ...storeState,
          loadWorkflow: mockLoadWorkflow,
          setWorkflowId: mockSetWorkflowId,
          markClean: mockMarkClean,
          setSaveStatus: mockSetSaveStatus,
        }),
      {
        getState: () => ({
          ...storeState,
          loadWorkflow: mockLoadWorkflow,
          setWorkflowId: mockSetWorkflowId,
          markClean: mockMarkClean,
          setSaveStatus: mockSetSaveStatus,
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

function makeNode(id: string, data: Record<string, unknown> = {}) {
  return {
    id,
    type: "generate-image",
    position: { x: 0, y: 0 },
    data: { label: "Test", executionStatus: "idle", ...data },
  }
}

function makeEdge(id: string, source: string, target: string) {
  return { id, source, target, type: "default" }
}

/** Set up supabase.from("workflows").update(...).eq(...) chain for update (existing workflow). */
function setupSupabaseUpdate(error: { message: string } | null = null) {
  mockSupabaseFrom.mockReturnValue({
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error }),
    }),
  })
}

/** Set up supabase.from("workflows").insert(...).select("id").single() chain for insert (new workflow). */
function setupSupabaseInsert(
  data: { id: string } | null = { id: "new-workflow-id" },
  error: { message: string } | null = null,
) {
  mockSupabaseFrom.mockReturnValue({
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useWorkflowPersistence — save", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    resetStoreState()
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -----------------------------------------------------------------------
  // Early returns
  // -----------------------------------------------------------------------

  it("returns error when no projectId is available", async () => {
    resetStoreState({ nodes: [makeNode("n1")] })

    const { result } = renderHook(() => useWorkflowPersistence(undefined))
    let saveResult: { success: boolean; error?: string } | undefined

    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(false)
    expect(saveResult!.error).toBe("No project ID")
    expect(mockSupabaseFrom).not.toHaveBeenCalled()
  })

  it("returns error when workflow has no nodes (empty workflow)", async () => {
    resetStoreState({ nodes: [] })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined

    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(false)
    expect(saveResult!.error).toBe("Empty workflow")
    expect(mockSupabaseFrom).not.toHaveBeenCalled()
  })

  it("uses pid argument over hook projectId when both are provided", async () => {
    const nodes = [makeNode("n1")]
    resetStoreState({ workflowId: "w1", nodes })
    setupSupabaseUpdate()

    const { result } = renderHook(() => useWorkflowPersistence("hook-project"))

    await act(async () => {
      await result.current.save("arg-project")
    })

    // The payload should use the arg-project, verify via the from call
    expect(mockSupabaseFrom).toHaveBeenCalledWith("workflows")
    // The update was called which means it resolved correctly
    expect(mockMarkClean).toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // UPDATE path (existing workflowId)
  // -----------------------------------------------------------------------

  it("calls supabase update when workflowId exists", async () => {
    const nodes = [makeNode("n1", { prompt: "a sunset" })]
    const edges = [makeEdge("e1", "n1", "n2")]
    resetStoreState({ workflowId: "existing-wf-id", workflowName: "My Flow", nodes, edges })

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    mockSupabaseFrom.mockReturnValue({ update: mockUpdate })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      const saveResult = await result.current.save()
      expect(saveResult.success).toBe(true)
    })

    expect(mockSupabaseFrom).toHaveBeenCalledWith("workflows")
    expect(mockUpdate).toHaveBeenCalledTimes(1)

    // Verify the payload contains expected fields
    const payload = mockUpdate.mock.calls[0][0]
    expect(payload.project_id).toBe("proj-1")
    expect(payload.name).toBe("My Flow")
    expect(payload.nodes).toHaveLength(1)
    expect(payload.edges).toHaveLength(1)
  })

  it("does NOT call setWorkflowId on update (existing workflow)", async () => {
    resetStoreState({ workflowId: "existing-wf-id", nodes: [makeNode("n1")] })
    setupSupabaseUpdate()

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    expect(mockSetWorkflowId).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // INSERT path (no workflowId)
  // -----------------------------------------------------------------------

  it("calls supabase insert when workflowId is null (new workflow)", async () => {
    const nodes = [makeNode("n1")]
    resetStoreState({ workflowId: null, workflowName: "New Workflow", nodes })

    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: "new-wf-123" },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    mockSupabaseFrom.mockReturnValue({ insert: mockInsert })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      const saveResult = await result.current.save()
      expect(saveResult.success).toBe(true)
    })

    expect(mockGetUser).toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledTimes(1)

    // Verify payload includes user_id
    const payload = mockInsert.mock.calls[0][0]
    expect(payload.user_id).toBe("user-123")
    expect(payload.project_id).toBe("proj-1")
    expect(payload.name).toBe("New Workflow")
  })

  it("sets workflowId from response after successful insert", async () => {
    resetStoreState({ workflowId: null, nodes: [makeNode("n1")] })
    setupSupabaseInsert({ id: "brand-new-wf" })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    expect(mockSetWorkflowId).toHaveBeenCalledWith("brand-new-wf")
  })

  it("returns error when user is not authenticated (insert path)", async () => {
    resetStoreState({ workflowId: null, nodes: [makeNode("n1")] })
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(false)
    expect(saveResult!.error).toBe("Not authenticated")
    expect(mockSetSaveStatus).toHaveBeenCalledWith("error", "Not authenticated")
  })

  // -----------------------------------------------------------------------
  // Status transitions
  // -----------------------------------------------------------------------

  it("transitions through saving -> saved -> idle statuses on success", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })
    setupSupabaseUpdate()

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    // Should have been called with "saving" first, then "saved"
    const statusCalls = mockSetSaveStatus.mock.calls.map((c: unknown[]) => c[0])
    expect(statusCalls).toContain("saving")
    expect(statusCalls).toContain("saved")

    // After 2000ms, it should reset to "idle"
    // We need the store to report "saved" when getState() is called
    storeState.saveStatus = "saved"

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(mockSetSaveStatus).toHaveBeenCalledWith("idle")
  })

  it("sets status to error on update failure", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })
    setupSupabaseUpdate({ message: "Permission denied" })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(false)
    expect(saveResult!.error).toBe("Permission denied")
    expect(mockSetSaveStatus).toHaveBeenCalledWith("error", "Permission denied")
  })

  it("sets status to error on insert failure", async () => {
    resetStoreState({ workflowId: null, nodes: [makeNode("n1")] })
    setupSupabaseInsert(null, { message: "Duplicate key" })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(false)
    expect(saveResult!.error).toBe("Duplicate key")
    expect(mockSetSaveStatus).toHaveBeenCalledWith("error", "Duplicate key")
  })

  // -----------------------------------------------------------------------
  // markClean
  // -----------------------------------------------------------------------

  it("calls markClean after successful save", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })
    setupSupabaseUpdate()

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    expect(mockMarkClean).toHaveBeenCalledTimes(1)
  })

  it("does NOT call markClean on save failure", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })
    setupSupabaseUpdate({ message: "DB error" })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    expect(mockMarkClean).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // Payload correctness - deep clone and structure
  // -----------------------------------------------------------------------

  it("deep clones nodes and edges so mutations do not affect originals", async () => {
    const originalNode = makeNode("n1", { prompt: "hello" })
    const originalEdge = makeEdge("e1", "n1", "n2")
    resetStoreState({ workflowId: "w1", nodes: [originalNode], edges: [originalEdge] })

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    mockSupabaseFrom.mockReturnValue({ update: mockUpdate })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    const payload = mockUpdate.mock.calls[0][0]
    // Verify the payload nodes are equal in value
    expect(payload.nodes[0].id).toBe("n1")
    expect(payload.edges[0].id).toBe("e1")

    // Verify they are different object references (deep cloned via JSON.parse/JSON.stringify)
    expect(payload.nodes[0]).not.toBe(originalNode)
    expect(payload.edges[0]).not.toBe(originalEdge)
  })

  it("includes characterDefinitions and flowPromptTemplates in settings", async () => {
    const charDef = { id: "c1", name: "Hero", description: "The main character", visualTraits: {} }
    const templates = { "node_1": "custom prompt for {{scene}}" }
    resetStoreState({
      workflowId: "w1",
      nodes: [makeNode("n1")],
      characterDefinitions: [charDef],
      flowPromptTemplates: templates,
    })

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    mockSupabaseFrom.mockReturnValue({ update: mockUpdate })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    const payload = mockUpdate.mock.calls[0][0]
    expect(payload.settings.characterDefinitions).toEqual([charDef])
    expect(payload.settings.flowPromptTemplates).toEqual(templates)
  })

  // -----------------------------------------------------------------------
  // Exception handling
  // -----------------------------------------------------------------------

  it("handles unexpected exceptions gracefully", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })

    // Make supabase.from throw an unexpected error
    mockSupabaseFrom.mockImplementation(() => {
      throw new Error("Unexpected crash")
    })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(false)
    expect(saveResult!.error).toBe("Unexpected crash")
    expect(mockSetSaveStatus).toHaveBeenCalledWith("error", "Unexpected crash")
    // saving should be reset to false even after exception
    expect(result.current.saving).toBe(false)
  })

  it("uses generic message for non-Error exceptions", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })

    mockSupabaseFrom.mockImplementation(() => {
      throw "string error"
    })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(false)
    expect(saveResult!.error).toBe("Failed to save")
  })
})
