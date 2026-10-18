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
const mockToastWarning = vi.fn()
const mockSetRenderCheck = vi.fn()
const mockUgcEstimate = vi.fn()
const mockRejectAllManualEdits = vi.fn()
/** The query cache a UGC estimate lands in: what `fetchQuery` brought, by key. */
const mockCache = new Map<string, unknown>()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []
let mockDirty = false
/** The workflow the store holds: another one once the editor switches in place. */
let mockWorkflowId = "wf-1"

vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: (...a: unknown[]) => mockToastInfo(...a), warning: (...a: unknown[]) => mockToastWarning(...a) },
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes, edges: mockEdges,
      updateNodeData: (...a: unknown[]) => mockUpdateNodeData(...a),
      markNodesStatus: (...a: unknown[]) => mockMarkNodesStatus(...a),
      setRenderCheck: (...a: unknown[]) => mockSetRenderCheck(...a),
      isDirty: mockDirty, workflowId: mockWorkflowId, isReadOnly: false,
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
  ugcEstimateApi: (...a: unknown[]) => mockUgcEstimate(...a),
}))
vi.mock("@/hooks/use-workflow-persistence", () => ({
  TERMINAL_RESTORABLE_STATUSES: "completed,failed",
  restoreEndedEditorRun: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }) }))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/query-client", () => ({
  queryClient: {
    fetchQuery: (...a: unknown[]) => mockFetchQuery(...a),
    getQueryData: (key: unknown) => mockCache.get(JSON.stringify(key)),
    getQueryState: (key: unknown) => (mockCache.has(JSON.stringify(key)) ? { data: mockCache.get(JSON.stringify(key)), dataUpdatedAt: Date.now() } : undefined),
  },
}))
vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    credits: { balance: (id: string) => ["credits", "balance", id] },
    ugc: { runEstimate: (request: object) => ["ugc", "run-estimate", request] },
  },
}))
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
vi.mock("../execute-node", () => ({ executeNode: vi.fn(), rejectAllManualEdits: (...a: unknown[]) => mockRejectAllManualEdits(...a) }))
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
const { previewRunnable } = await import("../preview-gate")

