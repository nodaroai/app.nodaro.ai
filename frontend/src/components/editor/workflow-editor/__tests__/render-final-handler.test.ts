import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Render final and Update preview (A6.1, TA17–TA19, decided 2026-10-04): one
 * run of the review's render set with the render's quality overridden for that
 * run, after the prechecks and a save that must succeed.
 */
const mockToastError = vi.fn()
const mockToastInfo = vi.fn()
const mockRunWorkflow = vi.fn()
const mockMarkNodesStatus = vi.fn()
const mockCollapseExpandedClones = vi.fn()
const mockEstimateRunCredits = vi.fn()
const mockEstimateRunCreditLines = vi.fn()
const mockFetchQuery = vi.fn()
const mockRule = vi.fn()
const mockNewerPatches = vi.fn()
const mockUnchanged = vi.fn()
const mockListExecutions = vi.fn()
const mockUpdateNodeData = vi.fn()
const mockGate = vi.fn()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []
let mockDirty = false

vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: (...a: unknown[]) => mockToastInfo(...a), warning: vi.fn() },
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes, edges: mockEdges,
      updateNodeData: (...a: unknown[]) => mockUpdateNodeData(...a),
      markNodesStatus: (...a: unknown[]) => mockMarkNodesStatus(...a),
      isDirty: mockDirty, workflowId: "wf-1", isReadOnly: false,
    }),
  },
}))
class MockAlreadyRunning extends Error { executionId = "exec-live" }
vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getJobStatus: vi.fn(),
  getUserCredits: vi.fn(),
  runWorkflow: (...a: unknown[]) => mockRunWorkflow(...a),
  getWorkflowExecution: vi.fn().mockResolvedValue({ triggerType: "manual", nodeStates: {} }),
  listWorkflowExecutions: (...a: unknown[]) => mockListExecutions(...a),
  streamWorkflowExecution: vi.fn(() => new Promise(() => {})),
  withDedupRaceRetry: <T,>(fn: () => Promise<T>) => fn(),
  WorkflowAlreadyRunningError: MockAlreadyRunning,
}))
vi.mock("@/hooks/use-workflow-persistence", () => ({
  TERMINAL_RESTORABLE_STATUSES: "completed,failed",
  restoreEndedEditorRun: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }) }))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/query-client", () => ({
  queryClient: { fetchQuery: (...a: unknown[]) => mockFetchQuery(...a), getQueryData: () => undefined },
}))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
vi.mock("../estimate-run-credits", () => ({
  estimateRunCredits: (...a: unknown[]) => mockEstimateRunCredits(...a),
  estimateRunCreditLines: (...a: unknown[]) => mockEstimateRunCreditLines(...a),
  sumRunCreditLines: (lines: readonly { credits: number }[]) => lines.reduce((s, l) => s + l.credits, 0),
  runNodeLabel: (n: { type?: string; data?: { label?: unknown } }) => (typeof n.data?.label === "string" ? n.data.label : n.type ?? ""),
}))
vi.mock("../types", () => ({
  WorkflowStaleError: class extends Error {},
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: () => {},
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: (n: { type?: string }) => n.type !== "upload-video",
  SERVER_RUN_ONLY_TYPES: new Set<string>(),
  getFanOutMultiplier: () => 1,
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn(() => []),
  getEffectivelySkippedIds: vi.fn(() => new Set()),
  collapseExpandedClones: (...a: unknown[]) => mockCollapseExpandedClones(...a),
}))
vi.mock("../node-input-resolver", () => ({ getListInputForNode: () => null, getListFanOutForNode: () => undefined }))
vi.mock("../execute-node", () => ({ executeNode: vi.fn(), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
vi.mock("../sub-workflow-preflight", () => ({ nestedRunPreflight: vi.fn().mockResolvedValue(null) }))
vi.mock("../video-link-run-gate", () => ({ ensureVideoLinksBeforeRun: (...a: unknown[]) => mockGate(...a) }))
vi.mock("../render-final-checks", () => ({
  renderRuleVerdict: (...a: unknown[]) => mockRule(...a),
  newerRunPatches: (...a: unknown[]) => mockNewerPatches(...a),
  finalIsUnchanged: (...a: unknown[]) => mockUnchanged(...a),
}))

const { handleRenderFinal } = await import("../render-final-handler")
const { detachActiveWorkflowStream, RUN_CONFIRM_CREDITS } = await import("../run-handlers")

afterEach(() => {
  detachActiveWorkflowStream()
  delete window.__NODARO_RUNTIME__
})

const n = (id: string, type: string, data: Record<string, unknown> = {}): TestNode => ({
  id, type, position: { x: 0, y: 0 }, data: { label: id, ...data },
})
const PLAN = n("plan", "edit-plan")
// The node is saved at Preview: the toolbar Run previews, Render final overrides.
const CUT = n("cut", "apply-edl", { quality: "proxy" })
const CAP = n("cap", "add-captions")
const EDGES = [
  { id: "a", source: "plan", target: "cut", targetHandle: "edl" },
  { id: "b", source: "cut", target: "cap" },
]

function makeCtx(extra: Record<string, unknown> = {}) {
  return {
    userId: "u1", projectId: "p1",
    trackInterval: (i: unknown) => i, untrackInterval: vi.fn(),
    save: vi.fn(), setIsRunning: vi.fn(),
    isWorkflowStale: () => false, isStorageError: () => false,
    setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(), setInsufficientCreditsData: vi.fn(),
    ...extra,
  }
}
const run = (kind: "final" | "proxy", ctx = makeCtx(), save = vi.fn().mockResolvedValue({ success: true })) =>
  handleRenderFinal("cut", kind, ctx as never, "p1", save, vi.fn())

beforeEach(() => {
  vi.clearAllMocks()
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
  mockDirty = false
  mockNodes = [PLAN, CUT, CAP]
  mockEdges = EDGES
  mockCollapseExpandedClones.mockImplementation(() => ({ nodes: mockNodes, edges: mockEdges }))
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
  mockFetchQuery.mockResolvedValue({ total: 100_000, tier: "pro" })
  mockEstimateRunCredits.mockReturnValue(480)
  // One line per node that runs: like the real estimate, a render at Preview
  // leaves the node after it out (the stop rule).
  mockEstimateRunCreditLines.mockImplementation((exec: TestNode[], all: TestNode[]) => {
    const proxy = all.find((x) => x.id === "cut")?.data.quality === "proxy"
    return exec
      .filter((x) => !(proxy && x.id === "cap"))
      .map((x) => ({ nodeId: x.id, label: x.data.label, quantity: { fanOut: 1, units: 1, unitKind: null }, credits: 240 }))
  })
  mockRule.mockReturnValue({ ok: true })
  mockNewerPatches.mockReturnValue({})
  mockUnchanged.mockResolvedValue(false)
  mockListExecutions.mockResolvedValue({ data: [] })
  mockGate.mockResolvedValue(true)
})

describe("Render final", () => {
  it("runs the render and its tail with a one-shot final override, and never the plan", async () => {
    await run("final")
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    const [workflowId, nodeIds, , opts] = mockRunWorkflow.mock.calls[0]!
    expect(workflowId).toBe("wf-1")
    expect([...nodeIds].sort()).toEqual(["cap", "cut"])
    expect(opts).toEqual({ inputOverrides: { cut: { quality: "final" } } })
    const pending = mockMarkNodesStatus.mock.calls.find(([, status]) => status === "pending")
    expect([...pending![0]].sort()).toEqual(["cap", "cut"]) // the tail runs: the render reads Final
  })

  it("the confirm prices the FINAL: it is built from the overridden graph, not the canvas", async () => {
    const confirmRun = vi.fn().mockResolvedValue(true)
    await run("final", makeCtx({ confirmRun }))
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "render-final", alwaysConfirm: true, nodeCount: 2 }))
    const [executable, allNodes] = mockEstimateRunCreditLines.mock.calls[0]!
    const cut = (allNodes as TestNode[]).find((x) => x.id === "cut")!
    expect(cut.data.quality).toBe("final")
    expect((executable as TestNode[]).find((x) => x.id === "cut")!.data.quality).toBe("final")
    // …and the canvas itself still reads Preview.
    expect(CUT.data.quality).toBe("proxy")
  })

  // U1 (R16 a, decided 2026-10-06): the confirm itemises the run per node.
  it("the confirm lists each node's price, totals those same lines, and names what is kept as is", async () => {
    const REC = n("rec", "upload-video", { label: "Recording" })
    const TR = n("tr", "transcribe", { label: "Transcribe" })
    mockNodes = [REC, TR, PLAN, CUT, CAP]
    mockEdges = [{ id: "r", source: "rec", target: "tr" }, { id: "t", source: "tr", target: "plan" }, { id: "s", source: "rec", target: "cut", targetHandle: "sources" }, ...EDGES]
    const confirmRun = vi.fn().mockResolvedValue(true)
    await run("final", makeCtx({ confirmRun }))
    const info = confirmRun.mock.calls[0]![0]
    expect(info.lines.map((l: { nodeId: string }) => l.nodeId)).toEqual(["cut", "cap"])
    expect(info.lines[0].renderQuality).toBe("final")
    expect(info.estimatedCredits).toBe(480) // the sum of the lines
    expect(info.kept).toEqual(["Transcribe", "plan"]) // the upload is not executable: not listed
    expect(info.gated).toEqual([])
    expect(info.waits).toEqual([])
  })

  // Round 2 (decided 2026-10-06): another render still set to Preview after this
  // one stops the run there; the confirm names the nodes it holds back.
  it("with a second Preview render after this one, the confirm names what waits for its own Render final", async () => {
    const CUT2 = n("cut2", "apply-edl", { label: "Render Clips", quality: "proxy" })
    const PACK = n("pack", "edit-plan", { label: "Clip Pack" })
    mockNodes = [PLAN, CUT, CAP, CUT2, PACK]
    mockEdges = [...EDGES, { id: "c", source: "cap", target: "cut2", targetHandle: "sources" }, { id: "d", source: "cut2", target: "pack" }]
    // Like the real estimate: a render at Preview leaves what it feeds out.
    mockEstimateRunCreditLines.mockImplementation((exec: TestNode[]) =>
      exec.filter((x) => x.id !== "pack").map((x) => ({ nodeId: x.id, label: x.data.label, quantity: { fanOut: 1, units: 1, unitKind: null }, credits: 100 })))
    const confirmRun = vi.fn().mockResolvedValue(true)
    await run("final", makeCtx({ confirmRun }))
    const info = confirmRun.mock.calls[0]![0]
    expect(info.lines.map((l: { nodeId: string }) => l.nodeId)).toEqual(["cut", "cap", "cut2"])
    expect(info.waits).toEqual(["Clip Pack"])
    expect(info.gated).toEqual([])
    expect(info.estimatedCredits).toBe(300)
  })

  it("a declined confirm starts nothing", async () => {
    await run("final", makeCtx({ confirmRun: vi.fn().mockResolvedValue(false) }))
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
  })

  it("with Camera Switch in front of the render, the switch runs again and the plan does not", async () => {
    const CAM = n("cam", "camera-switch")
    mockNodes = [PLAN, CAM, CUT, CAP]
    mockEdges = [
      { id: "a", source: "plan", target: "cam", targetHandle: "edl" },
      { id: "c", source: "cam", target: "cut", targetHandle: "edl" },
      { id: "b", source: "cut", target: "cap" },
    ]
    await run("final")
    expect([...mockRunWorkflow.mock.calls[0]![1]].sort()).toEqual(["cam", "cap", "cut"])
  })

  it("still works with the stop-rule flag off: it re-renders at Final", async () => {
    window.__NODARO_RUNTIME__ = { previewStopRule: false }
    await run("final")
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual({ inputOverrides: { cut: { quality: "final" } } })
  })
})

