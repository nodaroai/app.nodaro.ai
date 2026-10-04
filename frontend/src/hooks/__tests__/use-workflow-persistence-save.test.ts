import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mock variables (hoisted above vi.mock calls)
// ---------------------------------------------------------------------------

const mockSupabaseFrom = vi.fn()
const mockSupabaseRpc = vi.fn()
const mockGetUser = vi.fn()
const mockLoadWorkflow = vi.fn()
const mockSetWorkflowId = vi.fn()
const mockMarkClean = vi.fn()
const mockSetSaveStatus = vi.fn()
const mockSetLoadedUpdatedAt = vi.fn()
const mockSetLoadedVersion = vi.fn()
// Mirrors zustand's object-patch setState so code under test that rebases
// store state (delta conflict path) observes its own writes on re-read.
const mockStoreSetState = vi.fn((patch: Record<string, unknown>) => {
  Object.assign(storeState, patch)
})
const mockSetRemoteUpdatedAt = vi.fn()
const mockApplySaveSuccess = vi.fn()

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
    loadedUpdatedAt: null,
    loadedVersion: null,
    lastSavedSnapshot: null,
    savedViewport: null,
    remoteUpdatedAt: null,
    dirtyEpoch: 0,
    // Default dirty so the existing save-path tests exercise the network
    // update; the isDirty short-circuit (clean editor → no UPDATE) is covered
    // by its own test below.
    isDirty: true,
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

const mockSyncWorkflowTriggers = vi.fn().mockResolvedValue({ data: { synced: true, created: 1, updated: 0, removed: 0 } })
vi.mock("@/lib/api", () => ({
  getBatchJobStatus: vi.fn().mockResolvedValue([]),
  syncWorkflowTriggers: (...args: unknown[]) => mockSyncWorkflowTriggers(...args),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    rpc: (...args: unknown[]) => mockSupabaseRpc(...args),
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
          setLoadedUpdatedAt: mockSetLoadedUpdatedAt,
          setLoadedVersion: mockSetLoadedVersion,
          setRemoteUpdatedAt: mockSetRemoteUpdatedAt,
          applySaveSuccess: mockApplySaveSuccess,
        }),
      {
        getState: () => ({
          ...storeState,
          loadWorkflow: mockLoadWorkflow,
          setWorkflowId: mockSetWorkflowId,
          markClean: mockMarkClean,
          setSaveStatus: mockSetSaveStatus,
          setLoadedUpdatedAt: mockSetLoadedUpdatedAt,
          setLoadedVersion: mockSetLoadedVersion,
          setRemoteUpdatedAt: mockSetRemoteUpdatedAt,
          applySaveSuccess: mockApplySaveSuccess,
        }),
        setState: (patch: Record<string, unknown>) => mockStoreSetState(patch),
        subscribe: vi.fn(),
        destroy: vi.fn(),
      },
    ),
  }
})

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { useWorkflowPersistence, SAVE_QUEUE_WAIT_MS } from "../use-workflow-persistence"
import { onAccessRecheckRequest } from "../workflow-access-mode"
import { hasSavableChanges } from "../workflow-save-refusal"

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

/**
 * Set up `supabase.from("workflows").update(...).eq("id", ...).select(...)
 * .maybeSingle()` chain for the optimistic-locking save path. When
 * `loadedUpdatedAt` is set on the store, the handler chains a second
 * `.eq("updated_at", ...)` before `.select()` — the mock supports both
 * variants by returning the same `select` from either branch.
 */
function setupSupabaseUpdate(
  error: { message: string } | null = null,
  updatedAt = "2026-01-02T00:00:00Z",
  opts: { reject?: Error } = {},
) {
  const maybeSingle = opts.reject
    ? vi.fn().mockRejectedValue(opts.reject)
    : vi.fn().mockResolvedValue({
        data: error ? null : { updated_at: updatedAt, version: 5 },
        error,
      })
  const select = vi.fn().mockReturnValue({ maybeSingle })
  // The save chains `.abortSignal(AbortSignal.timeout(...))` before select —
  // the hard timeout that keeps a hung request from wedging saveStatus.
  const abortSignal = vi.fn().mockReturnValue({ select })
  const eqUpdatedAt = vi.fn().mockReturnValue({ select, abortSignal })
  const eqId = vi.fn().mockReturnValue({ select, eq: eqUpdatedAt, abortSignal })
  const update = vi.fn().mockReturnValue({ eq: eqId })
  mockSupabaseFrom.mockReturnValue({ update })
  return { update, abortSignal, maybeSingle }
}

