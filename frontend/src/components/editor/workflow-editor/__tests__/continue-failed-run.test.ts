import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * "Continue from failed": the run sent, and the editor's answer to each reply
 * of `/run` (202, already_running, continuation_superseded failed/completed,
 * continuation_preview_pending with one render or several).
 */
const mockToastError = vi.fn()
const mockToastInfo = vi.fn()
const mockToastSuccess = vi.fn()
const mockRunWorkflow = vi.fn()
const mockGetExecution = vi.fn()
const mockMarkNodesStatus = vi.fn()
const mockStream = vi.fn()
const mockAttach = vi.fn()
const mockConfirm = vi.fn()
const mockActiveStream = vi.fn()
const mockSave = vi.fn()
const mockReset = vi.fn()
const mockClearListRows = vi.fn()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
let mockNodes: TestNode[] = []
let mockEdges: Array<{ id: string; source: string; target: string }> = []
let mockDirty = false

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => mockToastError(...a),
    info: (...a: unknown[]) => mockToastInfo(...a),
    success: (...a: unknown[]) => mockToastSuccess(...a),
    warning: vi.fn(),
  },
}))
vi.mock("@/lib/i18n", () => ({ tx: (key: string) => key }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes, edges: mockEdges, isDirty: mockDirty, workflowId: "wf-1", isReadOnly: false,
      markNodesStatus: (...a: unknown[]) => mockMarkNodesStatus(...a),
    }),
  },
}))
class MockAlreadyRunning extends Error {
  constructor(readonly executionId: string) { super("already running") }
}
vi.mock("@/lib/api", () => ({
  getWorkflowExecution: (...a: unknown[]) => mockGetExecution(...a),
  runWorkflow: (...a: unknown[]) => mockRunWorkflow(...a),
  withDedupRaceRetry: <T,>(fn: () => Promise<T>) => fn(),
  WorkflowAlreadyRunningError: MockAlreadyRunning,
}))
vi.mock("../run-handlers", () => ({
  attachToRunningExecution: (...a: unknown[]) => mockAttach(...a),
  checkRunBalance: vi.fn().mockResolvedValue(true),
  clearConnectedListRows: (...a: unknown[]) => mockClearListRows(...a),
  clickLiveness: () => ({ workflowId: "wf-1", alive: () => true }),
  confirmRunOrAbort: (...a: unknown[]) => mockConfirm(...a),
  hasActiveWorkflowStream: () => mockActiveStream(),
  refuseWhileReadOnly: () => false,
  resetNodeAccumulation: (...a: unknown[]) => mockReset(...a),
  streamBackendExecution: (...a: unknown[]) => mockStream(...a),
}))
vi.mock("../execution-graph", () => ({ collapseExpandedClones: () => ({ nodes: mockNodes, edges: mockEdges }) }))
vi.mock("../execute-node", () => ({ rejectAllManualEdits: vi.fn() }))
vi.mock("../video-link-run-gate", () => ({ ensureVideoLinksBeforeRun: vi.fn().mockResolvedValue(true) }))
vi.mock("../run-from-here-set", () => ({ liveExecutable: (nodes: TestNode[]) => nodes.filter((x) => x.type !== "text") }))
vi.mock("../preview-gate", () => ({ previewRunnable: (exec: TestNode[]) => exec }))

const { handleContinueFailedRun, expectedFromFailed, listsRefilledBy } = await import("../continue-failed-run")
const { ContinuationPreviewPendingError, ContinuationRefusedError, ContinuationSupersededError } = await import("@/lib/run-workflow-errors")

const n = (id: string, type: string, data: Record<string, unknown> = {}): TestNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const NODES = [n("prompt", "text"), n("img", "generate-image"), n("vid", "image-to-video"), n("cut", "apply-edl", { label: "Render" })]
const FAILED = { id: "exec-1", workflowId: "wf-1", status: "failed", nodeStates: { img: { status: "completed" }, vid: { status: "failed" } } }

function deps(extra: Record<string, unknown> = {}) {
  return {
    ctx: { askConfirm: vi.fn().mockResolvedValue(true) } as never,
    projectId: "p1",
    save: mockSave,
    setIsRunning: vi.fn(),
    onExecutionStarted: vi.fn(),
    onExecutionEnded: vi.fn(),
    renderFinal: vi.fn().mockResolvedValue(undefined),
    ...extra,
  }
}