afterEach(() => {
  vi.useRealTimers()
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

/**
 * The ways the editor leaves the workflow a click was started on, as the real editor reads them
 * (workflow-editor-main.tsx): torn down — its context goes stale — or switched in place to another
 * workflow: its ref is re-pointed first and the next workflow loaded after, so the context is NOT
 * stale. The workflow switched to is a copy holding the very same node ids (the canvas the test
 * serves does not change). The second row's context counts no switches (the workflow compare alone);
 * the third switches away and back, its context counting both switches as the editor does.
 * `base` keeps each its own UGC chain lengths.
 */
const LEAVES = [
  {
    leaves: "goes away",
    base: 80,
    editor: (extra: Record<string, unknown> = {}) => {
      let gone = false
      return { ctx: makeCtx({ isWorkflowStale: () => gone, ...extra }), leave: () => { gone = true } }
    },
  },
  {
    leaves: "switches in place to a copy holding the same node ids",
    base: 90,
    editor: (extra: Record<string, unknown> = {}) => {
      let ref = "wf-1"
      return {
        ctx: makeCtx({ isWorkflowStale: () => mockWorkflowId !== ref, ...extra }),
        leave: () => {
          ref = "wf-2"
          mockWorkflowId = "wf-2"
        },
      }
    },
  },
  {
    leaves: "switches in place to another workflow and back",
    base: 100,
    editor: (extra: Record<string, unknown> = {}) => {
      let ref = "wf-1"
      let switches = 0
      const go = (id: string) => {
        switches += 1
        ref = id
        mockWorkflowId = id
      }
      return {
        ctx: makeCtx({ isWorkflowStale: () => mockWorkflowId !== ref, workflowSwitches: () => switches, ...extra }),
        leave: () => {
          go("wf-2")
          go("wf-1")
        },
      }
    },
  },
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
  mockCache.clear()
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
  mockDirty = false
  mockWorkflowId = "wf-1"
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

  // Decided 2026-10-06: what a second render still set to Preview holds back
  // is named on its own line, as in the Render final confirm.
  it("with a second Preview render after this one, the confirm names what waits for its own Render final apart from what waits for this one", async () => {
    const CUT2 = n("cut2", "apply-edl", { label: "Render Clips", quality: "proxy" })
    const PACK = n("pack", "edit-plan", { label: "Clip Pack" })
    mockNodes = [PLAN, CUT, CAP, CUT2, PACK]
    mockEdges = [...EDGES, { id: "c", source: "cap", target: "cut2", targetHandle: "sources" }, { id: "d", source: "cut2", target: "pack" }]
    mockEstimateRunCreditLines.mockImplementation((exec: TestNode[]) =>
      exec.filter((x) => x.id === "cut").map((x) => ({ nodeId: x.id, label: x.data.label, quantity: { fanOut: 1, units: 1, unitKind: null }, credits: RUN_CONFIRM_CREDITS + 1 })))
    const confirmRun = vi.fn().mockResolvedValue(true)
    await run("proxy", makeCtx({ confirmRun }))
    const info = confirmRun.mock.calls[0]![0]
    expect(info.trigger).toBe("update-preview")
    expect(info.lines.map((l: { nodeId: string }) => l.nodeId)).toEqual(["cut"])
    expect(info.gated).toEqual(["cap", "Render Clips"])
    expect(info.waits).toEqual(["Clip Pack"])
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

// A click whose editor leaves its workflow while it waits — torn down, or switched in place to another — ends there,
// quietly: what it would have flipped, reset, saved or started belongs to a workflow nobody is looking at.
describe.each(LEAVES)("Render final and Update preview whose editor $leaves while they wait never flip or run", ({ editor }) => {
  /** A promise and the hand that settles it. */
  function held<T>() {
    let settle!: (v: T) => void
    const promise = new Promise<T>((resolve) => { settle = resolve })
    return { promise, settle }
  }
  const save = vi.fn()
  const expectNothingTouched = () => {
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
    expect(mockCollapseExpandedClones).not.toHaveBeenCalled()
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
    expect(mockRejectAllManualEdits).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  }

  it.each(["final", "proxy"] as const)("%s: while the newer-run check is out", async (kind) => {
    const listing = held<{ data: unknown[] }>()
    mockListExecutions.mockReturnValue(listing.promise)
    const { ctx, leave } = editor()
    const done = handleRenderFinal("cut", kind, ctx as never, "p1", save, vi.fn())
    await vi.waitFor(() => expect(mockListExecutions).toHaveBeenCalledTimes(1))
    leave()
    listing.settle({ data: [] })
    await done
    expectNothingTouched()
    expect(mockGate).not.toHaveBeenCalled()
  })

  it("final: while it asks whether to render an unchanged final again, answered yes as it left", async () => {
    mockUnchanged.mockResolvedValue(true)
    const answer = held<boolean>()
    const askConfirm = vi.fn(() => answer.promise)
    const { ctx, leave } = editor({ askConfirm })
    const done = handleRenderFinal("cut", "final", ctx as never, "p1", save, vi.fn())
    await vi.waitFor(() => expect(askConfirm).toHaveBeenCalledTimes(1))
    leave()
    answer.settle(true)
    await done
    expectNothingTouched()
    expect(mockGate).not.toHaveBeenCalled()
  })

  it.each(["final", "proxy"] as const)("%s: while its confirmation is open, answered yes as it left", async (kind) => {
    mockEstimateRunCreditLines.mockImplementation((exec: TestNode[]) => exec.map((x) => ({ nodeId: x.id, label: x.data.label, quantity: { fanOut: 1, units: 1, unitKind: null }, credits: RUN_CONFIRM_CREDITS + 1 })))
    const answer = held<boolean>()
    const confirmRun = vi.fn(() => answer.promise)
    const { ctx, leave } = editor({ confirmRun })
    const done = handleRenderFinal("cut", kind, ctx as never, "p1", save, vi.fn())
    await vi.waitFor(() => expect(confirmRun).toHaveBeenCalledTimes(1))
    leave()
    answer.settle(true)
    await done
    expectNothingTouched()
    expect(mockGate).not.toHaveBeenCalled()
  })

  it.each(["final", "proxy"] as const)("%s: while a linked video is fetched", async (kind) => {
    const fetched = held<boolean>()
    mockGate.mockReturnValue(fetched.promise)
    const { ctx, leave } = editor()
    const done = handleRenderFinal("cut", kind, ctx as never, "p1", save, vi.fn())
    await vi.waitFor(() => expect(mockGate).toHaveBeenCalledTimes(1))
    leave()
    fetched.settle(true)
    await done
    expectNothingTouched()
  })
})

// The click's own newer-run check (decided 2026-10-07): the same 15 s limit as
// the inspector's open-time check, a busy state on the clicked button while it
// is out, and an answer that lands late still counts until the run is
// submitted (the `runWorkflow` call), never after.
describe("the click's newer-run check has 15 s", () => {
  const PATCHES = { plan: { label: "plan", generatedJson: { segments: [] } } }
  /** A listing that answers only when the test says so. */
  function hangListing() {
    let answer!: (v: { data: unknown[] }) => void
    mockListExecutions.mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    return {
      /** Answer now; `newer` makes that answer a newer run. */
      answer: (newer: boolean) => {
        mockNewerPatches.mockReturnValue(newer ? PATCHES : {})
        answer({ data: [{ id: "later" }] })
      },
    }
  }
  function deferred<T>() {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
  }
  const newerRunRefused = () => mockToastError.mock.calls.some(([m]) => /newer run/.test(String(m)))

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("holds the run for 15 s, then lets it go with the \"Couldn't check for a newer run\" warning", async () => {
    hangListing()
    const done = run("final")
    await vi.advanceTimersByTimeAsync(14_999)
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockToastWarning).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(mockToastWarning).toHaveBeenCalledWith(expect.stringMatching(/Couldn't check for a newer run/))
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })

  it("Update preview gets the same 15 s", async () => {
    hangListing()
    const done = run("proxy")
    await vi.advanceTimersByTimeAsync(15_000)
    await done
    expect(mockToastWarning).toHaveBeenCalledWith(expect.stringMatching(/Couldn't check for a newer run/))
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })

  it("marks the clicked render and kind busy while the check is out, and clears it when the check gives up", async () => {
    hangListing()
    let atConfirm: unknown = "never asked"
    const confirmRun = vi.fn(async () => {
      atConfirm = mockSetRenderCheck.mock.calls.at(-1)?.[0]
      return true
    })
    const done = run("final", makeCtx({ confirmRun }))
    await vi.advanceTimersByTimeAsync(0)
    expect(mockSetRenderCheck).toHaveBeenLastCalledWith({ renderId: "cut", kind: "final" })
    await vi.advanceTimersByTimeAsync(15_000)
    await done
    expect(confirmRun).toHaveBeenCalledTimes(1)
    expect(atConfirm).toBeNull() // no spinner behind the confirm
    expect(mockSetRenderCheck).toHaveBeenLastCalledWith(null)
  })

  it("an answer in time: no warning, and the busy state clears with it", async () => {
    const listing = hangListing()
    const done = run("final")
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mockSetRenderCheck).toHaveBeenLastCalledWith({ renderId: "cut", kind: "final" })
    listing.answer(false)
    await done
    expect(mockSetRenderCheck).toHaveBeenLastCalledWith(null)
    expect(mockToastWarning).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })

  it("a newer run that answers late, while the confirm is open, still stops the run", async () => {
    const listing = hangListing()
    const confirm = deferred<boolean>()
    const confirmRun = vi.fn(() => confirm.promise)
    const done = run("final", makeCtx({ confirmRun }))
    await vi.advanceTimersByTimeAsync(15_000)
    // The check gave up and the confirm is open: the answer below is late.
    expect(mockToastWarning).toHaveBeenCalledWith(expect.stringMatching(/Couldn't check for a newer run/))
    expect(confirmRun).toHaveBeenCalledTimes(1)
    listing.answer(true)
    await vi.advanceTimersByTimeAsync(0)
    confirm.resolve(true)
    await done
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(newerRunRefused()).toBe(true)
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
  })

  it("a newer run that answers late, during the save, still stops the run and gives the nodes back", async () => {
    mockDirty = true
    const BATCH = [{ url: "a.mp4" }, { url: "b.mp4" }]
    mockNodes = [PLAN, n("cut", "apply-edl", { quality: "proxy", __listResults: BATCH, __listTotal: 2 }), CAP]
    const listing = hangListing()
    const saving = deferred<{ success: boolean }>()
    const setIsRunning = vi.fn()
    const done = handleRenderFinal("cut", "final", makeCtx() as never, "p1", vi.fn(() => saving.promise), setIsRunning)
    await vi.advanceTimersByTimeAsync(15_000)
    listing.answer(true)
    await vi.advanceTimersByTimeAsync(0)
    saving.resolve({ success: true })
    await done
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(newerRunRefused()).toBe(true)
    expect(mockMarkNodesStatus).toHaveBeenLastCalledWith(["cut", "cap"], undefined)
    expect(setIsRunning).toHaveBeenLastCalledWith(false)
    // The run cleared the render's Preview batch before the save; nothing ran, so it is back.
    expect(mockUpdateNodeData).toHaveBeenCalledWith("cut", expect.objectContaining({ __listResults: undefined }))
    expect(mockUpdateNodeData).toHaveBeenLastCalledWith("cut", expect.objectContaining({ __listResults: BATCH, __listTotal: 2 }))
  })

  it("an answer that lands after the run is submitted is ignored", async () => {
    const listing = hangListing()
    const done = run("final")
    await vi.advanceTimersByTimeAsync(15_000)
    await done
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    listing.answer(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(newerRunRefused()).toBe(false)
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })

  it("clears the busy state when the handler gives up for another reason", async () => {
    mockListExecutions.mockResolvedValue({ data: [] })
    mockNewerPatches.mockReturnValue(PATCHES)
    await run("final")
    expect(mockSetRenderCheck).toHaveBeenLastCalledWith(null)
  })
})

// Render final and Update preview check a run with a UGC part against what it holds, with the toolbar Run's own check:
// the figure the confirmation priced (or the server's, landed after it), the hold, the same refusal; before anything
// is collapsed, reset, marked or saved, so a refused run leaves the lock free and nothing on the canvas.
describe("Render final and Update preview check a UGC run's balance against its hold", () => {
  const PARTS = { script: 22, creator: 41, clip: 1503, cards: 57, join: 11, overlay: 0, captions: 55 }
  /** What each part holds while the clips render: each clip at its longest length, held above its price. */
  const HOLD = { ...PARTS, clip: 2 * 1803 }
  const ANSWER = { lines: [], expected: 1, ceiling: 1, range: [1, 1], worstCase: 1, parts: PARTS, holdParts: HOLD }
  /** The editor's own figure for a node the UGC estimate does not cover (the join, the render); a UGC node's is 0. */
  const OWN = 10
  const note = async (key: "ugc.price.holdNote" | "ugc.price.holdRequired", vars?: Record<string, unknown>) =>
    (await import("@/lib/i18n")).tx(key, vars as never)

  /**
   * A UGC video on the render's plan path: the Edit Plan whose cut the render applies also feeds the script, so both
   * runs re-run the video up to the render (Render final the cards and captions after it too). In the usual layout (a
   * render after the join) Update preview runs only the render: the stop rule holds back what follows it.
   */
  function useChainOnPlanPath(targetDurationSec: number) {
    mockNodes = [
      n("plan", "edit-plan"),
      n("script", "ugc-script", { targetDurationSec }),
      n("creator", "ugc-creator", { source: "sampled", gender: "woman" }),
      n("clips", "ugc-clips"),
      n("clip", "ugc-clip", { rerender: {} }),
      n("join", "combine-videos", { transition: "cut" }),
      n("cut", "apply-edl", { quality: "proxy" }),
      n("cards", "ugc-cards"),
      n("cap", "add-captions"),
    ]
    mockEdges = [
      { id: "u1", source: "plan", target: "cut", targetHandle: "edl" },
      { id: "u2", source: "plan", target: "script", targetHandle: "site" },
      { id: "u3", source: "script", target: "creator", targetHandle: "category" },
      { id: "u4", source: "script", target: "clips", targetHandle: "plan" },
      { id: "u5", source: "creator", target: "clips", targetHandle: "creator" },
      { id: "u6", source: "clips", target: "clip", targetHandle: "clip" },
      { id: "u7", source: "clip", target: "join", targetHandle: "in" },
      { id: "u8", source: "join", target: "cut", targetHandle: "in" },
      { id: "u9", source: "cut", target: "cards", targetHandle: "video" },
      { id: "u10", source: "clips", target: "cards", sourceHandle: "plan-out", targetHandle: "plan" },
      { id: "u11", source: "clip", target: "cards", targetHandle: "notes" },
      { id: "u12", source: "cards", target: "cap", sourceHandle: "captionPlan", targetHandle: "captionPlan" },
      { id: "u13", source: "cut", target: "cap", targetHandle: "in" },
    ]
  }
  /** One line per node the run executes (like the real estimate, never what a Preview render holds back), at the editor's own figure. */
  function ownLines() {
    mockEstimateRunCreditLines.mockImplementation((exec: TestNode[], all: TestNode[], edges: never[]) => {
      const runs = previewRunnable(exec as never[], all as never, edges) as TestNode[]
      return runs.map((x) => ({ nodeId: x.id, label: x.data.label, quantity: { fanOut: 1, units: 1, unitKind: null }, credits: x.type.startsWith("ugc-") ? 0 : OWN }))
    })
  }
  /** The balance the check reads, and the estimate landing in the cache as soon as it is asked. */
  function balanceOf(total: number | (() => number)) {
    mockFetchQuery.mockImplementation(async (query: { queryKey: unknown[] }) => {
      if (query.queryKey[0] !== "ugc") return { total: typeof total === "number" ? total : total(), tier: "pro" }
      const data = await mockUgcEstimate()
      mockCache.set(JSON.stringify(query.queryKey), data)
      return data
    })
  }
  const balanceReads = () => mockFetchQuery.mock.calls.filter(([q]) => (q as { queryKey: unknown[] }).queryKey[0] === "credits").length

  // Render final runs the join and the render (the editor's figure) and the script, creator, clip, cards and captions
  // (the server's); Update preview the same less the cards and captions, which follow the render.
  const FINAL_PRICE = 2 * OWN + PARTS.script + PARTS.creator + PARTS.clip + PARTS.cards + PARTS.captions
  const PREVIEW_PRICE = 2 * OWN + PARTS.script + PARTS.creator + PARTS.clip
  const KINDS = [
    { name: "Render final", kind: "final" as const, trigger: "render-final", price: FINAL_PRICE, hold: FINAL_PRICE - PARTS.clip + HOLD.clip },
    { name: "Update preview", kind: "proxy" as const, trigger: "update-preview", price: PREVIEW_PRICE, hold: PREVIEW_PRICE - PARTS.clip + HOLD.clip },
  ]

  beforeEach(() => { ownLines() })

  it.each(KINDS.map((k, i) => ({ ...k, len: 70 + i })))("$name: a balance between the price and the hold is refused on the server's hold, before anything is touched", async (k) => {
    useChainOnPlanPath(k.len)
    mockDirty = true
    mockUgcEstimate.mockResolvedValue(ANSWER)
    balanceOf(k.price + 100)
    const confirmRun = vi.fn().mockResolvedValue(true)
    const save = vi.fn().mockResolvedValue({ success: true })
    const ctx = makeCtx({ confirmRun })
    const setIsRunning = vi.fn()
    await handleRenderFinal("cut", k.kind, ctx as never, "p1", save, setIsRunning)
    // The confirmation quoted the server's price and what the clips hold.
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: k.trigger, estimatedCredits: k.price, priceNotes: [await note("ugc.price.holdNote")] }))
    expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith({
      required: k.hold,
      available: k.price + 100,
      tier: "pro",
      note: await note("ugc.price.holdRequired", { credits: k.price }),
    })
    expect(ctx.setShowInsufficientCredits).toHaveBeenCalledWith(true)
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    // Nothing touched: no manual edit rejected, no collapse (it marks the workflow unsaved), no reset, no pending
    // mark, no save; nothing busy.
    expect(mockRejectAllManualEdits).not.toHaveBeenCalled()
    expect(setIsRunning).not.toHaveBeenCalled()
    expect(mockCollapseExpandedClones).not.toHaveBeenCalled()
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(mockSetRenderCheck).toHaveBeenLastCalledWith(null)
    // One ask: the check read the figure the confirmation priced.
    expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
    // Checked before the linked videos are fetched: a refused run never waits for a download.
    expect(mockGate).not.toHaveBeenCalled()
  })

  it.each(KINDS.map((k, i) => ({ ...k, len: 72 + i })))("$name: a balance that covers the hold runs, with one ask", async (k) => {
    useChainOnPlanPath(k.len)
    mockUgcEstimate.mockResolvedValue(ANSWER)
    balanceOf(k.hold)
    const ctx = makeCtx()
    await handleRenderFinal("cut", k.kind, ctx as never, "p1", vi.fn().mockResolvedValue({ success: true }), vi.fn())
    expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    expect(balanceReads()).toBe(1)
    expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
    // A run that goes ahead fetches its linked videos, after the check.
    expect(mockGate).toHaveBeenCalledTimes(1)
    expect(mockFetchQuery.mock.invocationCallOrder.at(-1)!).toBeLessThan(mockGate.mock.invocationCallOrder[0]!)
  })

  it.each(KINDS.map((k, i) => ({ ...k, len: 74 + i })))("$name: a refused run leaves the lock free: the next click asks again and runs", async (k) => {
    useChainOnPlanPath(k.len)
    mockUgcEstimate.mockResolvedValue(ANSWER)
    let total = k.price + 100
    balanceOf(() => total)
    const refused = makeCtx()
    await handleRenderFinal("cut", k.kind, refused as never, "p1", vi.fn(), vi.fn())
    expect(refused.setInsufficientCreditsData).toHaveBeenCalledTimes(1)
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    total = k.hold
    const ctx = makeCtx()
    await handleRenderFinal("cut", k.kind, ctx as never, "p1", vi.fn().mockResolvedValue({ success: true }), vi.fn())
    expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    expect(balanceReads()).toBe(2)
  })

  describe("the server's figure lands while the could-not-be-checked confirmation is open", () => {
    // The estimate answers at 6 s, past the 5 s wait; the person confirms at 15 s.
    beforeEach(() => { vi.useFakeTimers() })

    it.each(KINDS.map((k, i) => ({ ...k, len: 76 + i })))("$name checks the balance against the server's hold", async (k) => {
      useChainOnPlanPath(k.len)
      mockUgcEstimate.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(ANSWER), 6_000)))
      balanceOf(k.price + 100)
      const confirmRun = vi.fn(() => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10_000)))
      const ctx = makeCtx({ confirmRun })
      const done = handleRenderFinal("cut", k.kind, ctx as never, "p1", vi.fn().mockResolvedValue({ success: true }), vi.fn())
      await vi.advanceTimersByTimeAsync(16_000)
      await done
      // The confirmation priced without the server's answer, saying so.
      expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: k.trigger, priceUnchecked: true }))
      expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith({
        required: k.hold,
        available: k.price + 100,
        tier: "pro",
        note: await note("ugc.price.holdRequired", { credits: k.price }),
      })
      expect(mockRunWorkflow).not.toHaveBeenCalled()
      expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
      expect(mockGate).not.toHaveBeenCalled()
    })

    it.each(KINDS.map((k, i) => ({ ...k, len: 78 + i })))("$name checks the run as it was clicked, though the canvas changed while the question was open", async (k) => {
      useChainOnPlanPath(k.len)
      mockUgcEstimate.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(ANSWER), 6_000)))
      balanceOf(k.price + 100)
      // While the question is open the script's plan wire is removed: read on the canvas as it is now, the run has
      // no UGC video to price, and the editor's own figure for it would pass.
      const confirmRun = vi.fn(() => new Promise<boolean>((resolve) => setTimeout(() => {
        mockEdges = (mockEdges as Array<{ id: string }>).filter((e) => e.id !== "u4")
        resolve(true)
      }, 10_000)))
      const ctx = makeCtx({ confirmRun })
      const done = handleRenderFinal("cut", k.kind, ctx as never, "p1", vi.fn().mockResolvedValue({ success: true }), vi.fn())
      await vi.advanceTimersByTimeAsync(16_000)
      await done
      expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith(expect.objectContaining({ required: k.hold }))
      expect(mockRunWorkflow).not.toHaveBeenCalled()
    })
  })

  describe.each(LEAVES)("whose editor $leaves while it waits", ({ editor, base }) => {
    function held<T>() {
      let settle!: (v: T) => void
      const promise = new Promise<T>((resolve) => { settle = resolve })
      return { promise, settle }
    }
    const expectNothingTouched = (save: ReturnType<typeof vi.fn>) => {
      expect(mockMarkNodesStatus).not.toHaveBeenCalled()
      expect(mockCollapseExpandedClones).not.toHaveBeenCalled()
      expect(mockUpdateNodeData).not.toHaveBeenCalled()
      expect(mockRejectAllManualEdits).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
      expect(mockRunWorkflow).not.toHaveBeenCalled()
      expect(mockGate).not.toHaveBeenCalled()
    }

    it.each(KINDS.map((k, i) => ({ ...k, len: base + i })))("$name: while the price is on its way", async (k) => {
      useChainOnPlanPath(k.len)
      const price = held<unknown>()
      mockUgcEstimate.mockReturnValue(price.promise)
      balanceOf(k.hold)
      const save = vi.fn()
      const { ctx, leave } = editor({ confirmRun: vi.fn().mockResolvedValue(true) })
      const done = handleRenderFinal("cut", k.kind, ctx as never, "p1", save, vi.fn())
      await vi.waitFor(() => expect(mockUgcEstimate).toHaveBeenCalledTimes(1))
      leave()
      price.settle(ANSWER)
      await done
      expectNothingTouched(save)
    })

    it.each(KINDS.map((k, i) => ({ ...k, len: base + 2 + i })))("$name: while its balance is read", async (k) => {
      useChainOnPlanPath(k.len)
      mockUgcEstimate.mockResolvedValue(ANSWER)
      const balance = held<unknown>()
      mockFetchQuery.mockImplementation(async (query: { queryKey: unknown[] }) => {
        if (query.queryKey[0] !== "ugc") return balance.promise
        const data = await mockUgcEstimate()
        mockCache.set(JSON.stringify(query.queryKey), data)
        return data
      })
      const save = vi.fn()
      const { ctx, leave } = editor({ confirmRun: vi.fn().mockResolvedValue(true) })
      const done = handleRenderFinal("cut", k.kind, ctx as never, "p1", save, vi.fn())
      await vi.waitFor(() => expect(balanceReads()).toBe(1))
      leave()
      balance.settle({ total: 1_000_000, tier: "pro" })
      await done
      expectNothingTouched(save)
    })
  })

  describe("a render after the join, as a UGC video usually has it", () => {
    function useRenderAfterJoin(targetDurationSec: number) {
      mockNodes = [
        n("script", "ugc-script", { targetDurationSec }),
        n("creator", "ugc-creator", { source: "sampled", gender: "woman" }),
        n("clips", "ugc-clips"),
        n("clip", "ugc-clip", { rerender: {} }),
        n("join", "combine-videos", { transition: "cut" }),
        n("cut", "apply-edl", { quality: "proxy" }),
        n("cards", "ugc-cards"),
        n("cap", "add-captions"),
      ]
      mockEdges = [
        { id: "r1", source: "script", target: "clips", targetHandle: "plan" },
        { id: "r2", source: "creator", target: "clips", targetHandle: "creator" },
        { id: "r3", source: "clips", target: "clip", targetHandle: "clip" },
        { id: "r4", source: "clip", target: "join", targetHandle: "in" },
        { id: "r5", source: "join", target: "cut", targetHandle: "in" },
        { id: "r6", source: "cut", target: "cards", targetHandle: "video" },
        { id: "r7", source: "clips", target: "cards", sourceHandle: "plan-out", targetHandle: "plan" },
        { id: "r8", source: "clip", target: "cards", targetHandle: "notes" },
        { id: "r9", source: "cards", target: "cap", sourceHandle: "captionPlan", targetHandle: "captionPlan" },
        { id: "r10", source: "cut", target: "cap", targetHandle: "in" },
      ]
    }

    it("Render final runs the render, the cards and the captions: a balance below the server's price is refused on it, though the editor's own figure would pass", async () => {
      useRenderAfterJoin(80)
      mockUgcEstimate.mockResolvedValue(ANSWER)
      // The render (the editor's 10) and the cards and captions (the server's): the hold is the price, no clip renders.
      const price = OWN + PARTS.cards + PARTS.captions
      expect(OWN).toBeLessThan(100)
      expect(price).toBeGreaterThan(100)
      balanceOf(100)
      const ctx = makeCtx()
      await handleRenderFinal("cut", "final", ctx as never, "p1", vi.fn(), vi.fn())
      expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith({ required: price, available: 100, tier: "pro" })
      expect(mockRunWorkflow).not.toHaveBeenCalled()
      expect(mockMarkNodesStatus).not.toHaveBeenCalled()
    })

    it("Update preview runs the render alone (the stop rule holds back the cards and captions): no UGC part, so no check", async () => {
      useRenderAfterJoin(81)
      mockUgcEstimate.mockResolvedValue(ANSWER)
      balanceOf(0)
      await handleRenderFinal("cut", "proxy", makeCtx() as never, "p1", vi.fn(), vi.fn())
      expect(mockFetchQuery).not.toHaveBeenCalled()
      expect(mockUgcEstimate).not.toHaveBeenCalled()
      expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    })
  })

  it.each([
    { name: "Render final", kind: "final" as const },
    { name: "Update preview", kind: "proxy" as const },
  ])("$name of a run with no UGC part reads no balance and no estimate, and starts as before", async ({ kind }) => {
    mockFetchQuery.mockResolvedValue({ total: 0, tier: "pro" })
    const ctx = makeCtx()
    await run(kind, ctx)
    expect(mockFetchQuery).not.toHaveBeenCalled()
    expect(mockUgcEstimate).not.toHaveBeenCalled()
    expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })
})