describe("Update preview", () => {
  it("runs the same set at proxy; the tail the preview gates is left out of what it runs", async () => {
    await run("proxy")
    const [, nodeIds, , opts] = mockRunWorkflow.mock.calls[0]!
    expect([...nodeIds].sort()).toEqual(["cap", "cut"]) // the server's stop rule skips the tail
    expect(opts).toEqual({ inputOverrides: { cut: { quality: "proxy" } } })
    const pending = mockMarkNodesStatus.mock.calls.find(([, status]) => status === "pending")
    expect(pending![0]).toEqual(["cut"])
  })

  it("the confirm (above the threshold) names what waits for Render final, with no price for it", async () => {
    mockEstimateRunCreditLines.mockImplementation((exec: TestNode[]) =>
      exec.filter((x) => x.id !== "cap").map((x) => ({ nodeId: x.id, label: x.data.label, quantity: { fanOut: 1, units: 1, unitKind: null }, credits: RUN_CONFIRM_CREDITS + 1 })))
    const confirmRun = vi.fn().mockResolvedValue(true)
    await run("proxy", makeCtx({ confirmRun }))
    const info = confirmRun.mock.calls[0]![0]
    expect(info.trigger).toBe("update-preview")
    expect(info.lines.map((l: { nodeId: string }) => l.nodeId)).toEqual(["cut"])
    expect(info.lines[0].renderQuality).toBe("proxy")
    expect(info.gated).toEqual(["cap"])
    expect(info.estimatedCredits).toBe(RUN_CONFIRM_CREDITS + 1)
  })

  it("never asks 'nothing changed' (that is Render final's question)", async () => {
    const askConfirm = vi.fn().mockResolvedValue(true)
    mockUnchanged.mockResolvedValue(true)
    await run("proxy", makeCtx({ askConfirm }))
    expect(askConfirm).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("is not available while the stop-rule flag is off (decided 2026-10-06)", async () => {
    window.__NODARO_RUNTIME__ = { previewStopRule: false }
    await run("proxy")
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
  })
})

describe("the save must succeed", () => {
  it("saves a dirty canvas before the run starts", async () => {
    mockDirty = true
    const order: string[] = []
    const save = vi.fn(async () => { order.push("save"); return { success: true } })
    mockRunWorkflow.mockImplementation(async () => { order.push("run"); return { executionId: "e" } })
    await run("final", makeCtx(), save)
    expect(order).toEqual(["save", "run"])
  })

  it("a refused save starts nothing and gives the nodes back", async () => {
    mockDirty = true
    const setIsRunning = vi.fn()
    await handleRenderFinal("cut", "final", makeCtx() as never, "p1", vi.fn().mockResolvedValue({ success: false, error: "conflict" }), setIsRunning)
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).toHaveBeenLastCalledWith(["cut", "cap"], undefined)
    expect(setIsRunning).toHaveBeenLastCalledWith(false)
    expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/could not be saved/))
  })

  it("a save that throws is a refused save", async () => {
    mockDirty = true
    await handleRenderFinal("cut", "final", makeCtx() as never, "p1", vi.fn().mockRejectedValue(new Error("offline")), vi.fn())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  // The run clears the render's list state before the save. A refused save runs
  // nothing, so the render's Preview batch must be back exactly as it was.
  const BATCH = [{ url: "a.mp4" }, { url: "b.mp4" }]
  const withBatch = () => {
    mockNodes = [PLAN, n("cut", "apply-edl", { quality: "proxy", __listResults: BATCH, __listTotal: 2 }), CAP]
  }
  const finalPatchFor = (id: string) => {
    const state: Record<string, unknown> = { ...(mockNodes.find((x) => x.id === id)!.data as object) }
    for (const [pid, patch] of mockUpdateNodeData.mock.calls as [string, Record<string, unknown>][]) {
      if (pid === id) Object.assign(state, patch)
    }
    return state
  }

  it("a refused save leaves the render's list state intact", async () => {
    mockDirty = true
    withBatch()
    await handleRenderFinal("cut", "final", makeCtx() as never, "p1", vi.fn().mockResolvedValue({ success: false }), vi.fn())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(finalPatchFor("cut").__listResults).toEqual(BATCH)
    expect(finalPatchFor("cut").__listTotal).toBe(2)
  })

  it("a save that throws leaves the render's list state intact", async () => {
    mockDirty = true
    withBatch()
    await handleRenderFinal("cut", "final", makeCtx() as never, "p1", vi.fn().mockRejectedValue(new Error("offline")), vi.fn())
    expect(finalPatchFor("cut").__listResults).toEqual(BATCH)
  })

  it("a saved run still clears the list state before it runs", async () => {
    mockDirty = true
    withBatch()
    await run("final")
    expect(finalPatchFor("cut").__listResults).toBeUndefined()
  })

  it("unsaved edits and no project to save them to: refused", async () => {
    mockDirty = true
    await handleRenderFinal("cut", "final", makeCtx() as never, undefined, vi.fn(), vi.fn())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })
})

describe("prechecks", () => {
  it("Apply EDL's rule refuses before anything is touched, naming the rule's issues", async () => {
    mockRule.mockReturnValue({ ok: false, issues: ["segment s1: no picture"] })
    await run("final")
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("segment s1: no picture"))
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
  })

  it("a newer run the canvas does not show blocks it, with the one click that loads it", async () => {
    mockNewerPatches.mockReturnValue({ plan: { label: "plan", generatedJson: { segments: [] } } })
    await run("final")
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    const [message, opts] = mockToastError.mock.calls.find(([m]) => /newer run/.test(String(m)))!
    expect(message).toMatch(/newer run/)
    opts.action.onClick()
    expect(mockUpdateNodeData).toHaveBeenCalledWith("plan", { label: "plan", generatedJson: { segments: [] } })
  })

  it("a listing that fails never stops the run (fail open)", async () => {
    mockListExecutions.mockRejectedValue(new Error("500"))
    await run("final")
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("nothing changed since the last final: asks first; declining starts nothing", async () => {
    mockUnchanged.mockResolvedValue(true)
    const askConfirm = vi.fn().mockResolvedValue(false)
    await run("final", makeCtx({ askConfirm }))
    expect(askConfirm).toHaveBeenCalledTimes(1)
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("nothing changed, and the person says render again: it runs", async () => {
    mockUnchanged.mockResolvedValue(true)
    await run("final", makeCtx({ askConfirm: vi.fn().mockResolvedValue(true) }))
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })

  it("something changed: no question", async () => {
    const askConfirm = vi.fn()
    await run("final", makeCtx({ askConfirm }))
    expect(askConfirm).not.toHaveBeenCalled()
  })

  it("the video-link gate runs on the run's nodes, like every run path", async () => {
    await run("final")
    expect(mockGate.mock.calls[0]![0].sort()).toEqual(["cap", "cut"])
  })
})

describe("a run already in progress", () => {
  it("a 409 says so and gives the nodes back", async () => {
    mockRunWorkflow.mockRejectedValue(new MockAlreadyRunning("busy"))
    await run("final")
    expect(mockToastInfo).toHaveBeenCalledWith(expect.stringMatching(/run is in progress/))
  })
})