/** The action of the last toast an `info` call put up. */
const lastInfoAction = () => (mockToastInfo.mock.calls.at(-1)?.[1] as { action?: { label: string; onClick: () => void } } | undefined)?.action

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = NODES
  mockEdges = []
  mockDirty = false
  mockActiveStream.mockReturnValue(false)
  mockConfirm.mockResolvedValue(true)
  mockGetExecution.mockResolvedValue(FAILED)
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-2", status: "pending", continuedFrom: "exec-1" })
  mockSave.mockResolvedValue({ success: true })
})

/** The ids of the nodes each data-clearing call touched. */
const resetIds = () => mockReset.mock.calls.flatMap((c) => (c[0] as TestNode[]).map((x) => x.id))
/** Nothing on the canvas was cleared: no list results reset, no connected List rows emptied. */
const expectNodeDataUntouched = () => {
  expect(mockReset).not.toHaveBeenCalled()
  expect(mockClearListRows).not.toHaveBeenCalled()
}

describe("expectedFromFailed", () => {
  const ids = (nodes: TestNode[]) => nodes.map((x) => x.id)
  it("with no scope (a run of every node): every executable node the failed run did not complete", () => {
    expect(ids(expectedFromFailed(NODES as never, [], { scope: null, states: FAILED.nodeStates }) as never)).toEqual(["vid", "cut"])
  })

  it("with a scope: of those nodes plus what the run left failed or held back — never a node added since outside them", () => {
    // Run from here on [vid, cut] failed at cut; m was added after it, downstream of cut.
    const nodes = [...NODES, n("m", "add-captions")]
    const edges = [{ id: "e", source: "cut", target: "m" }]
    const states = { img: { status: "completed" }, vid: { status: "completed" }, cut: { status: "failed" } }
    expect(ids(expectedFromFailed(nodes as never, edges as never, { scope: ["vid", "cut"], states }) as never)).toEqual(["cut"])
    // A failure outside the scope is retried; a node a router skipped is not.
    const wider = { ...states, m: { status: "failed" }, x: { status: "skipped" } }
    expect(ids(expectedFromFailed([...nodes, n("x", "add-captions")] as never, edges as never, { scope: ["vid", "cut"], states: wider }) as never)).toEqual(["cut", "m"])
  })

  it("closes over what the considered nodes need upstream that the run did not complete", () => {
    const edges = [{ id: "e1", source: "img", target: "vid" }, { id: "e2", source: "vid", target: "cut" }]
    const states = { img: { status: "failed" } }
    // Scope [cut] alone: cut runs, and so do vid and img above it (neither completed).
    expect(ids(expectedFromFailed(NODES as never, edges as never, { scope: ["cut"], states }) as never)).toEqual(["img", "vid", "cut"])
  })

  it("built on a newer continuation: what either run left unfinished counts, read against what the newer one completed", () => {
    const states = { img: { status: "completed" }, vid: { status: "failed" }, cut: { status: "completed" } }
    // The newer one ran only cut and handed vid on, marked as unfinished.
    const base = { img: { status: "completed" }, vid: { status: "skipped", carriedUnfinished: true }, cut: { status: "completed" } }
    expect(ids(expectedFromFailed(NODES as never, [], { scope: ["cut"], states }, base) as never)).toEqual(["vid"])
    // Unmarked (a router skipped it there), the run asked for still left it failed.
    expect(ids(expectedFromFailed(NODES as never, [], { scope: ["cut"], states }, { ...base, vid: { status: "skipped" } }) as never)).toEqual(["vid"])
  })
})