/**
 * Render final continues the server run whose Preview it renders, so a
 * continue-from-failed lineage sees its final (`via: "subset"` on the server).
 * The same nodes and the same override are sent either way: continuing adds
 * only `continueFromExecutionId`, and only while every node feeding the final
 * reads the same from that run as from the saved workflow.
 */
const continuationApi = await import("@/lib/api")
const { ContinuationRefusedError } = await import("@/lib/run-workflow-errors")

describe("Render final continues the run whose Preview it renders", () => {
  const read = vi.mocked(continuationApi.getWorkflowExecution)
  /** The run that made the Preview: it ran the plan and the render (the canvas shows both). */
  /** The plan the run made, as it recorded it and as the canvas holds it. */
  const PLAN_JSON = { version: 1, segments: [{ source: "s1", start: 0, end: 4 }] }
  const PREVIEW_RUN = {
    id: "exec-prev", kind: "execution", workflowId: "wf-1", status: "completed", triggerType: "manual",
    nodeStates: { plan: { status: "completed", startedAt: "t", jobId: "j-plan", output: { json: PLAN_JSON } }, cut: { status: "completed", startedAt: "t", jobId: "j-cut" } },
  }
  const shownFrom = (id: string) => ({ resultsRunId: id, generatedJson: PLAN_JSON })
  const plan = (data: Record<string, unknown> = shownFrom("exec-prev")) => n("plan", "edit-plan", data)
  const take = n("cut", "apply-edl", { quality: "proxy", resultsRunId: "exec-prev" })
  const PLAIN = { inputOverrides: { cut: { quality: "final" } } }

  afterEach(() => read.mockReset())

  it("a canvas painted from that run: sends it as continueFromExecutionId, beside the same nodes and override", async () => {
    mockNodes = [plan(), take, CAP]
    read.mockImplementation(async (id: string) => ({ ...PREVIEW_RUN, id }) as never)
    await run("final")
    expect(read).toHaveBeenCalledWith("exec-prev")
    const [, nodeIds, , opts] = mockRunWorkflow.mock.calls[0]!
    expect([...nodeIds].sort()).toEqual(["cap", "cut"])
    expect(opts).toEqual({ ...PLAIN, continueFromExecutionId: "exec-prev" })
  })

  it("an Edit Plan holding a review still continues: the server re-applies the saved review to the plan it recorded (regression)", async () => {
    mockNodes = [plan({ ...shownFrom("exec-prev"), editedEdl: { segments: [{ source: "s1", start: 1, end: 4 }] } }), take, CAP]
    read.mockImplementation(async (id: string) => ({ ...PREVIEW_RUN, id }) as never)
    await run("final")
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual({ ...PLAIN, continueFromExecutionId: "exec-prev" })
  })

  it("a plain run when the Edit Plan was planned again since (another plan, whatever its stamp)", async () => {
    mockNodes = [plan({ ...shownFrom("exec-prev"), generatedJson: { ...PLAN_JSON, segments: [] } }), take, CAP]
    read.mockResolvedValue(PREVIEW_RUN as never)
    await run("final")
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual(PLAIN)
  })

  it("a feeder that run handed on from an earlier run (a continued run's seed) reads the same when the canvas shows that earlier run", async () => {
    mockNodes = [plan(shownFrom("exec-root")), take, CAP]
    read.mockResolvedValue({ ...PREVIEW_RUN, nodeStates: { ...PREVIEW_RUN.nodeStates, plan: { status: "completed", seededFromExecution: "exec-root", output: { json: PLAN_JSON } } } } as never)
    await run("final")
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual({ ...PLAIN, continueFromExecutionId: "exec-prev" })
  })

  it.each([
    { why: "the take is a browser run of the render (a job id)", exec: { ...PREVIEW_RUN, kind: "job" } },
    { why: "the run did not complete", exec: { ...PREVIEW_RUN, status: "failed" } },
    { why: "the run is another workflow's", exec: { ...PREVIEW_RUN, workflowId: "wf-other" } },
    { why: "the run is an app's run", exec: { ...PREVIEW_RUN, triggerType: "app_run" } },
    { why: "the run holds no completed state of a feeder", exec: { ...PREVIEW_RUN, nodeStates: { cut: PREVIEW_RUN.nodeStates.cut } } },
  ])("a plain run, as before, when $why", async ({ exec }) => {
    mockNodes = [plan(), take, CAP]
    read.mockResolvedValue(exec as never)
    await run("final")
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual(PLAIN)
  })

  it("a plain run when the take's run cannot be read", async () => {
    mockNodes = [plan(), take, CAP]
    read.mockRejectedValue(new Error("404"))
    await run("final")
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual(PLAIN)
  })

  it("a plain run when the render's take names no run (nothing to continue)", async () => {
    await run("final")
    expect(read).not.toHaveBeenCalled()
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual(PLAIN)
  })

  it("a plain run when a feeder shows another result than that run's (run again on its own since)", async () => {
    mockNodes = [plan(shownFrom("job-9")), take, CAP]
    read.mockResolvedValue(PREVIEW_RUN as never)
    await run("final")
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual(PLAIN)
  })

  it("a plain run when a feeder holds several takes (a list reader of a plain run reads them all)", async () => {
    mockNodes = [plan({ ...shownFrom("exec-prev"), generatedResults: [{ url: "a" }, { url: "b" }] }), take, CAP]
    read.mockResolvedValue(PREVIEW_RUN as never)
    await run("final")
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual(PLAIN)
  })

  it("a plain run when an input the run read from its data (a text) was edited since", async () => {
    const note = n("note", "text-prompt", { text: "edited since" })
    mockNodes = [plan(), take, CAP, note]
    mockEdges = [...EDGES, { id: "t", source: "note", target: "cap", targetHandle: "text" }]
    read.mockResolvedValue({ ...PREVIEW_RUN, nodeStates: { ...PREVIEW_RUN.nodeStates, note: { status: "completed", fromSavedData: true, output: { text: "as it ran" } } } } as never)
    await run("final")
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual(PLAIN)
  })

  it("a run the server named (Continue from failed) is continued whatever the take", async () => {
    read.mockImplementation(async (id: string) => ({ ...PREVIEW_RUN, id }) as never)
    await handleRenderFinal("cut", "final", makeCtx() as never, "p1", vi.fn().mockResolvedValue({ success: true }), vi.fn(), undefined, undefined, { continueFrom: "exec-held" })
    expect(read).toHaveBeenCalledWith("exec-held")
    expect(mockRunWorkflow.mock.calls[0]![3]).toEqual({ ...PLAIN, continueFromExecutionId: "exec-held" })
  })

  it("a continuation the server refuses runs as a plain run, once", async () => {
    mockNodes = [plan(), take, CAP]
    read.mockResolvedValue(PREVIEW_RUN as never)
    mockRunWorkflow.mockRejectedValueOnce(new ContinuationRefusedError("not completed", "continuation_not_completed"))
    await run("final")
    expect(mockRunWorkflow).toHaveBeenCalledTimes(2)
    expect(mockRunWorkflow.mock.calls[0]![3]).toMatchObject({ continueFromExecutionId: "exec-prev" })
    expect(mockRunWorkflow.mock.calls[1]![3]).toEqual(PLAIN)
    expect(mockToastError).not.toHaveBeenCalled()
  })
})