/** Set up supabase.from("workflows").insert(...).abortSignal(...).select("id, updated_at").single() chain for insert (new workflow). */
function setupSupabaseInsert(
  data: { id: string; updated_at?: string } | null = {
    id: "new-workflow-id",
    updated_at: "2026-01-02T00:00:00Z",
  },
  error: { message: string } | null = null,
) {
  const single = vi.fn().mockResolvedValue({ data, error })
  const select = vi.fn().mockReturnValue({ single })
  mockSupabaseFrom.mockReturnValue({
    insert: vi.fn().mockReturnValue({
      select,
      abortSignal: vi.fn().mockReturnValue({ select }),
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

  describe("allowEmpty — the Copilot's flush of a canvas someone cleared", () => {
    it("writes the empty graph on a settled load, guarded by the loaded version", async () => {
      resetStoreState({ workflowId: "w1", nodes: [], loadedVersion: 4 })
      const { update } = setupSupabaseUpdate()

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      let saveResult: { success: boolean; error?: string } | undefined
      await act(async () => {
        saveResult = await result.current.save(undefined, { allowEmpty: true })
      })

      expect(saveResult!.success).toBe(true)
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ nodes: [], edges: [] }))
    })

    it("still refuses while a load is in flight — the load blanks the canvas before it fetches", async () => {
      resetStoreState({ workflowId: "w1", nodes: [], loadedVersion: 4, isWorkflowLoading: true })

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      let saveResult: { success: boolean; error?: string } | undefined
      await act(async () => {
        saveResult = await result.current.save(undefined, { allowEmpty: true })
      })

      expect(saveResult!.error).toBe("Empty workflow")
      expect(mockSupabaseFrom).not.toHaveBeenCalled()
    })

    it("still refuses without a loaded version to check the write against", async () => {
      resetStoreState({ workflowId: "w1", nodes: [], loadedVersion: null })

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      let saveResult: { success: boolean; error?: string } | undefined
      await act(async () => {
        saveResult = await result.current.save(undefined, { allowEmpty: true })
      })

      expect(saveResult!.error).toBe("Empty workflow")
      expect(mockSupabaseFrom).not.toHaveBeenCalled()
    })
  })

  it("skips the network update when an existing workflow is already clean (not dirty)", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], isDirty: false })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined

    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(true)
    expect(mockSupabaseFrom).not.toHaveBeenCalled()
  })

  it("writes nothing for a dirty read-only canvas, yet answers success, so nothing may offer that Save", async () => {
    // Dragging a node on a read-only canvas still dirties it, with no refusal
    // to say a save is pointless (a Studio workflow, or a `view` load whose
    // access check failed). The unsaved-changes dialog asks
    // `hasSavableChanges` first, which says no for exactly this canvas.
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], isDirty: true, isReadOnly: true, saveRefusedFor: null })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined

    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(true)
    expect(mockSupabaseFrom).not.toHaveBeenCalled()
    expect(hasSavableChanges(storeState as unknown as Parameters<typeof hasSavableChanges>[0])).toBe(false)
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
    // The update was called which means it resolved correctly — post-save
    // bookkeeping (clean + cursor advance + status flip) is now done
    // atomically by applySaveSuccess so we assert against that instead of
    // the legacy individual markClean call.
    expect(mockApplySaveSuccess).toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // UPDATE path (existing workflowId)
  // -----------------------------------------------------------------------

  it("calls supabase update when workflowId exists", async () => {
    const nodes = [makeNode("n1", { prompt: "a sunset" })]
    const edges = [makeEdge("e1", "n1", "n2")]
    resetStoreState({ workflowId: "existing-wf-id", workflowName: "My Flow", nodes, edges })

    const maybeSingle = vi.fn().mockResolvedValue({ data: { updated_at: "T1" }, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const abortSignal = vi.fn().mockReturnValue({ select })
    const eqId = vi.fn().mockReturnValue({ select, abortSignal })
    const mockUpdate = vi.fn().mockReturnValue({ eq: eqId })
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
    // An ordinary graph never asks the server to project triggers.
    expect(mockSyncWorkflowTriggers).not.toHaveBeenCalled()
  })

  it("after a save that carries a Schedule Trigger node, asks the server to project it onto a real trigger row (#1566)", async () => {
    const nodes = [
      makeNode("n1", { prompt: "a sunset" }),
      { id: "s1", type: "schedule-trigger", position: { x: 0, y: 0 }, data: { label: "Schedule Trigger", interval: "*/5 * * * *", cron: "*/5 * * * *" } },
    ]
    resetStoreState({ workflowId: "existing-wf-id", workflowName: "My Flow", nodes, edges: [] })
    setupSupabaseUpdate()

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      const saveResult = await result.current.save()
      expect(saveResult.success).toBe(true)
    })

    expect(mockSyncWorkflowTriggers).toHaveBeenCalledTimes(1)
    // …vouching for exactly the node this save added.
    expect(mockSyncWorkflowTriggers).toHaveBeenCalledWith("existing-wf-id", ["s1"], [])
  })

  it("a save that REMOVED the Schedule Trigger node still asks the server, so the row goes with it", async () => {
    resetStoreState({
      workflowId: "existing-wf-id",
      workflowName: "My Flow",
      nodes: [makeNode("n1")],
      edges: [],
      lastSavedSnapshot: { nodes: [makeNode("n1"), { id: "s1", type: "schedule-trigger", position: { x: 0, y: 0 }, data: {} }], edges: [] },
    })
    setupSupabaseUpdate()

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      await result.current.save()
    })

    expect(mockSyncWorkflowTriggers).toHaveBeenCalledWith("existing-wf-id", [], [])
  })

  it("add, then remove, through the same hook: both saves sync", async () => {
    const schedule = { id: "s1", type: "schedule-trigger", position: { x: 0, y: 0 }, data: { cron: "*/5 * * * *" } }
    resetStoreState({ workflowId: "existing-wf-id", workflowName: "My Flow", nodes: [makeNode("n1"), schedule], edges: [] })
    setupSupabaseUpdate()
    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      await result.current.save()
    })
    expect(mockSyncWorkflowTriggers).toHaveBeenNthCalledWith(1, "existing-wf-id", ["s1"], [])

    // The node is removed (the store here is reset, so this save starts from no snapshot).
    resetStoreState({ workflowId: "existing-wf-id", workflowName: "My Flow", nodes: [makeNode("n1")], edges: [] })
    setupSupabaseUpdate()
    await act(async () => {
      await result.current.save()
    })
    expect(mockSyncWorkflowTriggers).toHaveBeenCalledTimes(2)
    expect(mockSyncWorkflowTriggers).toHaveBeenNthCalledWith(2, "existing-wf-id", [], [])
  })

  it("serialises overlapping save() calls — the second waits for the first and never sends the stale CAS token", async () => {
    resetStoreState({ workflowId: "wf-1", nodes: [makeNode("n1")], loadedVersion: 60, loadedUpdatedAt: "T60" })

    // Hold the first save's round-trip open until the test releases it.
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const maybeSingle = vi.fn().mockImplementation(async () => {
      await held
      return { data: { updated_at: "T61", version: 61 }, error: null }
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const abortSignal = vi.fn().mockReturnValue({ select })
    const eqVersion = vi.fn().mockReturnValue({ select, abortSignal })
    const eqId = vi.fn().mockReturnValue({ select, eq: eqVersion, abortSignal })
    const update = vi.fn().mockReturnValue({ eq: eqId })
    mockSupabaseFrom.mockReturnValue({ update })
    // A real save success advances the cursor and cleans the store.
    mockApplySaveSuccess.mockImplementationOnce((updatedAt: string, version: number | null) => {
      Object.assign(storeState, { loadedUpdatedAt: updatedAt, loadedVersion: version, isDirty: false })
    })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let outcomes: Array<{ success: boolean; error?: string }> = []
    await act(async () => {
      // Two direct callers a tick apart (a job finishing + the poll-start
      // save). Before serialisation both sent `.eq("version", 60)` and the
      // loser reported "updated on another device" to a lone user.
      const first = result.current.save()
      const second = result.current.save()
      await Promise.resolve()
      release()
      outcomes = await Promise.all([first, second])
    })

    expect(outcomes.map((o) => o.success)).toEqual([true, true])
    // One network write, carrying the token the tab actually held...
    expect(update).toHaveBeenCalledTimes(1)
    expect(eqVersion).toHaveBeenCalledWith("version", 60)
    // ...and no phantom conflict for the caller that waited.
    expect(mockSetSaveStatus).not.toHaveBeenCalledWith("error", expect.anything())
    expect(mockApplySaveSuccess).toHaveBeenCalledTimes(1)
  })

  it("a queued save whose edits the first did NOT cover writes against the advanced token", async () => {
    resetStoreState({ workflowId: "wf-1", nodes: [makeNode("n1")], loadedVersion: 60, loadedUpdatedAt: "T60" })

    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    const maybeSingle = vi.fn().mockImplementation(async () => {
      calls += 1
      if (calls === 1) await held
      return { data: { updated_at: `T${60 + calls}`, version: 60 + calls }, error: null }
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const abortSignal = vi.fn().mockReturnValue({ select })
    const eqVersion = vi.fn().mockReturnValue({ select, abortSignal })
    const eqId = vi.fn().mockReturnValue({ select, eq: eqVersion, abortSignal })
    const update = vi.fn().mockReturnValue({ eq: eqId })
    mockSupabaseFrom.mockReturnValue({ update })
    // The first success advances the token, but the user kept typing while
    // it was in flight: the store is still dirty when the second caller wakes.
    mockApplySaveSuccess.mockImplementationOnce((updatedAt: string, version: number | null) => {
      Object.assign(storeState, { loadedUpdatedAt: updatedAt, loadedVersion: version, isDirty: true })
    })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let outcomes: Array<{ success: boolean; error?: string }> = []
    await act(async () => {
      const first = result.current.save()
      const second = result.current.save()
      await Promise.resolve()
      release()
      outcomes = await Promise.all([first, second])
    })

    expect(outcomes.map((o) => o.success)).toEqual([true, true])
    expect(update).toHaveBeenCalledTimes(2)
    // Second write CAS'd on the token the FIRST write produced — never on 60 twice.
    expect(eqVersion.mock.calls.map((c) => c[1])).toEqual([60, 61])
    expect(mockSetSaveStatus).not.toHaveBeenCalledWith("error", expect.anything())
  })

  it("a wedged in-flight save cannot freeze the queue: after the bound the next caller goes ahead", async () => {
    resetStoreState({ workflowId: "wf-1", nodes: [makeNode("n1")], loadedVersion: 60, loadedUpdatedAt: "T60" })

    let calls = 0
    const maybeSingle = vi.fn().mockImplementation(() => {
      calls += 1
      // The first round-trip never answers (a stall that also slipped past
      // its abort guard); the second is normal.
      return calls === 1
        ? new Promise<never>(() => {})
        : Promise.resolve({ data: { updated_at: "T61", version: 61 }, error: null })
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const abortSignal = vi.fn().mockReturnValue({ select })
    const eqVersion = vi.fn().mockReturnValue({ select, abortSignal })
    const eqId = vi.fn().mockReturnValue({ select, eq: eqVersion, abortSignal })
    const update = vi.fn().mockReturnValue({ eq: eqId })
    mockSupabaseFrom.mockReturnValue({ update })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let second: Promise<{ success: boolean; error?: string }> | undefined
    await act(async () => {
      void result.current.save() // wedged for good
      second = result.current.save()
      await vi.advanceTimersByTimeAsync(SAVE_QUEUE_WAIT_MS + 1)
    })

    await expect(second!).resolves.toEqual(expect.objectContaining({ success: true }))
    expect(update).toHaveBeenCalledTimes(2)
  })

  it("drops a queued save when the editor moved to another workflow while it waited", async () => {
    resetStoreState({ workflowId: "wf-1", nodes: [makeNode("n1")], loadedVersion: 60, loadedUpdatedAt: "T60" })

    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const maybeSingle = vi.fn().mockImplementation(async () => {
      await held
      return { data: { updated_at: "T61", version: 61 }, error: null }
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const abortSignal = vi.fn().mockReturnValue({ select })
    const eqVersion = vi.fn().mockReturnValue({ select, abortSignal })
    const eqId = vi.fn().mockReturnValue({ select, eq: eqVersion, abortSignal })
    const update = vi.fn().mockReturnValue({ eq: eqId })
    mockSupabaseFrom.mockReturnValue({ update })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let outcomes: Array<{ success: boolean; error?: string }> = []
    await act(async () => {
      const first = result.current.save()
      const second = result.current.save()
      storeState.workflowId = "wf-2" // a load() switched workflows meanwhile
      release()
      outcomes = await Promise.all([first, second])
    })

    expect(outcomes[0].success).toBe(true)
    expect(outcomes[1]).toEqual({ success: false, error: "workflow_changed" })
    // The queued attempt never wrote wf-2's graph under wf-1's call.
    expect(update).toHaveBeenCalledTimes(1)
  })

  it("hands applySaveSuccess the dirty epoch it read the graph at (edits made in flight stay dirty)", async () => {
    resetStoreState({ workflowId: "wf-1", nodes: [makeNode("n1")], loadedVersion: 60, dirtyEpoch: 3 })
    setupSupabaseUpdate(null, "T61")

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      await result.current.save()
    })

    expect(mockApplySaveSuccess).toHaveBeenCalledWith("T61", 5, expect.objectContaining({ nodes: expect.any(Array) }), 3)
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
    const mockInsert = vi.fn().mockReturnValue({
      select: mockSelect,
      abortSignal: vi.fn().mockReturnValue({ select: mockSelect }),
    })
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

  it("records a workflow it just created as the caller's own BEFORE its id lands, so the canvas subscribes as an owner's does (T86)", async () => {
    resetStoreState({ workflowId: null, nodes: [makeNode("n1")] })
    setupSupabaseInsert({ id: "brand-new-wf" })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    expect(mockStoreSetState).toHaveBeenCalledWith({ loadedAccess: { workflowId: "brand-new-wf", access: "own" } })
    const recorded = mockStoreSetState.mock.calls.findIndex(([patch]) => "loadedAccess" in patch)
    expect(mockStoreSetState.mock.invocationCallOrder[recorded]!).toBeLessThan(mockSetWorkflowId.mock.invocationCallOrder[0]!)
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

  it("transitions through saving -> applySaveSuccess -> idle on success", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })
    setupSupabaseUpdate()

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    // "saving" is still set via setSaveStatus before the HTTP roundtrip;
    // the post-save "saved" flip now lives inside applySaveSuccess so it
    // batches with the cursor advance — assert against both paths.
    const statusCalls = mockSetSaveStatus.mock.calls.map((c: unknown[]) => c[0])
    expect(statusCalls).toContain("saving")
    expect(mockApplySaveSuccess).toHaveBeenCalledTimes(1)

    // After 2000ms, the fade timer flips status back to "idle".
    // We need the store to report "saved" when getState() is called.
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
  // Optimistic-lock conflict (0-row UPDATE with `loadedUpdatedAt` filter)
  // -----------------------------------------------------------------------

  it("sets remoteUpdatedAt to the DB's current updated_at when the fallback fetch succeeds", async () => {
    resetStoreState({
      workflowId: "w1",
      nodes: [makeNode("n1")],
      loadedUpdatedAt: "2026-01-01T00:00:00Z",
    })

    // Optimistic-lock chain: UPDATE returns 0 rows (data=null, error=null).
    // Then save() issues a fallback SELECT that returns the current value.
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateAbortSignal = vi.fn().mockReturnValue({ select: updateSelect })
    const eqUpdatedAt = vi.fn().mockReturnValue({ select: updateSelect, abortSignal: updateAbortSignal })
    const eqId = vi.fn().mockReturnValue({ eq: eqUpdatedAt, select: updateSelect, abortSignal: updateAbortSignal })
    const mockUpdate = vi.fn().mockReturnValue({ eq: eqId })

    const fallbackMaybeSingle = vi.fn().mockResolvedValue({
      data: { updated_at: "2026-01-02T00:00:00Z" },
      error: null,
    })
    const fallbackEq = vi.fn().mockReturnValue({
      maybeSingle: fallbackMaybeSingle,
      abortSignal: vi.fn().mockReturnValue({ maybeSingle: fallbackMaybeSingle }),
    })
    const fallbackSelect = vi.fn().mockReturnValue({ eq: fallbackEq })

    mockSupabaseFrom.mockReturnValue({
      update: mockUpdate,
      select: fallbackSelect,
    })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(false)
    expect(saveResult!.error).toBe("remote_conflict")
    expect(mockSetRemoteUpdatedAt).toHaveBeenCalledWith("2026-01-02T00:00:00Z")
    // The success-path batch action must NOT be called.
    expect(mockApplySaveSuccess).not.toHaveBeenCalled()
  })

  it("falls back to a sentinel `conflict:<iso>` when the fallback fetch returns no updated_at", async () => {
    resetStoreState({
      workflowId: "w1",
      nodes: [makeNode("n1")],
      loadedUpdatedAt: "2026-01-01T00:00:00Z",
    })

    // UPDATE returns 0 rows AND the fallback SELECT also returns no row
    // (concurrent delete or transient read failure). Without the sentinel
    // the autosave gate would stay null and hot-retry every 3 seconds.
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateAbortSignal = vi.fn().mockReturnValue({ select: updateSelect })
    const eqUpdatedAt = vi.fn().mockReturnValue({ select: updateSelect, abortSignal: updateAbortSignal })
    const eqId = vi.fn().mockReturnValue({ eq: eqUpdatedAt, select: updateSelect, abortSignal: updateAbortSignal })
    const mockUpdate = vi.fn().mockReturnValue({ eq: eqId })

    const fallbackMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const fallbackEq = vi.fn().mockReturnValue({
      maybeSingle: fallbackMaybeSingle,
      abortSignal: vi.fn().mockReturnValue({ maybeSingle: fallbackMaybeSingle }),
    })
    const fallbackSelect = vi.fn().mockReturnValue({ eq: fallbackEq })

    mockSupabaseFrom.mockReturnValue({
      update: mockUpdate,
      select: fallbackSelect,
    })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      await result.current.save()
    })

    // The sentinel is any non-null string that differs from loadedUpdatedAt.
    // We only assert the prefix to keep the test deterministic across clocks.
    const lastCall = mockSetRemoteUpdatedAt.mock.calls.at(-1) as [string | null] | undefined
    expect(lastCall?.[0]).toMatch(/^conflict:/)
  })

  // -----------------------------------------------------------------------
  // A REFUSED write is not a device conflict
  //
  // A platform admin can open anybody's workflow (the SELECT policy lets an
  // admin read every row) and can save none of them from the browser (the
  // UPDATE policy excludes admins on purpose). The refused PATCH matches zero
  // rows exactly like a lost CAS does, and the editor used to report it as
  // "updated on another device" — then, because the re-read `updated_at`
  // equalled the cursor, autosave never paused and re-sent the whole graph
  // every few seconds for as long as the tab stayed open.
  // -----------------------------------------------------------------------

  /** A 0-row UPDATE followed by a re-read that answers `current`. */
  function setupZeroRowSave(
    current: Record<string, unknown> | null,
    opts: { holdUpdate?: Promise<void>; holdReread?: Promise<void> } = {},
  ) {
    const updateMaybeSingle = vi.fn().mockImplementation(async () => {
      if (opts.holdUpdate) await opts.holdUpdate
      return { data: null, error: null }
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateAbortSignal = vi.fn().mockReturnValue({ select: updateSelect })
    const eqToken = vi.fn().mockReturnValue({ select: updateSelect, abortSignal: updateAbortSignal })
    const eqId = vi.fn().mockReturnValue({ eq: eqToken, select: updateSelect, abortSignal: updateAbortSignal })
    const update = vi.fn().mockReturnValue({ eq: eqId })

    const rereadMaybeSingle = vi.fn().mockImplementation(async () => {
      if (opts.holdReread) await opts.holdReread
      return { data: current, error: null }
    })
    const rereadEq = vi.fn().mockReturnValue({
      maybeSingle: rereadMaybeSingle,
      abortSignal: vi.fn().mockReturnValue({ maybeSingle: rereadMaybeSingle }),
    })
    const select = vi.fn().mockReturnValue({ eq: rereadEq })

    mockSupabaseFrom.mockReturnValue({ update, select })
    return { update, rereadMaybeSingle }
  }

  /** Everything the save path can say to the person, in one list. */
  async function everythingSaid(): Promise<string[]> {
    const { toast } = await import("sonner")
    return [
      ...mockSetSaveStatus.mock.calls.map((c) => String(c[1] ?? "")),
      ...vi.mocked(toast.error).mock.calls.flatMap((c) => [
        String(c[0]),
        String((c[1] as { description?: unknown } | undefined)?.description ?? ""),
      ]),
    ]
  }

  it("a 0-row save on a row that did not move is reported as not-writable, never as another device", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
    setupZeroRowSave({ updated_at: "T20", version: 20 })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult).toEqual({ success: false, error: "not_writable" })
    // The refusal is recorded against THIS workflow's id...
    expect(mockStoreSetState).toHaveBeenCalledWith({ saveRefusedFor: "w1" })
    // ...and the canvas is NOT frozen: read-only makes updateNodeData a no-op,
    // which would drop the result of a run that is already in flight.
    expect(mockStoreSetState).not.toHaveBeenCalledWith(expect.objectContaining({ isReadOnly: true }))
    // The status LEAVES "saving". Stuck there, autosave never runs again and
    // realtime skips every newer broadcast as this tab's own echo.
    expect(mockSetSaveStatus).toHaveBeenLastCalledWith("error", expect.any(String))
    // And nothing that was said claims another device wrote.
    expect((await everythingSaid()).some((line) => /another device/i.test(line))).toBe(false)
    // And the divergence marker is left alone — it belongs to real conflicts.
    expect(mockSetRemoteUpdatedAt).not.toHaveBeenCalled()
  })

  it("a refused save is sent ONCE and announced ONCE — later saves never reach the network", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
    const { update } = setupZeroRowSave({ updated_at: "T20", version: 20 })
    const { toast } = await import("sonner")

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    const outcomes: Array<{ success: boolean; error?: string }> = []
    await act(async () => {
      outcomes.push(await result.current.save())
    })
    mockSetSaveStatus.mockClear()
    mockStoreSetState.mockClear()
    await act(async () => {
      // Still dirty (the edit was never stored), so autosave comes back —
      // and so do the pre-Run save and the job-finished save.
      outcomes.push(await result.current.save())
      outcomes.push(await result.current.save())
    })

    // The bail touches nothing. A store write here would wake the autosave
    // subscriber, which would call save() again: the loop, without the network.
    expect(mockSetSaveStatus).not.toHaveBeenCalled()
    expect(mockStoreSetState).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1)
    // A save that kept nothing never calls itself a success.
    expect(outcomes.map((o) => o.error)).toEqual(["not_writable", "not_writable", "not_writable"])
  })

  it("the same holds on the updated_at CAS, for a session that never learned a version", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: null, loadedUpdatedAt: "T1" })
    setupZeroRowSave({ updated_at: "T1" })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.error).toBe("not_writable")
    expect(mockSetRemoteUpdatedAt).not.toHaveBeenCalled()
  })

  it("a version that really moved is still a device conflict", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
    setupZeroRowSave({ updated_at: "T21", version: 21 })
    const { toast } = await import("sonner")

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.error).toBe("remote_conflict")
    expect(mockSetRemoteUpdatedAt).toHaveBeenCalledWith("T21")
    expect(mockSetSaveStatus).toHaveBeenCalledWith("error", "Workflow was updated on another device")
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Workflow was updated on another device",
      expect.objectContaining({ id: "workflow-remote-conflict" }),
    )
    expect(mockStoreSetState).not.toHaveBeenCalledWith(expect.objectContaining({ saveRefusedFor: expect.anything() }))
  })

  it("a refusal recorded for ANOTHER workflow never silences this one's saves", async () => {
    // The state is keyed by id precisely so this cannot happen: a verdict that
    // outlived its workflow must be inert, or the open canvas stops saving
    // with nothing on screen to say so.
    resetStoreState({ workflowId: "w2", saveRefusedFor: "w1", nodes: [makeNode("n1")] })
    setupSupabaseUpdate(null, "2026-03-04T12:00:00Z")

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(true)
    expect(mockApplySaveSuccess).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // A miss that can mean the reader's access changed asks the open canvas to
  // re-check it now, rather than at its next timed re-check (T97). A
  // collaborator removed while the canvas was open can no longer read the row,
  // so their miss reads `unknown`; a write turned away reads `refused`. What
  // the canvas does with the answer is pinned beside the Realtime hook
  // (use-workflow-realtime-sync.test.tsx).
  // -----------------------------------------------------------------------

  describe("which misses ask the canvas to re-check its access (T97)", () => {
    let asked: string[] = []
    let stopHearing: () => void = () => {}

    beforeEach(() => {
      asked = []
      stopHearing = onAccessRecheckRequest((workflowId) => {
        asked.push(workflowId)
      })
    })

    afterEach(() => {
      stopHearing()
    })

    async function saveOnce(): Promise<{ success: boolean; error?: string }> {
      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      let saveResult: { success: boolean; error?: string } | undefined
      await act(async () => {
        saveResult = await result.current.save()
      })
      return saveResult!
    }

    it("a row this tab can no longer read — a removed collaborator's miss — asks, and keeps the conflict handling it had", async () => {
      resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
      setupZeroRowSave(null)

      expect(await saveOnce()).toEqual({ success: false, error: "remote_conflict" })
      expect(asked).toEqual(["w1"])
    })

    it("a write turned away asks", async () => {
      resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
      setupZeroRowSave({ updated_at: "T20", version: 20 })

      expect(await saveOnce()).toEqual({ success: false, error: "not_writable" })
      expect(asked).toEqual(["w1"])
    })

    it("a real conflict — somebody else's write — asks nothing", async () => {
      resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
      setupZeroRowSave({ updated_at: "T21", version: 21 })

      expect(await saveOnce()).toEqual({ success: false, error: "remote_conflict" })
      expect(asked).toEqual([])
    })

    it("a miss that lands after the editor moved to another workflow asks nothing", async () => {
      resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
      let release: () => void = () => {}
      const holdReread = new Promise<void>((resolve) => { release = resolve })
      const { rereadMaybeSingle } = setupZeroRowSave(null, { holdReread })

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      let saveResult: { success: boolean; error?: string } | undefined
      await act(async () => {
        const pending = result.current.save()
        await vi.waitFor(() => expect(rereadMaybeSingle).toHaveBeenCalled())
        Object.assign(storeState, { workflowId: "w2", saveStatus: "idle" })
        release()
        saveResult = await pending
      })

      expect(saveResult).toEqual({ success: false, error: "workflow_changed" })
      expect(asked).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // A save's answer belongs to the workflow it was sent for
  //
  // A large graph takes seconds to upload. If the editor has opened another
  // workflow by the time the answer lands, writing it into the store paints
  // the OLD workflow's verdict over the new one: a miss shows "updated on
  // another device" there and pauses its autosave; a success hands it the
  // wrong CAS token, so its next save false-conflicts.
  // -----------------------------------------------------------------------

  it("drops a late MISS once the editor has moved to another workflow", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
    let release: () => void = () => {}
    const holdUpdate = new Promise<void>((resolve) => { release = resolve })
    setupZeroRowSave({ updated_at: "T20", version: 20 }, { holdUpdate })
    const { toast } = await import("sonner")

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      const pending = result.current.save()
      await Promise.resolve()
      // The person opens another workflow while w1's upload is still out.
      Object.assign(storeState, { workflowId: "w2", saveStatus: "idle" })
      mockSetSaveStatus.mockClear()
      release()
      saveResult = await pending
    })

    expect(saveResult).toEqual({ success: false, error: "workflow_changed" })
    expect(mockSetSaveStatus).not.toHaveBeenCalled()
    expect(mockSetRemoteUpdatedAt).not.toHaveBeenCalled()
    expect(mockStoreSetState).not.toHaveBeenCalled()
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled()
  })

  it("drops a MISS whose RE-READ is what landed late — the second wait is guarded too", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
    let release: () => void = () => {}
    const holdReread = new Promise<void>((resolve) => { release = resolve })
    const { rereadMaybeSingle } = setupZeroRowSave({ updated_at: "T20", version: 20 }, { holdReread })
    const { toast } = await import("sonner")

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      const pending = result.current.save()
      // Let the UPDATE answer (zero rows) and the re-read go out...
      await vi.waitFor(() => expect(rereadMaybeSingle).toHaveBeenCalled())
      // ...and only then does the person open another workflow.
      Object.assign(storeState, { workflowId: "w2", saveStatus: "idle" })
      mockSetSaveStatus.mockClear()
      release()
      saveResult = await pending
    })

    expect(saveResult).toEqual({ success: false, error: "workflow_changed" })
    expect(mockSetSaveStatus).not.toHaveBeenCalled()
    expect(mockStoreSetState).not.toHaveBeenCalled()
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled()
  })

  it("treats a RELOAD of the same workflow as having moved on — the cursor belongs to the new load", async () => {
    resetStoreState({ workflowId: "w1", loadGeneration: 4, nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const maybeSingle = vi.fn().mockImplementation(async () => {
      await held
      return { data: { updated_at: "T21", version: 21 }, error: null }
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const abortSignal = vi.fn().mockReturnValue({ select })
    const eqVersion = vi.fn().mockReturnValue({ select, abortSignal })
    const eqId = vi.fn().mockReturnValue({ select, eq: eqVersion, abortSignal })
    mockSupabaseFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: eqId }) })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      const pending = result.current.save()
      await Promise.resolve()
      // Same id, new load: the toast's Reload button, mid-upload.
      Object.assign(storeState, { loadGeneration: 5, saveStatus: "idle" })
      release()
      saveResult = await pending
    })

    expect(saveResult).toEqual({ success: true })
    expect(mockApplySaveSuccess).not.toHaveBeenCalled()
  })

  it("keeps a late ERROR out of the store as well — the caller still hears it", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const maybeSingle = vi.fn().mockImplementation(async () => {
      await held
      return { data: null, error: { message: "statement timeout" } }
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const abortSignal = vi.fn().mockReturnValue({ select })
    const eqVersion = vi.fn().mockReturnValue({ select, abortSignal })
    const eqId = vi.fn().mockReturnValue({ select, eq: eqVersion, abortSignal })
    mockSupabaseFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: eqId }) })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      const pending = result.current.save()
      await Promise.resolve()
      Object.assign(storeState, { workflowId: "w2", saveStatus: "idle" })
      mockSetSaveStatus.mockClear()
      release()
      saveResult = await pending
    })

    expect(saveResult).toEqual({ success: false, error: "statement timeout" })
    expect(mockSetSaveStatus).not.toHaveBeenCalled()
  })

  it("a MISS that lands after a same-id reload never marks the fresh load refused", async () => {
    resetStoreState({ workflowId: "w1", loadGeneration: 4, nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
    let release: () => void = () => {}
    const holdUpdate = new Promise<void>((resolve) => { release = resolve })
    setupZeroRowSave({ updated_at: "T20", version: 20 }, { holdUpdate })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      const pending = result.current.save()
      await Promise.resolve()
      Object.assign(storeState, { loadGeneration: 5, saveStatus: "idle" })
      release()
      saveResult = await pending
    })

    // The reloaded canvas finds out for itself on its own first save.
    expect(saveResult).toEqual({ success: false, error: "workflow_changed" })
    expect(mockStoreSetState).not.toHaveBeenCalled()
  })

  it("keeps a late SUCCESS out of the store — it must not hand w2 the CAS token of w1", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")], loadedVersion: 20, loadedUpdatedAt: "T20" })
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const maybeSingle = vi.fn().mockImplementation(async () => {
      await held
      return { data: { updated_at: "T21", version: 21 }, error: null }
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const abortSignal = vi.fn().mockReturnValue({ select })
    const eqVersion = vi.fn().mockReturnValue({ select, abortSignal })
    const eqId = vi.fn().mockReturnValue({ select, eq: eqVersion, abortSignal })
    mockSupabaseFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: eqId }) })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      const pending = result.current.save()
      await Promise.resolve()
      Object.assign(storeState, { workflowId: "w2", saveStatus: "idle" })
      release()
      saveResult = await pending
    })

    // The write DID land on w1's row, and the caller is told so...
    expect(saveResult).toEqual({ success: true })
    // ...but w2's cursor, dirty flag and status never hear about it.
    expect(mockApplySaveSuccess).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // applySaveSuccess (batched post-save bookkeeping)
  // -----------------------------------------------------------------------

  it("calls applySaveSuccess once with the returned updated_at after a successful save", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })
    setupSupabaseUpdate(null, "2026-03-04T12:00:00Z")

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    // Batched: markClean + setLoadedUpdatedAt + setRemoteUpdatedAt + status
    // flip happen in one Zustand set() to close the realtime echo race.
    expect(mockApplySaveSuccess).toHaveBeenCalledTimes(1)
    // (the graph this write left on the server; the dirty epoch the graph was read at)
    expect(mockApplySaveSuccess).toHaveBeenCalledWith("2026-03-04T12:00:00Z", 5, expect.objectContaining({ nodes: expect.any(Array) }), 0)
  })

  it("a full save advances the saved snapshot to the graph it wrote — the next save starts from it, not from the last load", async () => {
    resetStoreState({ workflowId: "w1", workflowName: "My Flow", nodes: [makeNode("n1"), makeNode("n2")] })
    setupSupabaseUpdate(null, "2026-03-04T12:00:00Z")
    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      await result.current.save()
    })
    const snapshot = mockApplySaveSuccess.mock.calls[0]![2] as { nodes: Array<{ id: string }>; edges: unknown[]; name: string }
    expect(snapshot.nodes.map((n) => n.id)).toEqual(["n1", "n2"])
    expect(snapshot.edges).toEqual([])
    expect(snapshot.name).toBe("My Flow")
  })

  it("does NOT call applySaveSuccess on save failure", async () => {
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })
    setupSupabaseUpdate({ message: "DB error" })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))

    await act(async () => {
      await result.current.save()
    })

    expect(mockApplySaveSuccess).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // Payload correctness - deep clone and structure
  // -----------------------------------------------------------------------

  it("deep clones nodes and edges so mutations do not affect originals", async () => {
    const originalNode = makeNode("n1", { prompt: "hello" })
    const originalEdge = makeEdge("e1", "n1", "n2")
    resetStoreState({ workflowId: "w1", nodes: [originalNode], edges: [originalEdge] })

    const maybeSingle = vi.fn().mockResolvedValue({ data: { updated_at: "T1" }, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const abortSignal = vi.fn().mockReturnValue({ select })
    const eqId = vi.fn().mockReturnValue({ select, abortSignal })
    const mockUpdate = vi.fn().mockReturnValue({ eq: eqId })
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

    const maybeSingle = vi.fn().mockResolvedValue({ data: { updated_at: "T1" }, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const abortSignal = vi.fn().mockReturnValue({ select })
    const eqId = vi.fn().mockReturnValue({ select, abortSignal })
    const mockUpdate = vi.fn().mockReturnValue({ eq: eqId })
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

  // -----------------------------------------------------------------------
  // Phantom-dirty / wedge fixes (P0)
  // -----------------------------------------------------------------------

  it("strips transient run-state from the save payload but keeps results", async () => {
    const { update } = setupSupabaseUpdate()
    resetStoreState({
      workflowId: "w1",
      nodes: [
        makeNode("n1", {
          executionStatus: "running",
          currentJobId: "job-9",
          currentJobProgress: 42,
          __listTotal: 3,
          generatedResults: [{ url: "https://r2/x.png" }],
          errorMessage: "previous failure",
          prompt: "a cat",
        }),
      ],
    })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      await result.current.save()
    })

    expect(update).toHaveBeenCalledTimes(1)
    const payload = update.mock.calls[0]![0] as { nodes: Array<{ data: Record<string, unknown> }> }
    const savedData = payload.nodes[0]!.data
    expect(savedData.executionStatus).toBeUndefined()
    expect(savedData.currentJobId).toBeUndefined()
    expect(savedData.currentJobProgress).toBeUndefined()
    expect(savedData.__listTotal).toBeUndefined()
    // Results + outcomes persist — users expect them after reload.
    expect(savedData.generatedResults).toEqual([{ url: "https://r2/x.png" }])
    expect(savedData.errorMessage).toBe("previous failure")
    expect(savedData.prompt).toBe("a cat")
  })

  it("attaches an abort signal to the update (hung saves cannot wedge saveStatus)", async () => {
    const { abortSignal } = setupSupabaseUpdate()
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      await result.current.save()
    })

    expect(abortSignal).toHaveBeenCalledTimes(1)
    expect(abortSignal.mock.calls[0]![0]).toBeInstanceOf(AbortSignal)
  })

  it("prefers the integer version CAS when loadedVersion is known", async () => {
    setupSupabaseUpdate()
    resetStoreState({
      workflowId: "w1",
      nodes: [makeNode("n1")],
      loadedUpdatedAt: "2026-01-01T00:00:00Z",
      loadedVersion: 7,
    })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      await result.current.save()
    })

    // The first .eq is ("id", ...); the CAS .eq must be version, not updated_at.
    const update = mockSupabaseFrom.mock.results[0]!.value.update as ReturnType<typeof vi.fn>
    const eqId = update.mock.results[0]!.value.eq as ReturnType<typeof vi.fn>
    expect(eqId).toHaveBeenCalledWith("id", "w1")
    const casEq = eqId.mock.results[0]!.value.eq as ReturnType<typeof vi.fn>
    expect(casEq).toHaveBeenCalledWith("version", 7)
    expect(casEq).not.toHaveBeenCalledWith("updated_at", expect.anything())
  })

  it("falls back to the updated_at lock when loadedVersion is unknown (rollout)", async () => {
    setupSupabaseUpdate()
    resetStoreState({
      workflowId: "w1",
      nodes: [makeNode("n1")],
      loadedUpdatedAt: "2026-01-01T00:00:00Z",
      loadedVersion: null,
    })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      await result.current.save()
    })

    const update = mockSupabaseFrom.mock.results[0]!.value.update as ReturnType<typeof vi.fn>
    const eqId = update.mock.results[0]!.value.eq as ReturnType<typeof vi.fn>
    const casEq = eqId.mock.results[0]!.value.eq as ReturnType<typeof vi.fn>
    expect(casEq).toHaveBeenCalledWith("updated_at", "2026-01-01T00:00:00Z")
    expect(casEq).not.toHaveBeenCalledWith("version", expect.anything())
  })

  // ── delta-save path (P3, VITE_DELTA_SAVES) ──

  function rpcResolves(rows: Array<{ ok: boolean; version: number | null; updated_at: string | null }>) {
    mockSupabaseRpc.mockReturnValueOnce({
      abortSignal: vi.fn().mockResolvedValue({ data: rows, error: null }),
    })
  }

  function deltaState() {
    const unchanged = makeNode("keep")
    const baseEdited = makeNode("edit")
    const snapshot = {
      nodes: [unchanged, baseEdited],
      edges: [],
      name: "Test Workflow",
      characterDefinitions: [],
      flowPromptTemplates: {},
      presentationSettings: { runTarget: "workflow" },
      savedViewport: null,
    }
    const edited = { ...baseEdited, data: { ...baseEdited.data, prompt: "changed" } }
    resetStoreState({
      workflowId: "w1",
      nodes: [unchanged, edited],
      edges: [],
      loadedUpdatedAt: "2026-01-01T00:00:00Z",
      loadedVersion: 41,
      lastSavedSnapshot: snapshot,
      characterDefinitions: snapshot.characterDefinitions,
      flowPromptTemplates: snapshot.flowPromptTemplates,
      presentationSettings: snapshot.presentationSettings,
    })
    return { unchanged, edited, snapshot }
  }

  it("delta: sends ONLY changed nodes via the RPC and advances tokens+snapshot", async () => {
    vi.stubEnv("VITE_DELTA_SAVES", "1")
    try {
      const { edited } = deltaState()
      rpcResolves([{ ok: true, version: 42, updated_at: "2026-06-12T02:00:00Z" }])

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      let saveResult: { success: boolean } | undefined
      await act(async () => {
        saveResult = await result.current.save()
      })

      expect(saveResult!.success).toBe(true)
      expect(mockSupabaseFrom).not.toHaveBeenCalled() // no full UPDATE
      const [fn, args] = mockSupabaseRpc.mock.calls[0]! as [string, Record<string, unknown>]
      expect(fn).toBe("apply_workflow_delta")
      expect(args.p_base_version).toBe(41)
      const sent = args.p_upsert_nodes as Array<{ id: string }>
      expect(sent.map((n) => n.id)).toEqual([edited.id])
      expect(mockApplySaveSuccess).toHaveBeenCalledWith(
        "2026-06-12T02:00:00Z",
        42,
        expect.objectContaining({ name: "Test Workflow" }),
        0,
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("trackers are per workflow: a second workflow whose schedule was already there does not inherit the first one's vouch", async () => {
    // The SAME node id in both workflows is load-bearing: with one shared
    // tracker, B's save would be skipped outright (1 call) — the laundering shape.
    const schedule = { id: "s1", type: "schedule-trigger", position: { x: 0, y: 0 }, data: { cron: "*/5 * * * *" } }
    resetStoreState({ workflowId: "wf-a", workflowName: "A", nodes: [makeNode("n1"), schedule], edges: [] })
    setupSupabaseUpdate()
    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    await act(async () => {
      await result.current.save()
    })
    expect(mockSyncWorkflowTriggers).toHaveBeenNthCalledWith(1, "wf-a", ["s1"], [])

    // The same hook instance now serves workflow B, loaded WITH that schedule:
    // its first save syncs once (a node that never had a row gets one) but
    // vouches for nothing — B did not add it. A shared tracker would have
    // skipped this save outright, carrying A's memory into B.
    resetStoreState({
      workflowId: "wf-b",
      workflowName: "B",
      nodes: [makeNode("n2"), schedule],
      edges: [],
      lastSavedSnapshot: { nodes: [makeNode("n2"), schedule], edges: [] },
    })
    setupSupabaseUpdate()
    await act(async () => {
      await result.current.save()
    })
    expect(mockSyncWorkflowTriggers).toHaveBeenCalledTimes(2)
    expect(mockSyncWorkflowTriggers).toHaveBeenNthCalledWith(2, "wf-b", [], [])
  })

  it("delta: a save that added a Schedule Trigger node asks the server to project it after the RPC landed", async () => {
    vi.stubEnv("VITE_DELTA_SAVES", "1")
    try {
      const { snapshot } = deltaState()
      const schedule = { id: "s1", type: "schedule-trigger", position: { x: 0, y: 0 }, data: { cron: "*/5 * * * *" } }
      // Only the schedule node is new (one of three) — well under the ">50% changed" full-save fallback.
      resetStoreState({
        workflowId: "w1",
        nodes: [...snapshot.nodes, schedule],
        edges: [],
        loadedUpdatedAt: "2026-01-01T00:00:00Z",
        loadedVersion: 41,
        lastSavedSnapshot: snapshot,
        characterDefinitions: snapshot.characterDefinitions,
        flowPromptTemplates: snapshot.flowPromptTemplates,
        presentationSettings: snapshot.presentationSettings,
      })
      rpcResolves([{ ok: true, version: 42, updated_at: "2026-06-12T02:00:00Z" }])

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      await act(async () => {
        await result.current.save()
      })

      expect(mockSupabaseRpc).toHaveBeenCalledTimes(1)
      expect(mockSyncWorkflowTriggers).toHaveBeenCalledTimes(1)
      expect(mockSyncWorkflowTriggers).toHaveBeenCalledWith("w1", ["s1"], [])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("delta: >50% changed falls back to the full save", async () => {
    vi.stubEnv("VITE_DELTA_SAVES", "1")
    try {
      const a = makeNode("a")
      const b = makeNode("b")
      const snapshot = {
        nodes: [a, b], edges: [], name: "Test Workflow",
        characterDefinitions: [], flowPromptTemplates: {},
        presentationSettings: { runTarget: "workflow" }, savedViewport: null,
      }
      resetStoreState({
        workflowId: "w1",
        nodes: [{ ...a, data: { ...a.data, prompt: "x" } }, { ...b, data: { ...b.data, prompt: "y" } }],
        loadedUpdatedAt: "2026-01-01T00:00:00Z",
        loadedVersion: 41,
        lastSavedSnapshot: snapshot,
        characterDefinitions: snapshot.characterDefinitions,
        flowPromptTemplates: snapshot.flowPromptTemplates,
        presentationSettings: snapshot.presentationSettings,
      })
      const { update } = setupSupabaseUpdate()

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      await act(async () => {
        await result.current.save()
      })

      expect(mockSupabaseRpc).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("delta: missing RPC (PGRST202) latches full-save for the session", async () => {
    vi.stubEnv("VITE_DELTA_SAVES", "1")
    try {
      deltaState()
      mockSupabaseRpc.mockReturnValueOnce({
        abortSignal: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "function apply_workflow_delta does not exist" },
        }),
      })
      const { update } = setupSupabaseUpdate()

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      await act(async () => {
        await result.current.save()
      })
      // fell back within the SAME invocation
      expect(update).toHaveBeenCalledTimes(1)

      // second save: rpc not even attempted (latched)
      mockSupabaseRpc.mockClear()
      setupSupabaseUpdate()
      resetStoreState({
        workflowId: "w1", nodes: [makeNode("n1")],
        loadedUpdatedAt: "2026-01-01T00:00:00Z", loadedVersion: 42,
        lastSavedSnapshot: {
          nodes: [], edges: [], name: "Test Workflow",
          characterDefinitions: [], flowPromptTemplates: {},
          presentationSettings: { runTarget: "workflow" }, savedViewport: null,
        },
      })
      await act(async () => {
        await result.current.save()
      })
      expect(mockSupabaseRpc).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("delta: CAS conflict rebases onto fresh remote and retries once", async () => {
    vi.stubEnv("VITE_DELTA_SAVES", "1")
    try {
      const { unchanged, edited } = deltaState()
      // attempt 1: conflict at version 43
      rpcResolves([{ ok: false, version: 43, updated_at: "2026-06-12T02:01:00Z" }])
      // fresh fetch: remote added node "r1", kept ours untouched
      const remoteNew = makeNode("r1")
      const freshMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          nodes: [JSON.parse(JSON.stringify(unchanged)), JSON.parse(JSON.stringify({ ...edited, data: { label: "Test", executionStatus: "idle" } })), remoteNew],
          edges: [], settings: {}, name: "Test Workflow",
          version: 43, updated_at: "2026-06-12T02:01:00Z",
        },
        error: null,
      })
      const freshEq = vi.fn().mockReturnValue({
        maybeSingle: freshMaybeSingle,
        abortSignal: vi.fn().mockReturnValue({ maybeSingle: freshMaybeSingle }),
      })
      mockSupabaseFrom.mockReturnValue({ select: vi.fn().mockReturnValue({ eq: freshEq }) })
      // attempt 2: success at version 44
      rpcResolves([{ ok: true, version: 44, updated_at: "2026-06-12T02:02:00Z" }])

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      let saveResult: { success: boolean } | undefined
      await act(async () => {
        saveResult = await result.current.save()
      })

      expect(saveResult!.success).toBe(true)
      expect(mockSupabaseRpc).toHaveBeenCalledTimes(2)
      // retry CAS'd on the FRESH version
      const retryArgs = mockSupabaseRpc.mock.calls[1]![1] as Record<string, unknown>
      expect(retryArgs.p_base_version).toBe(43)
      // store rebased: merged graph adopted + tokens advanced to fresh
      expect(mockStoreSetState).toHaveBeenCalledWith(
        expect.objectContaining({ loadedVersion: 43 }),
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  // The delta path is the one production actually takes, so the two rules
  // above have to hold on it too.

  /** An RPC whose answer is held until `release()`. */
  function rpcHeld(rows: Array<{ ok: boolean; version: number | null; updated_at: string | null }>) {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    mockSupabaseRpc.mockReturnValueOnce({
      abortSignal: vi.fn().mockImplementation(async () => {
        await held
        return { data: rows, error: null }
      }),
    })
    return () => release()
  }

  it("delta: a caller who may not write falls through to the full path and is told so — never 'another device'", async () => {
    vi.stubEnv("VITE_DELTA_SAVES", "1")
    try {
      deltaState()
      // apply_workflow_delta answers a refused caller exactly like a missing
      // row: ok=false with no version. The full path is what tells them apart.
      rpcResolves([{ ok: false, version: null, updated_at: null }])
      const { update } = setupZeroRowSave({ updated_at: "2026-01-01T00:00:00Z", version: 41 })

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      let saveResult: { success: boolean; error?: string } | undefined
      await act(async () => {
        saveResult = await result.current.save()
      })

      expect(saveResult).toEqual({ success: false, error: "not_writable" })
      expect(update).toHaveBeenCalledTimes(1)
      expect(mockStoreSetState).toHaveBeenCalledWith({ saveRefusedFor: "w1" })
      expect((await everythingSaid()).some((line) => /another device/i.test(line))).toBe(false)

      // And the next save asks nobody — not the RPC either.
      mockSupabaseRpc.mockClear()
      await act(async () => {
        await result.current.save()
      })
      expect(mockSupabaseRpc).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("delta: a late success stays out of the store — no token, no SNAPSHOT of w1 handed to w2", async () => {
    vi.stubEnv("VITE_DELTA_SAVES", "1")
    try {
      deltaState()
      const release = rpcHeld([{ ok: true, version: 42, updated_at: "2026-06-12T02:00:00Z" }])

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      let saveResult: { success: boolean; error?: string } | undefined
      await act(async () => {
        const pending = result.current.save()
        await Promise.resolve()
        Object.assign(storeState, { workflowId: "w2", saveStatus: "idle" })
        release()
        saveResult = await pending
      })

      expect(saveResult).toEqual({ success: true })
      expect(mockApplySaveSuccess).not.toHaveBeenCalled()
      // Moved on is final: no second, full write for a workflow nobody is on.
      expect(mockSupabaseFrom).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("delta: a late REBASE never writes w1's merged graph onto w2's canvas", async () => {
    vi.stubEnv("VITE_DELTA_SAVES", "1")
    try {
      const { unchanged, edited } = deltaState()
      rpcResolves([{ ok: false, version: 43, updated_at: "2026-06-12T02:01:00Z" }])
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => { release = resolve })
      const freshMaybeSingle = vi.fn().mockImplementation(async () => {
        await held
        return {
          data: {
            nodes: [JSON.parse(JSON.stringify(unchanged)), JSON.parse(JSON.stringify(edited)), makeNode("r1")],
            edges: [], settings: {}, name: "Test Workflow",
            version: 43, updated_at: "2026-06-12T02:01:00Z",
          },
          error: null,
        }
      })
      const freshEq = vi.fn().mockReturnValue({
        maybeSingle: freshMaybeSingle,
        abortSignal: vi.fn().mockReturnValue({ maybeSingle: freshMaybeSingle }),
      })
      mockSupabaseFrom.mockReturnValue({ select: vi.fn().mockReturnValue({ eq: freshEq }) })

      const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
      let saveResult: { success: boolean; error?: string } | undefined
      await act(async () => {
        const pending = result.current.save()
        await vi.waitFor(() => expect(freshMaybeSingle).toHaveBeenCalled())
        // w2 is open by the time the fresh copy of w1 arrives.
        Object.assign(storeState, { workflowId: "w2", saveStatus: "idle" })
        release()
        saveResult = await pending
      })

      expect(saveResult).toEqual({ success: false, error: "workflow_changed" })
      // No nodes, no edges, no token written — and no retry against w1.
      expect(mockStoreSetState).not.toHaveBeenCalled()
      expect(mockSupabaseRpc).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("a rejecting save (abort/timeout) flips status to error instead of staying 'saving'", async () => {
    setupSupabaseUpdate(null, "2026-01-02T00:00:00Z", { reject: new Error("AbortError: timeout") })
    resetStoreState({ workflowId: "w1", nodes: [makeNode("n1")] })

    const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
    let saveResult: { success: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveResult!.success).toBe(false)
    expect(mockSetSaveStatus).toHaveBeenCalledWith("error", "AbortError: timeout")
    expect(result.current.saving).toBe(false)
  })
})