describe("Continue from failed", () => {
  it("continues the failed run from where it stopped, and follows the run (202)", async () => {
    const d = deps()
    await handleContinueFailedRun("exec-1", d)
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    const [workflowId, nodeIds, key, opts] = mockRunWorkflow.mock.calls[0]!
    expect(workflowId).toBe("wf-1")
    expect(nodeIds).toBeUndefined() // the server considers every node
    expect(typeof key).toBe("string")
    expect(opts).toEqual({ continueFromExecutionId: "exec-1", continueMode: "from-failed" })
    // Priced and marked on what it is expected to run: what the failed run did not complete.
    expect((mockConfirm.mock.calls[0]![1] as TestNode[]).map((x) => x.id)).toEqual(["vid", "cut"])
    expect(mockMarkNodesStatus).toHaveBeenCalledWith(["vid", "cut"], "pending")
    expect(d.onExecutionStarted).toHaveBeenCalledWith("exec-2")
    expect(mockStream).toHaveBeenCalledWith("exec-2", d.ctx, d.setIsRunning, d.onExecutionEnded)
    // Cleared once started, and only on what it runs; before the run is followed.
    expect(resetIds()).toEqual(["vid", "cut"])
    expect(mockReset.mock.invocationCallOrder[0]!).toBeGreaterThan(mockRunWorkflow.mock.invocationCallOrder[0]!)
    expect(mockReset.mock.invocationCallOrder[0]!).toBeLessThan(mockStream.mock.invocationCallOrder[0]!)
  })

  it("always asks, naming what runs and what is kept, whatever the figure", async () => {
    await handleContinueFailedRun("exec-1", deps())
    const [, exec, , , trigger, alwaysConfirm, , , opts] = mockConfirm.mock.calls[0]!
    expect(trigger).toBe("continue-failed")
    expect(alwaysConfirm).toBe(true)
    expect((exec as TestNode[]).map((x) => x.id)).toEqual(["vid", "cut"])
    expect((opts as { keptIds: string[] }).keptIds).toEqual(["img"])
  })

  it("built on a newer continuation: what that one completed keeps its data and loses its mark", async () => {
    mockRunWorkflow.mockResolvedValue({ executionId: "exec-2", continuedFrom: "exec-newer" })
    mockGetExecution.mockImplementation(async (id: string) =>
      id === "exec-newer"
        ? { id, workflowId: "wf-1", status: "failed", nodeStates: { img: { status: "completed" }, vid: { status: "completed" }, cut: { status: "failed" } } }
        : FAILED,
    )
    const d = deps()
    await handleContinueFailedRun("exec-1", d)
    expect(mockGetExecution).toHaveBeenLastCalledWith("exec-newer")
    // The run is the editor's own at once, before the newer run is read.
    expect(vi.mocked(d.onExecutionStarted).mock.invocationCallOrder[0]!).toBeLessThan(mockGetExecution.mock.invocationCallOrder.at(-1)!)
    expect(resetIds()).toEqual(["cut"])
    expect(mockMarkNodesStatus).toHaveBeenCalledWith(["vid"], undefined)
    expect(mockStream).toHaveBeenCalled()
  })

  it("built on a newer continuation that cannot be read: nothing is cleared", async () => {
    mockRunWorkflow.mockResolvedValue({ executionId: "exec-2", continuedFrom: "exec-newer" })
    mockGetExecution.mockImplementation(async (id: string) => {
      if (id === "exec-newer") throw new Error("offline")
      return FAILED
    })
    await handleContinueFailedRun("exec-1", deps())
    expect(resetIds()).toEqual([])
    expect(mockStream).toHaveBeenCalled()
  })

  it("a refused save continues nothing and leaves the canvas as it was", async () => {
    mockDirty = true
    mockSave.mockResolvedValue({ success: false })
    await handleContinueFailedRun("exec-1", deps())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith("continueFailed.saveFailed")
    expect(mockMarkNodesStatus).toHaveBeenLastCalledWith(["vid", "cut"], undefined)
    expectNodeDataUntouched()
  })

  it("two quick clicks read the run once: the lock is taken before the read", async () => {
    let release!: () => void
    mockGetExecution.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(FAILED) }))
    const first = handleContinueFailedRun("exec-1", deps())
    await handleContinueFailedRun("exec-1", deps())
    release()
    await first
    expect(mockGetExecution).toHaveBeenCalledTimes(1)
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })

  it("saves a dirty canvas first: the server runs the saved workflow", async () => {
    mockDirty = true
    await handleContinueFailedRun("exec-1", deps())
    expect(mockSave).toHaveBeenCalledWith("p1")
    expect(mockSave.mock.invocationCallOrder[0]!).toBeLessThan(mockRunWorkflow.mock.invocationCallOrder[0]!)
  })

  it("a declined confirm starts nothing", async () => {
    mockConfirm.mockResolvedValue(false)
    await handleContinueFailedRun("exec-1", deps())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
  })

  it("while a run is followed, nothing starts", async () => {
    mockActiveStream.mockReturnValue(true)
    await handleContinueFailedRun("exec-1", deps())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith("run.alreadyRunning")
  })

  it("a run of another workflow (a toast left from before a switch) does nothing", async () => {
    mockGetExecution.mockResolvedValue({ ...FAILED, workflowId: "wf-other" })
    await handleContinueFailedRun("exec-1", deps())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("already_running: the run already going is followed", async () => {
    mockRunWorkflow.mockRejectedValue(new MockAlreadyRunning("exec-live"))
    const d = deps()
    await handleContinueFailedRun("exec-1", d)
    expect(d.onExecutionStarted).toHaveBeenCalledWith("exec-live")
    expect(mockAttach).toHaveBeenCalledWith("exec-live", d.ctx, d.setIsRunning, d.onExecutionEnded, expect.any(Function))
    expectNodeDataUntouched()
  })

  it("superseded by a newer continuation that failed: offers to continue THAT one", async () => {
    mockRunWorkflow.mockRejectedValueOnce(new ContinuationSupersededError("continue that one", { executionId: "exec-3", status: "failed" }))
    await handleContinueFailedRun("exec-1", deps())
    expect(mockMarkNodesStatus).toHaveBeenLastCalledWith(["vid", "cut"], undefined) // rolled back
    expectNodeDataUntouched()
    expect(mockToastInfo).toHaveBeenCalledWith("continueFailed.supersededFailed", expect.objectContaining({ action: expect.any(Object) }))
    mockGetExecution.mockResolvedValue({ ...FAILED, id: "exec-3" })
    mockRunWorkflow.mockResolvedValue({ executionId: "exec-5", continuedFrom: "exec-3" })
    lastInfoAction()!.onClick()
    await vi.waitFor(() => expect(mockRunWorkflow).toHaveBeenCalledTimes(2))
    expect(mockGetExecution).toHaveBeenLastCalledWith("exec-3")
    expect(mockRunWorkflow.mock.calls[1]![3]).toEqual({ continueFromExecutionId: "exec-3", continueMode: "from-failed" })
  })

  it("superseded by a newer continuation that completed: the work is done, nothing more runs", async () => {
    mockRunWorkflow.mockRejectedValue(new ContinuationSupersededError("done", { executionId: "exec-3", status: "completed" }))
    const d = deps()
    await handleContinueFailedRun("exec-1", d)
    expect(mockToastSuccess).toHaveBeenCalledWith("continueFailed.alreadyDone")
    expect(mockMarkNodesStatus).toHaveBeenLastCalledWith(["vid", "cut"], undefined)
    expect(d.renderFinal).not.toHaveBeenCalled()
    expect(mockStream).not.toHaveBeenCalled()
    expectNodeDataUntouched()
  })

  it("held at one render's Preview: the editor's Render final of it, continuing the run that holds it", async () => {
    mockRunWorkflow.mockRejectedValue(new ContinuationPreviewPendingError("final first", "exec-4", ["cut"], [], null))
    const d = deps()
    await handleContinueFailedRun("exec-1", d)
    expect(mockToastInfo).toHaveBeenCalledWith("continueFailed.previewPendingRender")
    expect(d.renderFinal).toHaveBeenCalledWith("cut", "exec-4")
    expectNodeDataUntouched()
  })

  it("held at several Previews: the toast offers the one run the server named, which finishes them", async () => {
    const next = { continueFromExecutionId: "exec-4", nodeIds: ["cut", "vid"], inputOverrides: { cut: { quality: "final" } } }
    mockRunWorkflow.mockRejectedValueOnce(new ContinuationPreviewPendingError("finish them", "exec-4", ["cut", "vid"], [], next))
    const d = deps()
    await handleContinueFailedRun("exec-1", d)
    expect(d.renderFinal).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith("continueFailed.previewPendingMany", expect.objectContaining({ action: expect.any(Object) }))
    expectNodeDataUntouched()
    mockRunWorkflow.mockResolvedValue({ executionId: "exec-5" })
    lastInfoAction()!.onClick()
    await vi.waitFor(() => expect(mockRunWorkflow).toHaveBeenCalledTimes(2))
    const [, nodeIds, , opts] = mockRunWorkflow.mock.calls[1]!
    expect(nodeIds).toEqual(["cut", "vid"])
    expect(opts).toEqual({ inputOverrides: { cut: { quality: "final" } }, continueFromExecutionId: "exec-4" })
    // Finish review is asked the same way, under its own words.
    expect(mockConfirm.mock.calls.at(-1)![4]).toBe("finish-review")
    expect(mockConfirm.mock.calls.at(-1)![5]).toBe(true)
    await vi.waitFor(() => expect(mockStream).toHaveBeenCalledWith("exec-5", d.ctx, d.setIsRunning, d.onExecutionEnded))
  })

  it("held with no run the server could name: says what holds it, with nothing to click", async () => {
    mockRunWorkflow.mockRejectedValue(new ContinuationPreviewPendingError("finish them", "exec-4", ["cut"], ["vid"], null))
    await handleContinueFailedRun("exec-1", deps())
    const [, opts] = mockToastInfo.mock.calls.at(-1)!
    expect(mockToastInfo.mock.calls.at(-1)![0]).toBe("continueFailed.previewPendingMany")
    expect((opts as { action?: unknown }).action).toBeUndefined()
    expectNodeDataUntouched()
  })

  it("nothing left to run (continuation_subset_required) is said as done, not as an error", async () => {
    mockRunWorkflow.mockRejectedValue(new ContinuationRefusedError("Every node completed", "continuation_subset_required"))
    await handleContinueFailedRun("exec-1", deps())
    expect(mockToastSuccess).toHaveBeenCalledWith("continueFailed.nothingLeft")
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).toHaveBeenLastCalledWith(["vid", "cut"], undefined)
    expectNodeDataUntouched()
  })

  it("any other refusal is said, and the marks go back", async () => {
    mockRunWorkflow.mockRejectedValue(new ContinuationRefusedError("Not found", "continuation_not_found"))
    await handleContinueFailedRun("exec-1", deps())
    expect(mockToastError).toHaveBeenCalledWith("run.failedToStartExecution", { description: "Not found" })
    expect(mockMarkNodesStatus).toHaveBeenLastCalledWith(["vid", "cut"], undefined)
    expectNodeDataUntouched()
  })
})