// A Render final that starts nothing never wipes canvas data (fix round 2): a
// connected List's rows and the render's Preview batch are cleared only once
// nothing before the save can stop the run, and every way out after that which
// starts nothing (a refused save, a request that fails, a run already in
// progress) puts back exactly what the click cleared.
describe("a Render final that starts nothing never wipes canvas data", () => {
  const BATCH = [{ url: "a.mp4" }, { url: "b.mp4" }]
  const ROWS = [["first"], ["second"]]
  const LIST = n("list", "list", { columns: [{ id: "c1", name: "Captions", connectedSourceId: "cap" }], rows: ROWS })
  /** The node's data after every write the click made, in order. */
  const dataOf = (id: string) => {
    const state: Record<string, unknown> = { ...(mockNodes.find((x) => x.id === id)!.data as object) }
    for (const [pid, patch] of mockUpdateNodeData.mock.calls as [string, Record<string, unknown>][]) {
      if (pid === id) Object.assign(state, patch)
    }
    return state
  }
  const rowsTouched = () => mockUpdateNodeData.mock.calls.some(([id]) => id === "list")
  beforeEach(() => {
    mockNodes = [PLAN, n("cut", "apply-edl", { quality: "proxy", __listResults: BATCH, __listTotal: 2 }), CAP, LIST]
  })

  it("a run that starts clears the List's rows and the Preview batch", async () => {
    await run("final")
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    expect(dataOf("list").rows).toEqual([[""]])
    expect(dataOf("cut").__listResults).toBeUndefined()
  })

  it("a refused save puts the List's rows back", async () => {
    mockDirty = true
    await handleRenderFinal("cut", "final", makeCtx() as never, "p1", vi.fn().mockResolvedValue({ success: false }), vi.fn())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(rowsTouched()).toBe(true)
    expect(dataOf("list").rows).toEqual(ROWS)
    expect(dataOf("cut").__listResults).toEqual(BATCH)
  })

  it("a request that fails puts back the List's rows and the Preview batch, and unmarks the nodes", async () => {
    mockRunWorkflow.mockRejectedValue(new Error("network down"))
    const setIsRunning = vi.fn()
    await handleRenderFinal("cut", "final", makeCtx() as never, "p1", vi.fn().mockResolvedValue({ success: true }), setIsRunning)
    expect(mockToastError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ description: "network down" }))
    expect(dataOf("list").rows).toEqual(ROWS)
    expect(dataOf("cut").__listResults).toEqual(BATCH)
    expect(dataOf("cut").__listTotal).toBe(2)
    expect(mockMarkNodesStatus).toHaveBeenLastCalledWith(["cut", "cap"], undefined)
    expect(setIsRunning).toHaveBeenLastCalledWith(false)
  })

  it("a run already in progress: this final started nothing, so the data goes back", async () => {
    mockRunWorkflow.mockRejectedValue(new MockAlreadyRunning("busy"))
    await run("final")
    expect(mockToastInfo).toHaveBeenCalledWith(expect.stringMatching(/run is in progress/))
    expect(dataOf("list").rows).toEqual(ROWS)
    expect(dataOf("cut").__listResults).toEqual(BATCH)
  })

  it("refused before the save (unsaved edits, no project): the rows are never touched", async () => {
    mockDirty = true
    await handleRenderFinal("cut", "final", makeCtx() as never, undefined, vi.fn(), vi.fn())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(rowsTouched()).toBe(false)
  })

  it("nothing left to run once the canvas is collapsed: the rows are never touched", async () => {
    // The confirm saw a runnable set; the graph the run is built from holds none of it any more.
    mockCollapseExpandedClones.mockImplementation(() => ({
      nodes: mockNodes.map((x) => (x.id === "cut" || x.id === "cap" ? { ...x, hidden: true } : x)),
      edges: mockEdges,
    }))
    await run("final")
    expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/No executable nodes/))
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(rowsTouched()).toBe(false)
  })
})