describe("Continue from failed of a run started on named nodes (nodeScope)", () => {
  // Run from here on [vid, cut] failed at cut; m was added since, downstream of
  // cut, and a List is fed by m. The server runs only cut.
  const list = n("rows", "list", { columns: [{ id: "c0", handleId: "h0", connectedSourceId: "m" }], rows: [["x"]] })
  beforeEach(() => {
    mockNodes = [...NODES, n("m", "add-captions"), list]
    mockEdges = [{ id: "e", source: "cut", target: "m" }]
    mockGetExecution.mockResolvedValue({
      ...FAILED,
      nodeScope: ["vid", "cut"],
      nodeStates: { img: { status: "completed" }, vid: { status: "completed" }, cut: { status: "failed" } },
    })
  })

  it("prices, marks and clears only what the server runs: m and the List it feeds are left alone", async () => {
    await handleContinueFailedRun("exec-1", deps())
    expect((mockConfirm.mock.calls[0]![1] as TestNode[]).map((x) => x.id)).toEqual(["cut"])
    expect(mockMarkNodesStatus).toHaveBeenCalledWith(["cut"], "pending")
    expect(resetIds()).toEqual(["cut"])
    // No List is cleared: nothing the run executes feeds one.
    expect(mockClearListRows).toHaveBeenCalledWith([])
  })

  it("an older server that sends no nodeScope: every node, as it then ran", async () => {
    mockGetExecution.mockResolvedValue({ ...FAILED, nodeStates: { img: { status: "completed" }, vid: { status: "completed" }, cut: { status: "failed" } } })
    await handleContinueFailedRun("exec-1", deps())
    expect((mockConfirm.mock.calls[0]![1] as TestNode[]).map((x) => x.id)).toEqual(expect.arrayContaining(["cut", "m"]))
    expect((mockClearListRows.mock.calls[0]![0] as TestNode[]).map((x) => x.id)).toEqual(["rows"])
  })

  it("built on a newer continuation: the run asked for's failures still count against what that one completed", async () => {
    mockRunWorkflow.mockResolvedValue({ executionId: "exec-2", continuedFrom: "exec-newer" })
    mockGetExecution.mockImplementation(async (id: string) =>
      id === "exec-newer"
        ? { id, workflowId: "wf-1", status: "completed", nodeStates: { img: { status: "completed" }, vid: { status: "completed" }, cut: { status: "skipped", carriedUnfinished: true } } }
        : { ...FAILED, nodeScope: ["vid", "cut"], nodeStates: { img: { status: "completed" }, vid: { status: "completed" }, cut: { status: "failed" } } },
    )
    await handleContinueFailedRun("exec-1", deps())
    expect(resetIds()).toEqual(["cut"])
    expect(mockClearListRows).toHaveBeenCalledWith([])
  })
})

describe("listsRefilledBy", () => {
  const list = (id: string, sources: string[]) => n(id, "list", { columns: sources.map((s, i) => ({ id: `c${i}`, handleId: `h${i}`, connectedSourceId: s })), rows: [["x"]] })
  it("only a List every connected column of which is fed by a node the run runs", () => {
    const nodes = [list("all-run", ["vid"]), list("mixed", ["vid", "img"]), list("kept", ["img"]), n("plain", "list", { columns: [{ id: "c", handleId: "h" }] })]
    expect(listsRefilledBy(nodes as never, new Set(["vid", "cut"])).map((x) => x.id)).toEqual(["all-run"])
  })
})
