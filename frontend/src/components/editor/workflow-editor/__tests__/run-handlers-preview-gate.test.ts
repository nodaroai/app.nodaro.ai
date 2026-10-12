import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"

/**
 * The editor's enforcement of the preview stop rule (decided 2026-10-04).
 *
 * A single-node ▶ inside a Preview render's closure would consume the
 * preview: it is refused in confirmRunOrAbort's refusal block, ABOVE the
 * skip-confirm shortcut. Run / Run from here / Run selected are never refused
 * — the server skips the closure — but the closure is never flipped to
 * pending. The render's own ▶ stays allowed.
 */

const mockToastError = vi.fn()
const mockExecuteNode = vi.fn()
const mockBuildExecutionLevels = vi.fn()
const mockGetEffectivelySkippedIds = vi.fn()
const mockCollapseExpandedClones = vi.fn()
const mockRunWorkflow = vi.fn()
const mockFetchQuery = vi.fn()
const mockEstimateRunCredits = vi.fn()
const mockNestedPreflight = vi.fn()
const mockEnsureVideoLinks = vi.fn()
const mockMarkNodesStatus = vi.fn()
const mockToastInfo = vi.fn()
const mockUgcEstimate = vi.fn()
/** What a run touches once it goes ahead: named, so a refused run can be shown to have touched none of it. */
const mockRejectAllManualEdits = vi.fn()
const mockUpdateNodeData = vi.fn()
const mockSetIsRunning = vi.fn()
/** The query cache the estimate lands in: what `fetchQuery` brought, by key. */
const mockCache = new Map<string, unknown>()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown>; selected?: boolean }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []
/** The workflow the store holds: another one once the editor switches in place. */
let mockWorkflowId = "wf-1"

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: (...a: unknown[]) => mockToastInfo(...a) } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes, edges: mockEdges,
      updateNodeData: (...a: unknown[]) => mockUpdateNodeData(...a), markNodesStatus: (...a: unknown[]) => mockMarkNodesStatus(...a),
      isDirty: false, workflowId: mockWorkflowId,
    }),
  },
}))
vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getUserCredits: vi.fn(),
  runWorkflow: (...a: unknown[]) => mockRunWorkflow(...a),
  getWorkflowExecution: vi.fn(),
  withDedupRaceRetry: <T,>(fn: () => Promise<T>) => fn(),
  WorkflowAlreadyRunningError: class extends Error {},
  ugcEstimateApi: (...a: unknown[]) => mockUgcEstimate(...a),
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
  // One line per node, adding up to the editor's figure (all of it on the first line): a UGC run whose first node
  // the estimate covers adds nothing of its own for the nodes the estimate does not cover.
  estimateRunCreditLines: (executable: Array<{ id: string }>, ...rest: unknown[]) => {
    const total = mockEstimateRunCredits(executable, ...rest) as number
    return executable.map((x, i) => ({ nodeId: x.id, label: x.id, quantity: { fanOut: 1, units: 1 }, credits: i === 0 ? total : 0 }))
  },
  sumRunCreditLines: (lines: Array<{ credits: number }>) => lines.reduce((sum, l) => sum + l.credits, 0),
  runNodeLabel: (node: { id: string }) => node.id,
}))
vi.mock("../types", () => ({
  WorkflowStaleError: class extends Error {},
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: () => {},
  NODE_CREDIT_COSTS: { "sub-workflow": 0 } as Record<string, number>,
  isExecutableNode: (n: { type?: string }) => n.type !== "upload-video",
  SERVER_RUN_ONLY_TYPES: new Set<string>(),
  getFanOutMultiplier: () => 1,
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: (...a: unknown[]) => mockBuildExecutionLevels(...a),
  getEffectivelySkippedIds: (...a: unknown[]) => mockGetEffectivelySkippedIds(...a),
  collapseExpandedClones: (...a: unknown[]) => mockCollapseExpandedClones(...a),
  // Nothing in these graphs has run yet (Run up to here walks up to what has).
  extractNodeOutput: () => undefined,
}))
vi.mock("../node-input-resolver", () => ({ getListInputForNode: () => null, getListFanOutForNode: () => undefined }))
vi.mock("../execute-node", () => ({ executeNode: (...a: unknown[]) => mockExecuteNode(...a), rejectAllManualEdits: (...a: unknown[]) => mockRejectAllManualEdits(...a) }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
// The nested walk itself is unit-tested in sub-workflow-preflight.test.ts; here
// it stands in for "a referenced workflow the run must not start".
vi.mock("../sub-workflow-preflight", () => ({
  nestedRunPreflight: (...a: unknown[]) => mockNestedPreflight(...a),
}))
// No graph here holds a Video URL node; the gate stands in for the download a run waits on.
vi.mock("../video-link-run-gate", () => ({
  ensureVideoLinksBeforeRun: (...a: unknown[]) => mockEnsureVideoLinks(...a),
}))

const {
  confirmRunOrAbort, handleRun, handleRunFromHere, handleRunSelected, handleRunSingleNode, handleRunUpToHere,
  detachActiveWorkflowStream, releaseSingleRunGuards, RUN_CONFIRM_CREDITS,
} = await import("../run-handlers")
const { useRunConfirm } = await import("../run-confirm-dialog")

// A Run started by a test leaves the module's stream slot taken; the next test
// would meet a run "already followed" and its Run would refuse without testing anything.
afterEach(() => {
  detachActiveWorkflowStream()
  delete window.__NODARO_RUNTIME__
})

const n = (id: string, type: string, data: Record<string, unknown> = {}): TestNode => ({
  id, type, position: { x: 0, y: 0 }, data: { label: id, ...data },
})
const PLAN = n("plan", "edit-plan")
const CUT = n("cut", "apply-edl", { quality: "proxy" })
const CAP = n("cap", "add-captions")
const EDGES = [
  { id: "a", source: "plan", target: "cut" },
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
    base: 90,
    editor: (extra: Record<string, unknown> = {}) => {
      let gone = false
      return { ctx: { ...makeCtx(), isWorkflowStale: () => gone, ...extra } as never, leave: () => { gone = true } }
    },
  },
  {
    leaves: "switches in place to a copy holding the same node ids",
    base: 70,
    editor: (extra: Record<string, unknown> = {}) => {
      let ref = "wf-1"
      return {
        ctx: { ...makeCtx(), isWorkflowStale: () => mockWorkflowId !== ref, ...extra } as never,
        leave: () => {
          ref = "wf-2"
          mockWorkflowId = "wf-2"
        },
      }
    },
  },
  {
    leaves: "switches in place to another workflow and back",
    base: 115,
    editor: (extra: Record<string, unknown> = {}) => {
      let ref = "wf-1"
      let switches = 0
      const go = (id: string) => {
        switches += 1
        ref = id
        mockWorkflowId = id
      }
      return {
        ctx: { ...makeCtx(), isWorkflowStale: () => mockWorkflowId !== ref, workflowSwitches: () => switches, ...extra } as never,
        leave: () => {
          go("wf-2")
          go("wf-1")
        },
      }
    },
  },
]

function makeCtx() {
  return {
    userId: "u1", projectId: "p1",
    trackInterval: (i: unknown) => i, untrackInterval: vi.fn(),
    save: vi.fn(), setIsRunning: vi.fn(),
    isWorkflowStale: () => false, isStorageError: () => false,
    setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(), setInsufficientCreditsData: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // PREVIEW_STOP_RULE_ENABLED on, as /config.js hands it to the editor.
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
  mockWorkflowId = "wf-1"
  mockNodes = [PLAN, CUT, CAP]
  mockEdges = EDGES
  mockCollapseExpandedClones.mockReturnValue({ nodes: [PLAN, CUT, CAP], edges: EDGES })
  mockBuildExecutionLevels.mockReturnValue([[PLAN], [CUT], [CAP]])
  mockGetEffectivelySkippedIds.mockReturnValue(new Set())
  mockExecuteNode.mockResolvedValue(undefined)
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
  mockCache.clear()
  mockFetchQuery.mockImplementation(async (query: { queryKey: unknown[] }) => {
    if (query.queryKey[0] !== "ugc") return { total: 100_000, tier: "pro" }
    const data = await mockUgcEstimate()
    mockCache.set(JSON.stringify(query.queryKey), data)
    return data
  })
  mockEstimateRunCredits.mockReturnValue(10)
  mockNestedPreflight.mockResolvedValue(null)
  mockEnsureVideoLinks.mockResolvedValue(true)
})

describe("a single-node ▶ inside a Preview render's closure", () => {
  it("is refused with the TA12 copy, even when the confirm is skipped", async () => {
    const ctx = makeCtx()
    await handleRunSingleNode("cap", ctx as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    expect(mockToastError).toHaveBeenCalledWith("Render final first — this node runs after the final")
    expect(mockExecuteNode).not.toHaveBeenCalled()
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("the render's own ▶ stays allowed", async () => {
    await handleRunSingleNode("cut", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    expect(mockToastError).not.toHaveBeenCalledWith("Render final first — this node runs after the final")
  })

  it("is allowed once the render is Final", async () => {
    mockNodes = [PLAN, n("cut", "apply-edl", { quality: "final" }), CAP]
    await handleRunSingleNode("cap", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    expect(mockToastError).not.toHaveBeenCalledWith("Render final first — this node runs after the final")
  })
})

describe("Run never refuses, and never flips the closure to pending", () => {
  it("starts the server run and marks only what it executes", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(mockRunWorkflow).toHaveBeenCalled()
    const pending = mockMarkNodesStatus.mock.calls.find(([, status]) => status === "pending")
    expect(pending?.[0]).toEqual(["plan", "cut"])
  })
})

describe("the run preflights see only what the run executes", () => {
  // cut(proxy) → transcribe(whisper, no word timings) → captions, plus a
  // sub-workflow, all in the gated tail. The server skips the tail, so neither
  // the word-timings check nor the nested walk may refuse the run over it.
  const TR = n("tr", "transcribe", { provider: "whisper" })
  const CAPS = n("caps", "add-captions")
  const SUB = n("sub", "sub-workflow", { workflowId: "wf-child" })
  const TAIL_EDGES = [
    { id: "a", source: "plan", target: "cut" },
    { id: "b", source: "cut", target: "tr" },
    { id: "c", source: "tr", sourceHandle: "json", target: "caps", targetHandle: "transcript" },
    { id: "d", source: "cut", target: "sub" },
  ]

  beforeEach(() => {
    mockNodes = [PLAN, CUT, TR, CAPS, SUB]
    mockEdges = TAIL_EDGES
    mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: TAIL_EDGES })
    mockBuildExecutionLevels.mockReturnValue([[PLAN], [CUT], [TR, SUB], [CAPS]])
  })

  it("Run is not refused over a word-incapable transcribe → captions chain in the gated tail", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(JSON.stringify(mockToastError.mock.calls)).not.toMatch(/whisper/)
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("the nested walk is handed only the nodes that run, never a gated sub-workflow", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    const walked = (mockNestedPreflight.mock.calls[0]?.[0] ?? []) as Array<{ id: string }>
    expect(walked.map((x) => x.id).sort()).toEqual(["cut", "plan"])
  })

  it("the same chain with the render Final is still refused (nothing gates it)", async () => {
    mockNodes = [PLAN, n("cut", "apply-edl", { quality: "final" }), TR, CAPS, SUB]
    mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: TAIL_EDGES })
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(JSON.stringify(mockToastError.mock.calls)).toMatch(/whisper/)
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })
})

describe("the confirm dialog counts only the nodes the run executes (decided 2026-10-05)", () => {
  it("Run's \"N nodes\" leaves out the gated tail, as the \"N nodes to run\" toast does", async () => {
    const confirmRun = vi.fn().mockResolvedValue(true)
    await handleRun({ ...makeCtx(), confirmRun } as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "all", nodeCount: 2 }))
  })
})

describe("PREVIEW_STOP_RULE_ENABLED off (production until Render final): the editor as before the rule", () => {
  beforeEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  it("a single-node ▶ past a Preview render is not refused", async () => {
    await handleRunSingleNode("cap", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    expect(mockToastError).not.toHaveBeenCalledWith("Render final first — this node runs after the final")
  })

  it("Run flips every executable node to pending", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    const pending = mockMarkNodesStatus.mock.calls.find(([, status]) => status === "pending")
    expect(pending?.[0]).toEqual(["plan", "cut", "cap"])
  })

  it("the confirm dialog counts every executable node", async () => {
    const confirmRun = vi.fn().mockResolvedValue(true)
    await handleRun({ ...makeCtx(), confirmRun } as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "all", nodeCount: 3 }))
  })

  it("the run preflights see the whole set, as before", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    const walked = (mockNestedPreflight.mock.calls[0]?.[0] ?? []) as Array<{ id: string }>
    expect(walked.map((x) => x.id).sort()).toEqual(["cap", "cut", "plan"])
  })
})

// A6.1 — two guards around a review. Both read the canvas, in the one funnel
// every run passes (confirmRunOrAbort).
describe("a render's own ▶ behind Camera Switch, once the plan holds edits (TA19 a)", () => {
  const seg = (inMs: number, outMs: number) => ({ id: `s${inMs}`, inMs, outMs, video: "v" })
  const planEdl = {
    version: 1, clock: "master", sources: [{ id: "v", url: "u", kind: "video" }],
    segments: [seg(0, 10_000), seg(20_000, 30_000)],
    dropped: [{ inMs: 10_000, outMs: 20_000, reason: "silence" }],
  }
  const REVIEWED = n("plan", "edit-plan", {
    generatedJson: planEdl,
    editedEdl: { v: 1, kind: "edl", basis: "WRONG", edl: { segments: [seg(0, 30_000)], dropped: [] } },
  })
  const CAM = n("cam", "camera-switch")
  const MULTICAM_EDGES = [
    { id: "a", source: "plan", target: "cam", targetHandle: "edl" },
    { id: "c", source: "cam", target: "cut", targetHandle: "edl" },
    { id: "b", source: "cut", target: "cap" },
  ]

  async function reviewedPlan() {
    const { editPlanBasis } = await import("@nodaro/shared")
    const edited = (REVIEWED.data.editedEdl as Record<string, unknown>)
    return n("plan", "edit-plan", { generatedJson: planEdl, editedEdl: { ...edited, basis: editPlanBasis(planEdl) } })
  }

  it("refuses with the Update preview pointer, above the skip-confirm shortcut", async () => {
    mockNodes = [await reviewedPlan(), CAM, n("cut", "apply-edl", { quality: "proxy" }), CAP]
    mockEdges = MULTICAM_EDGES
    await handleRunSingleNode("cut", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/Update preview/))
    expect(mockExecuteNode).not.toHaveBeenCalled()
  })

  it("is hidden while the stop-rule flag is off (decided 2026-10-06)", async () => {
    delete window.__NODARO_RUNTIME__
    mockNodes = [await reviewedPlan(), CAM, n("cut", "apply-edl", { quality: "proxy" }), CAP]
    mockEdges = MULTICAM_EDGES
    await handleRunSingleNode("cut", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    expect(mockToastError).not.toHaveBeenCalledWith(expect.stringMatching(/Update preview/))
  })
})

describe("a run that re-executes an Edit Plan holding a review asks first (TA2 item 3)", () => {
  const seg = (inMs: number, outMs: number) => ({ id: `s${inMs}`, inMs, outMs, video: "v" })
  const planEdl = {
    version: 1, clock: "master", sources: [{ id: "v", url: "u", kind: "video" }],
    segments: [seg(0, 10_000)], dropped: [],
  }

  async function reviewed() {
    const { editPlanBasis } = await import("@nodaro/shared")
    return n("plan", "edit-plan", {
      label: "Tighten Plan",
      generatedJson: planEdl,
      editedEdl: { v: 1, kind: "edl", basis: editPlanBasis(planEdl), edl: { segments: [seg(0, 4_000)], dropped: [{ inMs: 4_000, outMs: 10_000, reason: "manual" }] } },
    })
  }

  it("Run names what is lost; declining starts nothing", async () => {
    mockNodes = [await reviewed(), CUT, CAP]
    const askConfirm = vi.fn().mockResolvedValue(false)
    await handleRun({ ...makeCtx(), askConfirm } as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("0 restored, 1 dropped") }))
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("accepting goes on", async () => {
    mockNodes = [await reviewed(), CUT, CAP]
    await handleRun({ ...makeCtx(), askConfirm: vi.fn().mockResolvedValue(true) } as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("a run that does not re-execute the plan asks nothing (Render final never does)", async () => {
    mockNodes = [await reviewed(), CUT, CAP]
    const askConfirm = vi.fn().mockResolvedValue(true)
    await handleRunSingleNode("cap", { ...makeCtx(), askConfirm } as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    expect(askConfirm).not.toHaveBeenCalled()
  })

  it("a plan with no review asks nothing", async () => {
    const askConfirm = vi.fn()
    await handleRun({ ...makeCtx(), askConfirm } as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(askConfirm).not.toHaveBeenCalled()
  })
})

// The server's figure for a run set's UGC part (Nodaro Cloud): the confirmation and the balance gate price with it.
describe("a run that holds UGC nodes is priced with the server's figure", () => {
  const ugcChain = (targetDurationSec: number, clip: Record<string, unknown> = {}): TestNode[] => [
    n("script", "ugc-script", { targetDurationSec }),
    n("creator", "ugc-creator", { source: "sampled", gender: "woman" }),
    n("clips", "ugc-clips"), n("clip", "ugc-clip", { rerender: {}, ...clip }), n("cards", "ugc-cards"),
    n("join", "combine-videos", { transition: "cut" }), n("captions", "add-captions"),
    n("out", "preview"),
  ]
  const UGC_EDGES = [
    { id: "1", source: "script", target: "creator", targetHandle: "category" },
    { id: "2", source: "script", target: "clips", targetHandle: "plan" },
    { id: "3", source: "creator", target: "clips", targetHandle: "creator" },
    { id: "4", source: "clips", target: "clip", targetHandle: "clip" },
    { id: "5", source: "clip", target: "join", targetHandle: "in" },
    { id: "6", source: "join", target: "cards", targetHandle: "video" },
    { id: "7", source: "cards", target: "captions", sourceHandle: "captionPlan", targetHandle: "captionPlan" },
    { id: "8", source: "join", target: "captions", targetHandle: "in" },
    { id: "9", source: "captions", target: "out", targetHandle: "in" },
    // UGC Cards reads the video's plan, its transcript and the clip's notes, as the template wires them.
    { id: "10", source: "clips", target: "cards", sourceHandle: "plan-out", targetHandle: "plan" },
    { id: "11", source: "clips", target: "cards", sourceHandle: "transcript", targetHandle: "transcript" },
    { id: "12", source: "clip", target: "cards", targetHandle: "notes" },
  ]
  const PARTS = { script: 22, creator: 41, clip: 1503, cards: 57, join: 11, overlay: 0, captions: 55 }
  /** What each part holds while the clips render: each clip twice, at the longest length. */
  const HOLD = { ...PARTS, clip: 2 * 1803 }
  const ANSWER = { lines: [], expected: 1689, ceiling: 3200, range: [1400, 2000], worstCase: 3800, parts: PARTS, holdParts: HOLD }
  /** A toolbar Run: every part this chain has. */
  const SERVER_RUN = PARTS.script + PARTS.creator + PARTS.clip + PARTS.cards + PARTS.join + PARTS.captions
  /** What it holds while its clips render. */
  const SERVER_HOLD = SERVER_RUN - PARTS.clip + HOLD.clip
  /** Run up to here on the Preview at the end: the same nodes. */
  const SERVER_UP_TO_OUT = SERVER_RUN

  function useChain(targetDurationSec: number, clip: Record<string, unknown> = {}) {
    // Each case its own length, so its own estimate: a figure that could not be had is remembered for a minute.
    const nodes = ugcChain(targetDurationSec, clip)
    mockNodes = nodes
    mockEdges = UGC_EDGES
    mockCollapseExpandedClones.mockReturnValue({ nodes, edges: UGC_EDGES })
    mockBuildExecutionLevels.mockReturnValue([nodes])
    return nodes
  }
  const note = async (key: "ugc.price.unchecked" | "ugc.price.holdNote" | "ugc.price.reuseNote" | "ugc.price.holdRequired", vars?: Record<string, unknown>) =>
    (await import("@/lib/i18n")).tx(key, vars as never)

  it("a toolbar Run's confirmation states the server's figure, which the editor's own figure alone would not reach, and what the clips hold", async () => {
    useChain(21)
    mockUgcEstimate.mockResolvedValue(ANSWER)
    const confirmRun = vi.fn().mockResolvedValue(true)
    await handleRun({ ...makeCtx(), confirmRun } as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(mockEstimateRunCredits.mock.results.every((r) => (r.value as number) <= RUN_CONFIRM_CREDITS)).toBe(true)
    expect(SERVER_RUN).toBeGreaterThan(RUN_CONFIRM_CREDITS)
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "all", estimatedCredits: SERVER_RUN, priceNotes: [await note("ugc.price.holdNote")] }))
    expect(confirmRun.mock.calls[0]![0]).not.toHaveProperty("priceUnchecked")
    // Every creator option is priced, as an editor run draws them.
    expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("a UGC Clip that has rendered before: the confirmation adds that unchanged clips are reused at no cost", async () => {
    useChain(27, { __listResults: ["https://cdn.example/c1.mp4"] })
    mockUgcEstimate.mockResolvedValue(ANSWER)
    const confirmRun = vi.fn().mockResolvedValue(false)
    await handleRun({ ...makeCtx(), confirmRun } as never, "p1", "wf-1", vi.fn(), vi.fn())
    // Every clip still counts.
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({
      estimatedCredits: SERVER_RUN,
      priceNotes: [await note("ugc.price.holdNote"), await note("ugc.price.reuseNote")],
    }))
  })

  it("Run up to here asks first once the server's figure crosses the threshold the editor's own figure stays under", async () => {
    useChain(22)
    mockUgcEstimate.mockResolvedValue(ANSWER)
    const confirmRun = vi.fn().mockResolvedValue(false)
    await handleRunUpToHere("out", { ...makeCtx(), confirmRun } as never, "p1", vi.fn(), vi.fn())
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "up-to-here", estimatedCredits: SERVER_UP_TO_OUT }))
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("the balance check compares what the run holds: a balance above its price but below its hold is refused, saying why", async () => {
    useChain(23)
    mockUgcEstimate.mockResolvedValue(ANSWER)
    const balance = { total: SERVER_RUN + 100, tier: "pro" }
    expect(balance.total).toBeLessThan(SERVER_HOLD)
    mockFetchQuery.mockImplementation(async (query: { queryKey: unknown[] }) => {
      if (query.queryKey[0] !== "ugc") return balance
      mockCache.set(JSON.stringify(query.queryKey), ANSWER)
      return ANSWER
    })
    const ctx = makeCtx()
    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith({
      required: SERVER_HOLD,
      available: SERVER_RUN + 100,
      tier: "pro",
      note: await note("ugc.price.holdRequired", { credits: SERVER_RUN }),
    })
    expect(ctx.setShowInsufficientCredits).toHaveBeenCalledWith(true)
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    // The check read the figure the confirmation priced: one ask.
    expect(mockFetchQuery.mock.calls.filter(([q]) => (q as { queryKey: unknown[] }).queryKey[0] === "ugc")).toHaveLength(1)
  })

  it("a balance that covers the hold runs", async () => {
    useChain(28)
    mockUgcEstimate.mockResolvedValue(ANSWER)
    mockFetchQuery.mockImplementation(async (query: { queryKey: unknown[] }) => {
      if (query.queryKey[0] !== "ugc") return { total: SERVER_HOLD, tier: "pro" }
      mockCache.set(JSON.stringify(query.queryKey), ANSWER)
      return ANSWER
    })
    const ctx = makeCtx()
    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("the server's figure not to be had: the confirmation says so, with no price in its title, and the check uses the editor's figure without asking again", async () => {
    useChain(24)
    mockUgcEstimate.mockRejectedValue(new Error("503"))
    const confirmRun = vi.fn().mockResolvedValue(true)
    const ctx = { ...makeCtx(), confirmRun }
    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({
      priceUnchecked: true,
      priceNotes: [await note("ugc.price.unchecked"), await note("ugc.price.holdNote")],
      estimatedCredits: 10,
    }))
    expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
    expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("a price that could not be checked always asks first, below the threshold too", async () => {
    useChain(25)
    mockUgcEstimate.mockRejectedValue(new Error("503"))
    const confirmRun = vi.fn().mockResolvedValue(false)
    await handleRunUpToHere("out", { ...makeCtx(), confirmRun } as never, "p1", vi.fn(), vi.fn())
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "up-to-here", priceUnchecked: true, estimatedCredits: 10 }))
    expect(mockToastInfo).not.toHaveBeenCalledWith(await note("ugc.price.unchecked"))
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("a run that skips its confirmation (the Copilot's card, Run instead) still asks first when the price could not be checked", async () => {
    useChain(26)
    mockUgcEstimate.mockRejectedValue(new Error("503"))
    const confirmRun = vi.fn().mockResolvedValue(false)
    await handleRun({ ...makeCtx(), confirmRun } as never, "p1", "wf-1", vi.fn(), vi.fn(), undefined, undefined, { skipConfirm: true })
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "all", priceUnchecked: true }))
    // Declined: nothing ran, nothing was marked.
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
  })

  it("a run that skips its confirmation, its price checked: no question", async () => {
    useChain(29)
    mockUgcEstimate.mockResolvedValue(ANSWER)
    const confirmRun = vi.fn().mockResolvedValue(true)
    await handleRun({ ...makeCtx(), confirmRun } as never, "p1", "wf-1", vi.fn(), vi.fn(), undefined, undefined, { skipConfirm: true })
    expect(confirmRun).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("▶ on UGC Clip with the price not to be had: asks first (the editor's own figure for it is next to nothing)", async () => {
    useChain(30)
    mockUgcEstimate.mockRejectedValue(new Error("503"))
    mockEstimateRunCredits.mockReturnValue(0)
    const confirmRun = vi.fn().mockResolvedValue(false)
    await handleRunSingleNode("clip", { ...makeCtx(), confirmRun } as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "single", priceUnchecked: true, estimatedCredits: 0 }))
    expect(mockExecuteNode).not.toHaveBeenCalled()
  })

  it("a ▶ whose confirmation is declined answers that it did not start; one that runs answers that it did", async () => {
    useChain(36)
    mockUgcEstimate.mockRejectedValue(new Error("503"))
    mockEstimateRunCredits.mockReturnValue(0)
    const declined = await handleRunSingleNode("clip", { ...makeCtx(), confirmRun: vi.fn().mockResolvedValue(false) } as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    expect(declined).toBe(false)
    expect(mockExecuteNode).not.toHaveBeenCalled()
    const ran = await handleRunSingleNode("clip", { ...makeCtx(), confirmRun: vi.fn().mockResolvedValue(true) } as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    expect(ran).toBe(true)
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
  })

  it("a ▶ whose confirmation is open when the editor goes away settles, and the next editor's ▶ asks again", async () => {
    useChain(37)
    mockUgcEstimate.mockRejectedValue(new Error("503"))
    mockEstimateRunCredits.mockReturnValue(0)
    const first = renderHook(() => useRunConfirm())
    const asked: unknown[] = []
    const started = handleRunSingleNode("clip", { ...makeCtx(), confirmRun: (info: unknown) => (asked.push(info), first.result.current.confirmRun(info as never)) } as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    first.unmount()
    expect(await started).toBe(false)
    expect(mockExecuteNode).not.toHaveBeenCalled()
    // The node's ▶ is free: the next editor's click asks again.
    const second = renderHook(() => useRunConfirm())
    const askedAgain: unknown[] = []
    const again = handleRunSingleNode("clip", { ...makeCtx(), confirmRun: (info: unknown) => (askedAgain.push(info), second.result.current.confirmRun(info as never)) } as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    await vi.waitFor(() => expect(askedAgain).toHaveLength(1))
    second.unmount()
    expect(await again).toBe(false)
  })

  it("a ▶ still being priced when the editor goes away settles once the price fails, and the next editor's ▶ asks again", async () => {
    useChain(38)
    let fail!: (err: unknown) => void
    mockUgcEstimate.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject })).mockRejectedValue(new Error("503"))
    mockEstimateRunCredits.mockReturnValue(0)
    const first = renderHook(() => useRunConfirm())
    const asked: unknown[] = []
    const started = handleRunSingleNode("clip", { ...makeCtx(), confirmRun: (info: unknown) => (asked.push(info), first.result.current.confirmRun(info as never)) } as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    await vi.waitFor(() => expect(mockUgcEstimate).toHaveBeenCalledTimes(1))
    first.unmount()
    fail(new Error("503"))
    // Asked of an editor that is gone: answered no at once.
    expect(await started).toBe(false)
    expect(asked).toHaveLength(1)
    const second = renderHook(() => useRunConfirm())
    const askedAgain: unknown[] = []
    const again = handleRunSingleNode("clip", { ...makeCtx(), confirmRun: (info: unknown) => (askedAgain.push(info), second.result.current.confirmRun(info as never)) } as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    await vi.waitFor(() => expect(askedAgain).toHaveLength(1))
    second.unmount()
    expect(await again).toBe(false)
  })

  it("the editor's teardown frees a node's ▶; an older click that lands after it never runs, and never frees the newer one", async () => {
    useChain(39)
    const parts = { script: 22, creator: 41, clip: 1503, cards: 57, join: 11, overlay: 0, captions: 55 }
    const answer = { lines: [], expected: 9, ceiling: 9, range: [9, 9], worstCase: 9, parts, holdParts: parts }
    let landFirst!: (v: unknown) => void
    let landSecond!: (v: unknown) => void
    mockUgcEstimate
      .mockReturnValueOnce(new Promise((resolve) => { landFirst = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { landSecond = resolve }))
    const confirmRun = vi.fn().mockResolvedValue(true)
    const ctx = () => ({ ...makeCtx(), confirmRun }) as never
    const first = handleRunSingleNode("clip", ctx(), "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    await vi.waitFor(() => expect(mockUgcEstimate).toHaveBeenCalledTimes(1))
    releaseSingleRunGuards()
    // A click after the teardown is a click of its own.
    const second = handleRunSingleNode("clip", ctx(), "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    await vi.waitFor(() => expect(mockUgcEstimate).toHaveBeenCalledTimes(2))
    landFirst(answer)
    // Its editor went away while it waited: it ends there, and runs nothing.
    expect(await first).toBe(false)
    expect(mockExecuteNode).not.toHaveBeenCalled()
    // The newer click still holds the node: a third ▶ is that same click.
    const third = handleRunSingleNode("clip", ctx(), "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    landSecond(answer)
    expect(await second).toBe(true)
    expect(await third).toBe(true)
    expect(mockUgcEstimate).toHaveBeenCalledTimes(2)
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
  })

  it("a ▶ whose editor is torn down during the price wait never runs; the next editor's ▶ runs once", async () => {
    useChain(42)
    const answer = { lines: [], expected: 9, ceiling: 9, range: [9, 9], worstCase: 9, parts: PARTS, holdParts: PARTS }
    let landFirst!: (v: unknown) => void
    mockUgcEstimate.mockReturnValueOnce(new Promise((resolve) => { landFirst = resolve })).mockResolvedValue(answer)
    let gone = false
    const first = handleRunSingleNode("clip", { ...makeCtx(), isWorkflowStale: () => gone } as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    await vi.waitFor(() => expect(mockUgcEstimate).toHaveBeenCalledTimes(1))
    // The editor is torn down: its context goes stale and its clicks' hold on the nodes is released.
    gone = true
    releaseSingleRunGuards()
    const second = handleRunSingleNode("clip", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    expect(await second).toBe(true)
    landFirst(answer)
    expect(await first).toBe(false)
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
    expect(mockMarkNodesStatus.mock.calls.filter(([, status]) => status === "pending")).toHaveLength(1)
  })

  describe("the server's figure lands while the could-not-be-checked confirmation is open", () => {
    // The estimate answers at 6 s, past the 5 s wait; the person confirms at 15 s.
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    async function runConfirmedLate(balanceTotal: number) {
      mockUgcEstimate.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(ANSWER), 6_000)))
      mockFetchQuery.mockImplementation(async (query: { queryKey: unknown[] }) => {
        if (query.queryKey[0] !== "ugc") return { total: balanceTotal, tier: "pro" }
        const data = await mockUgcEstimate()
        mockCache.set(JSON.stringify(query.queryKey), data)
        return data
      })
      const confirmRun = vi.fn(() => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10_000)))
      const ctx = { ...makeCtx(), confirmRun }
      const run = handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())
      await vi.advanceTimersByTimeAsync(16_000)
      await run
      // The confirmation priced without the server's answer, saying so.
      expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ priceUnchecked: true }))
      return ctx
    }

    it("a balance between the price and the hold is refused on the server's figure, with no second ask", async () => {
      useChain(40)
      const ctx = await runConfirmedLate(SERVER_RUN + 100)
      expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith({
        required: SERVER_HOLD,
        available: SERVER_RUN + 100,
        tier: "pro",
        note: await note("ugc.price.holdRequired", { credits: SERVER_RUN }),
      })
      expect(mockRunWorkflow).not.toHaveBeenCalled()
      expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
    })

    it("a balance below the price itself is refused the same way", async () => {
      useChain(41)
      const ctx = await runConfirmedLate(SERVER_RUN - 100)
      expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith(expect.objectContaining({ required: SERVER_HOLD, available: SERVER_RUN - 100 }))
      expect(mockRunWorkflow).not.toHaveBeenCalled()
      expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
    })
  })

  it("where no dialog can show, a toast says the price could not be checked and the run goes on", async () => {
    useChain(31)
    mockUgcEstimate.mockRejectedValue(new Error("503"))
    await handleRunUpToHere("out", makeCtx() as never, "p1", vi.fn(), vi.fn())
    expect(mockToastInfo).toHaveBeenCalledWith(await note("ugc.price.unchecked"))
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("nothing is marked pending while the price is still on its way", async () => {
    useChain(32)
    let land!: (v: unknown) => void
    mockUgcEstimate.mockReturnValue(new Promise((resolve) => { land = resolve }))
    const started = handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn(), undefined, undefined, { skipConfirm: true })
    await vi.waitFor(() => expect(mockUgcEstimate).toHaveBeenCalled())
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
    land(ANSWER)
    await started
    expect(mockMarkNodesStatus).toHaveBeenCalledWith(expect.any(Array), "pending")
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("where the balance check stands down (a payer's allowance not enforced), nothing is priced for it", async () => {
    useChain(33)
    mockUgcEstimate.mockResolvedValue(ANSWER)
    mockFetchQuery.mockImplementation(async (query: { queryKey: unknown[] }) => {
      if (query.queryKey[0] !== "ugc") return { total: 0, tier: "pro", allowance: { enforced: false, remaining: 0 } }
      const data = await mockUgcEstimate()
      mockCache.set(JSON.stringify(query.queryKey), data)
      return data
    })
    const ctx = makeCtx()
    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn(), undefined, undefined, { skipConfirm: true })
    expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
    // Only the confirmation's own ask, before anything was marked.
    expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
    // A run with no UGC part prices nothing at all there.
    vi.clearAllMocks()
    detachActiveWorkflowStream()
    mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
    mockNodes = [n("img", "generate-image")]
    mockEdges = []
    mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: [] })
    mockBuildExecutionLevels.mockReturnValue([mockNodes])
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn(), undefined, undefined, { skipConfirm: true })
    expect(mockEstimateRunCredits).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  // Every other path that starts a run checks one with a UGC part against what it holds, with the toolbar Run's own
  // check: the figure its confirmation priced (or the server's, landed after it), the hold, the same refusal.
  describe("Run from here, Run up to here, Run selected and a node's ▶ check a UGC run's balance against its hold", () => {
    interface Path {
      readonly name: string
      readonly start: (ctx: object) => Promise<unknown>
      /** The server's price for what the path executes, and what that holds while the clips render. */
      readonly price: number
      readonly hold: number
      readonly started: () => boolean
    }
    const pollRef = () => ({ current: new Set() }) as never
    const selectAll = () => {
      mockNodes = mockNodes.map((x) => ({ ...x, selected: true }))
      mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: mockEdges })
    }
    const serverRun = () => mockRunWorkflow.mock.calls.length > 0
    const PATHS: Path[] = [
      { name: "Run from here", start: (ctx) => handleRunFromHere("script", ctx as never, "p1", vi.fn(), mockSetIsRunning), price: SERVER_RUN, hold: SERVER_HOLD, started: serverRun },
      { name: "Run up to here", start: (ctx) => handleRunUpToHere("out", ctx as never, "p1", vi.fn(), mockSetIsRunning), price: SERVER_UP_TO_OUT, hold: SERVER_HOLD, started: serverRun },
      { name: "Run selected", start: (ctx) => { selectAll(); return handleRunSelected(ctx as never, "p1", vi.fn(), mockSetIsRunning) }, price: SERVER_RUN, hold: SERVER_HOLD, started: serverRun },
      // The clip's part alone: price and hold both the server's, the hold above the price.
      { name: "a node's ▶", start: (ctx) => handleRunSingleNode("clip", ctx as never, "p1", vi.fn(), mockSetIsRunning, pollRef()), price: PARTS.clip, hold: HOLD.clip, started: () => mockExecuteNode.mock.calls.length > 0 },
    ]
    /** A refused run touched nothing: no manual edit rejected, no clone collapsed (it marks the workflow unsaved), no node written, nothing marked or busy. */
    const expectNothingTouched = () => {
      expect(mockRejectAllManualEdits).not.toHaveBeenCalled()
      expect(mockCollapseExpandedClones).not.toHaveBeenCalled()
      expect(mockUpdateNodeData).not.toHaveBeenCalled()
      expect(mockSetIsRunning).not.toHaveBeenCalled()
      expect(mockMarkNodesStatus).not.toHaveBeenCalled()
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
    const balanceAsks = () => mockFetchQuery.mock.calls.filter(([q]) => (q as { queryKey: unknown[] }).queryKey[0] === "credits").length

    it.each(PATHS.map((p, i) => ({ ...p, len: 50 + i })))("$name: a balance between the price and the hold is refused on the server's hold, saying why", async (path) => {
      useChain(path.len)
      mockUgcEstimate.mockResolvedValue(ANSWER)
      balanceOf(path.price + 100)
      const confirmRun = vi.fn().mockResolvedValue(true)
      const ctx = { ...makeCtx(), confirmRun }
      await path.start(ctx)
      // The confirmation quoted the server's price and what the clips hold.
      expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ estimatedCredits: path.price, priceNotes: [await note("ugc.price.holdNote")] }))
      expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith({
        required: path.hold,
        available: path.price + 100,
        tier: "pro",
        note: await note("ugc.price.holdRequired", { credits: path.price }),
      })
      expect(ctx.setShowInsufficientCredits).toHaveBeenCalledWith(true)
      expect(path.started()).toBe(false)
      // One ask: the check read the figure the confirmation priced.
      expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
      // Checked before anything is touched: a refused run has nothing to put back.
      expectNothingTouched()
      // Checked before the linked videos are fetched: a refused run never waits for a download.
      expect(mockEnsureVideoLinks).not.toHaveBeenCalled()
    })

    it.each(PATHS.map((p, i) => ({ ...p, len: 54 + i })))("$name: a balance that covers the hold runs, with one ask", async (path) => {
      useChain(path.len)
      mockUgcEstimate.mockResolvedValue(ANSWER)
      balanceOf(path.hold)
      const ctx = makeCtx()
      await path.start(ctx)
      expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
      expect(path.started()).toBe(true)
      expect(balanceAsks()).toBe(1)
      expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
      // A run that goes ahead fetches its linked videos, after the check.
      expect(mockEnsureVideoLinks).toHaveBeenCalledTimes(1)
      expect(mockFetchQuery.mock.invocationCallOrder.at(-1)!).toBeLessThan(mockEnsureVideoLinks.mock.invocationCallOrder[0]!)
    })

    describe("the server's figure lands while the could-not-be-checked confirmation is open", () => {
      // The estimate answers at 6 s, past the 5 s wait; the person confirms at 15 s.
      beforeEach(() => { vi.useFakeTimers() })
      afterEach(() => { vi.useRealTimers() })

      it.each(PATHS.map((p, i) => ({ ...p, len: 58 + i })))("$name checks the balance against the server's hold", async (path) => {
        useChain(path.len)
        mockUgcEstimate.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(ANSWER), 6_000)))
        balanceOf(path.price + 100)
        const confirmRun = vi.fn(() => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10_000)))
        const ctx = { ...makeCtx(), confirmRun }
        const run = path.start(ctx)
        await vi.advanceTimersByTimeAsync(16_000)
        await run
        // The confirmation priced without the server's answer, saying so.
        expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ priceUnchecked: true }))
        expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith({
          required: path.hold,
          available: path.price + 100,
          tier: "pro",
          note: await note("ugc.price.holdRequired", { credits: path.price }),
        })
        expect(path.started()).toBe(false)
        expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
        expectNothingTouched()
        expect(mockEnsureVideoLinks).not.toHaveBeenCalled()
      })

      it.each(PATHS.map((p, i) => ({ ...p, len: 66 + i })))("$name checks the run as it was clicked, though the canvas changed while the question was open", async (path) => {
        useChain(path.len)
        mockUgcEstimate.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(ANSWER), 6_000)))
        balanceOf(path.price + 100)
        // While the question is open the script's plan wire is removed: read on the canvas as it is now, the run has no
        // UGC video to price, and the editor's own figure for it would pass.
        const confirmRun = vi.fn(() => new Promise<boolean>((resolve) => setTimeout(() => {
          mockEdges = (mockEdges as Array<{ id: string }>).filter((e) => e.id !== "2")
          resolve(true)
        }, 10_000)))
        const ctx = { ...makeCtx(), confirmRun }
        const run = path.start(ctx)
        await vi.advanceTimersByTimeAsync(16_000)
        await run
        expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith(expect.objectContaining({ required: path.hold }))
        expect(path.started()).toBe(false)
      })
    })

    it("a ▶ the check refuses did not start, and frees the node: the next ▶ asks again", async () => {
      useChain(62)
      mockUgcEstimate.mockResolvedValue(ANSWER)
      let total = PARTS.clip + 100
      balanceOf(() => total)
      expect(await handleRunSingleNode("clip", makeCtx() as never, "p1", vi.fn(), vi.fn(), pollRef())).toBe(false)
      expect(mockExecuteNode).not.toHaveBeenCalled()
      total = HOLD.clip
      const ctx = makeCtx()
      expect(await handleRunSingleNode("clip", ctx as never, "p1", vi.fn(), vi.fn(), pollRef())).toBe(true)
      expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
      expect(mockExecuteNode).toHaveBeenCalledTimes(1)
      expect(balanceAsks()).toBe(2)
      expect(mockUgcEstimate).toHaveBeenCalledTimes(1)
    })
  })

  // A click whose editor leaves its workflow while it waits — torn down, or switched in place to another — ends there,
  // quietly: what it would have flipped, reset, saved or started belongs to a workflow nobody is looking at.
  describe.each(LEAVES)("Run, Run from here, Run up to here, Run selected and a node's ▶ whose editor $leaves while they wait never flip or run", ({ editor, base }) => {
    /** A promise and the hand that settles it. */
    function held<T>() {
      let settle!: (v: T) => void
      const promise = new Promise<T>((resolve) => { settle = resolve })
      return { promise, settle }
    }
    const selectAll = () => {
      mockNodes = mockNodes.map((x) => ({ ...x, selected: true }))
      mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: mockEdges })
    }
    const mockSave = vi.fn()
    const START = [
      { name: "Run", start: (ctx: never) => handleRun(ctx, "p1", "wf-1", mockSave, mockSetIsRunning) },
      { name: "Run from here", start: (ctx: never) => handleRunFromHere("script", ctx, "p1", mockSave, mockSetIsRunning) },
      { name: "Run up to here", start: (ctx: never) => handleRunUpToHere("out", ctx, "p1", mockSave, mockSetIsRunning) },
      { name: "Run selected", start: (ctx: never) => { selectAll(); return handleRunSelected(ctx, "p1", mockSave, mockSetIsRunning) } },
      { name: "a node's ▶", start: (ctx: never) => handleRunSingleNode("clip", ctx, "p1", mockSave, mockSetIsRunning, { current: new Set() } as never) },
    ]
    /** The balance read held open: the toolbar Run's check, after its optimistic flip; every other path's, before anything. */
    function heldBalance() {
      const wait = held<unknown>()
      mockFetchQuery.mockImplementation(async (query: { queryKey: unknown[] }) => {
        if (query.queryKey[0] !== "ugc") return wait.promise
        const data = await mockUgcEstimate()
        mockCache.set(JSON.stringify(query.queryKey), data)
        return data
      })
      return wait
    }
    const pendingFlips = () => mockMarkNodesStatus.mock.calls.filter(([, status]) => status === "pending").length
    /** Nothing touched since `before` calls to markNodesStatus: no flip, reset, rollback, save or run. */
    function expectNothingAfter(before: number) {
      expect(mockMarkNodesStatus.mock.calls.length).toBe(before)
      expect(mockRejectAllManualEdits).not.toHaveBeenCalled()
      expect(mockUpdateNodeData).not.toHaveBeenCalled()
      expect(mockSave).not.toHaveBeenCalled()
      expect(mockRunWorkflow).not.toHaveBeenCalled()
      expect(mockExecuteNode).not.toHaveBeenCalled()
    }

    it.each(START.map((p, i) => ({ ...p, len: base + i })))("$name, while its confirmation is open, answered yes as it left", async (path) => {
      useChain(path.len)
      mockUgcEstimate.mockResolvedValue(ANSWER)
      const answer = held<boolean>()
      const asked = vi.fn(() => answer.promise)
      const { ctx, leave } = editor({ confirmRun: asked })
      const run = path.start(ctx)
      await vi.waitFor(() => expect(asked).toHaveBeenCalledTimes(1))
      leave()
      answer.settle(true)
      await run
      expect(pendingFlips()).toBe(0)
      expectNothingAfter(0)
      expect(mockEnsureVideoLinks).not.toHaveBeenCalled()
    })

    it.each(START.map((p, i) => ({ ...p, len: base + 5 + i })))("$name, while the price is on its way", async (path) => {
      useChain(path.len)
      const price = held<unknown>()
      mockUgcEstimate.mockReturnValue(price.promise)
      const { ctx, leave } = editor({ confirmRun: vi.fn().mockResolvedValue(true) })
      const run = path.start(ctx)
      await vi.waitFor(() => expect(mockUgcEstimate).toHaveBeenCalledTimes(1))
      leave()
      price.settle(ANSWER)
      await run
      expect(pendingFlips()).toBe(0)
      expectNothingAfter(0)
      expect(mockEnsureVideoLinks).not.toHaveBeenCalled()
    })

    it.each(START.map((p, i) => ({ ...p, len: base + 10 + i })))("$name, while a linked video is fetched", async (path) => {
      useChain(path.len)
      mockUgcEstimate.mockResolvedValue(ANSWER)
      const fetched = held<boolean>()
      mockEnsureVideoLinks.mockReturnValueOnce(fetched.promise)
      const { ctx, leave } = editor({ confirmRun: vi.fn().mockResolvedValue(true) })
      const run = path.start(ctx)
      await vi.waitFor(() => expect(mockEnsureVideoLinks).toHaveBeenCalledTimes(1))
      leave()
      fetched.settle(true)
      await run
      expect(pendingFlips()).toBe(0)
      expectNothingAfter(0)
    })

    it.each(START.map((p, i) => ({ ...p, len: base + 15 + i })))("$name, while its balance is read", async (path) => {
      useChain(path.len)
      mockUgcEstimate.mockResolvedValue(ANSWER)
      const balance = heldBalance()
      const { ctx, leave } = editor({ confirmRun: vi.fn().mockResolvedValue(true) })
      const run = path.start(ctx)
      await vi.waitFor(() => expect(mockFetchQuery.mock.calls.some(([q]) => (q as { queryKey: unknown[] }).queryKey[0] === "credits")).toBe(true))
      // The toolbar Run flips before its check, as it always has; nothing is touched after the editor leaves.
      const flippedBefore = mockMarkNodesStatus.mock.calls.length
      leave()
      balance.settle({ total: 1_000_000, tier: "pro" })
      await run
      expect(mockMarkNodesStatus.mock.calls.length).toBe(flippedBefore)
      expect(mockSave).not.toHaveBeenCalled()
      expect(mockRunWorkflow).not.toHaveBeenCalled()
      expect(mockExecuteNode).not.toHaveBeenCalled()
      expect(mockEnsureVideoLinks).toHaveBeenCalledTimes(path.name === "Run" ? 1 : 0)
    })

    it.each(START)("$name, while the nested check is out", async (path) => {
      useChain(base + 4)
      mockUgcEstimate.mockResolvedValue(ANSWER)
      const check = held<string | null>()
      mockNestedPreflight.mockReturnValueOnce(check.promise)
      const { ctx, leave } = editor({ confirmRun: vi.fn().mockResolvedValue(true) })
      const run = path.start(ctx)
      await vi.waitFor(() => expect(mockNestedPreflight).toHaveBeenCalledTimes(1))
      leave()
      check.settle(null)
      await run
      expect(pendingFlips()).toBe(0)
      expectNothingAfter(0)
      expect(mockUgcEstimate).not.toHaveBeenCalled()
    })
  })

  // The other way round: a click whose editor stays on its workflow runs, however the canvas moved while it waited
  // (a collaborator's graph adopted, an edit) — its liveness is the workflow it was started on, nothing else.
  describe("Run, Run from here, Run up to here, Run selected and a node's ▶ whose editor stays on its workflow run", () => {
    function held<T>() {
      let settle!: (v: T) => void
      const promise = new Promise<T>((resolve) => { settle = resolve })
      return { promise, settle }
    }
    const selectAll = () => {
      mockNodes = mockNodes.map((x) => ({ ...x, selected: true }))
      mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: mockEdges })
    }
    /** The click's run, started once: on the server for the workflow it was clicked on, or the node's own. */
    const serverRun = () => mockRunWorkflow.mock.calls.length === 1 && mockRunWorkflow.mock.calls[0]![0] === "wf-1"
    const START = [
      { name: "Run", start: (ctx: never) => handleRun(ctx, "p1", "wf-1", vi.fn(), vi.fn()), started: serverRun },
      { name: "Run from here", start: (ctx: never) => handleRunFromHere("script", ctx, "p1", vi.fn(), vi.fn()), started: serverRun },
      { name: "Run up to here", start: (ctx: never) => handleRunUpToHere("out", ctx, "p1", vi.fn(), vi.fn()), started: serverRun },
      { name: "Run selected", start: (ctx: never) => { selectAll(); return handleRunSelected(ctx, "p1", vi.fn(), vi.fn()) }, started: serverRun },
      { name: "a node's ▶", start: (ctx: never) => handleRunSingleNode("clip", ctx, "p1", vi.fn(), vi.fn(), { current: new Set() } as never), started: () => mockExecuteNode.mock.calls.length === 1 },
    ]

    it.each(START.map((p, i) => ({ ...p, len: 140 + i })))("$name, the canvas changed while the price was on its way", async (path) => {
      useChain(path.len)
      const price = held<unknown>()
      mockUgcEstimate.mockReturnValue(price.promise)
      const { ctx } = LEAVES[1]!.editor({ confirmRun: vi.fn().mockResolvedValue(true) })
      const run = path.start(ctx)
      await vi.waitFor(() => expect(mockUgcEstimate).toHaveBeenCalledTimes(1))
      // The same workflow, its graph replaced while the click waited: new node objects, the same ids.
      mockNodes = mockNodes.map((x) => ({ ...x, data: { ...x.data, label: `${x.id} (adopted)` } }))
      mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: mockEdges })
      price.settle(ANSWER)
      await run
      expect(path.started()).toBe(true)
    })
  })
})

describe("a run with no UGC part on Run from here, Run up to here, Run selected or a node's ▶ starts as it always did", () => {
  const IMG1 = n("img1", "generate-image")
  const IMG2 = n("img2", "generate-image")
  const IMG_EDGES = [{ id: "i", source: "img1", target: "img2" }]
  const pollRef = () => ({ current: new Set() }) as never
  const selectAll = () => {
    mockNodes = mockNodes.map((x) => ({ ...x, selected: true }))
    mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: mockEdges })
  }
  const PATHS: Array<{ name: string; start: (ctx: object) => Promise<unknown>; started: () => boolean }> = [
    { name: "Run from here", start: (ctx) => handleRunFromHere("img1", ctx as never, "p1", vi.fn(), vi.fn()), started: () => mockRunWorkflow.mock.calls.length > 0 },
    { name: "Run up to here", start: (ctx) => handleRunUpToHere("img2", ctx as never, "p1", vi.fn(), vi.fn()), started: () => mockRunWorkflow.mock.calls.length > 0 },
    { name: "Run selected", start: (ctx) => { selectAll(); return handleRunSelected(ctx as never, "p1", vi.fn(), vi.fn()) }, started: () => mockRunWorkflow.mock.calls.length > 0 },
    { name: "a node's ▶", start: (ctx) => handleRunSingleNode("img1", ctx as never, "p1", vi.fn(), vi.fn(), pollRef()), started: () => mockExecuteNode.mock.calls.length > 0 },
  ]

  it.each(PATHS)("$name: no balance check and no estimate, even where the balance is below its price", async (path) => {
    mockNodes = [IMG1, IMG2]
    mockEdges = IMG_EDGES
    mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: IMG_EDGES })
    mockBuildExecutionLevels.mockReturnValue([[IMG1], [IMG2]])
    mockEstimateRunCredits.mockReturnValue(500)
    mockFetchQuery.mockImplementation(async () => ({ total: 100, tier: "pro" }))
    const ctx = makeCtx()
    await path.start(ctx)
    expect(path.started()).toBe(true)
    expect(mockFetchQuery).not.toHaveBeenCalled()
    expect(mockUgcEstimate).not.toHaveBeenCalled()
    expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
  })
})

describe("Render final over a set holding UGC nodes", () => {
  // A render between the clips' join and UGC Cards: its Render final runs the cards and the captions after it.
  const nodes: TestNode[] = [
    n("script", "ugc-script", { targetDurationSec: 35 }), n("creator", "ugc-creator", { source: "sampled" }),
    n("clips", "ugc-clips"), n("clip", "ugc-clip", { rerender: {} }), n("cards", "ugc-cards"),
    n("join", "combine-videos"), n("cut", "apply-edl", { quality: "final" }), n("captions", "add-captions"),
  ]
  const edges = [
    { id: "1", source: "script", target: "clips", targetHandle: "plan" },
    { id: "2", source: "creator", target: "clips", targetHandle: "creator" },
    { id: "3", source: "clips", target: "clip", targetHandle: "clip" },
    { id: "4", source: "clip", target: "join", targetHandle: "in" },
    { id: "5", source: "join", target: "cut", targetHandle: "in" },
    { id: "6", source: "cut", target: "cards", targetHandle: "video" },
    { id: "7", source: "clips", target: "cards", sourceHandle: "plan-out", targetHandle: "plan" },
    { id: "8", source: "clip", target: "cards", targetHandle: "notes" },
    { id: "9", source: "cards", target: "captions", sourceHandle: "captionPlan", targetHandle: "captionPlan" },
    { id: "10", source: "cut", target: "captions", targetHandle: "in" },
  ]
  const exec = ["cut", "cards", "captions"].map((id) => nodes.find((x) => x.id === id)!)
  const parts = { script: 20, creator: 41, clip: 1503, cards: 57, join: 11, overlay: 0, captions: 55 }

  beforeEach(() => {
    mockNodes = nodes
    mockEdges = edges
  })

  it("its lines carry the server's figure for each UGC node, and add up to the run's one figure", async () => {
    mockUgcEstimate.mockResolvedValue({ lines: [], expected: 1, ceiling: 1, range: [1, 1], worstCase: 1, parts, holdParts: parts })
    const confirmRun = vi.fn().mockResolvedValue(true)
    expect(await confirmRunOrAbort({ ...makeCtx(), confirmRun } as never, exec as never, nodes as never, edges as never, "render-final", true, false, "cut")).toBe(true)
    const info = confirmRun.mock.calls[0]![0] as { lines: Array<{ nodeId: string; credits: number }>; estimatedCredits: number }
    expect(info.lines.map((l) => [l.nodeId, l.credits])).toEqual([["cut", 10], ["cards", 57], ["captions", 55]])
    expect(info.estimatedCredits).toBe(10 + 57 + 55)
    expect(info).not.toHaveProperty("priceUnchecked")
  })

  it("the price not to be had: the editor's own lines, said so", async () => {
    mockUgcEstimate.mockRejectedValue(new Error("503"))
    const confirmRun = vi.fn().mockResolvedValue(true)
    await confirmRunOrAbort({ ...makeCtx(), confirmRun } as never, exec as never, nodes as never, edges as never, "render-final", true, false, "cut")
    const { tx } = await import("@/lib/i18n")
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ estimatedCredits: 10, priceUnchecked: true, priceNotes: [tx("ugc.price.unchecked")] }))
  })
})

describe("a node's ▶ while its first click is still being priced", () => {
  const SCRIPT = n("script", "ugc-script", { targetDurationSec: 34 })
  const OTHER = n("img", "generate-image")

  it("is the same click: one run of that node; another node's ▶ meanwhile still runs", async () => {
    mockNodes = [SCRIPT, OTHER]
    mockEdges = []
    let land!: (v: unknown) => void
    const parts = { script: 20, creator: 0, clip: 0, cards: 0, join: 0, overlay: 0, captions: 0 }
    mockUgcEstimate.mockReturnValue(new Promise((resolve) => { land = resolve }))
    const first = handleRunSingleNode("script", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    await vi.waitFor(() => expect(mockUgcEstimate).toHaveBeenCalledTimes(1))
    // The same click: it starts nothing of its own, and answers how that click ends.
    const second = handleRunSingleNode("script", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    await handleRunSingleNode("img", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    expect(mockExecuteNode.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(["img"])
    land({ lines: [], expected: 20, ceiling: 20, range: [20, 20], worstCase: 20, parts, holdParts: parts })
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(mockExecuteNode.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(["img", "script"])
    // Once it is pending, the node's ▶ is free again: its "Run instead" reaches the handler.
    await handleRunSingleNode("script", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    expect(mockExecuteNode.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(["img", "script", "script"])
  })
})

describe("a run with no UGC part is checked as it always was", () => {
  it("the balance check prices the run again after the confirmation, on the collapsed set", async () => {
    const IMG = n("img", "generate-image")
    mockNodes = [IMG]
    mockEdges = []
    mockCollapseExpandedClones.mockReturnValue({ nodes: [IMG], edges: [] })
    mockBuildExecutionLevels.mockReturnValue([[IMG]])
    // 10 when the run is clicked; 500 by the time it is checked (the price cache warmed up, or a node was added meanwhile).
    let asked = false
    mockEstimateRunCredits.mockImplementation(() => (asked ? 500 : 10))
    const confirmRun = vi.fn(async () => { asked = true; return true })
    mockFetchQuery.mockImplementation(async () => ({ total: 100, tier: "pro" }))
    const ctx = { ...makeCtx(), confirmRun }
    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ estimatedCredits: 10 }))
    expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith({ required: 500, available: 100, tier: "pro" })
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })
})

describe("a node's ▶ whose editor goes away while it waits never flips or runs; the next editor's ▶ runs once", () => {
  /** An editor: its run context, stale once it is torn down (as the real one reads its workflow). */
  function editor(extra: Record<string, unknown> = {}) {
    let gone = false
    return {
      ctx: { ...makeCtx(), isWorkflowStale: () => gone, ...extra } as never,
      tearDown: () => {
        gone = true
        releaseSingleRunGuards()
      },
    }
  }
  /** A promise and the hand that settles it. */
  function held<T>() {
    let settle!: (v: T) => void
    const promise = new Promise<T>((resolve) => { settle = resolve })
    return { promise, settle }
  }
  const pollRef = () => ({ current: new Set() }) as never
  const pendingFlips = () => mockMarkNodesStatus.mock.calls.filter(([, status]) => status === "pending").length

  beforeEach(() => {
    // The render's own ▶: allowed, and priced below the confirmation's threshold.
    mockNodes = [PLAN, CUT, CAP]
    mockEdges = EDGES
  })

  it("torn down during the nested check: the click ends quietly, even when that check would have refused", async () => {
    const wait = held<string | null>()
    mockNestedPreflight.mockReturnValueOnce(wait.promise).mockResolvedValue(null)
    const old = editor()
    const first = handleRunSingleNode("cut", old.ctx, "p1", vi.fn(), vi.fn(), pollRef())
    await vi.waitFor(() => expect(mockNestedPreflight).toHaveBeenCalledTimes(1))
    old.tearDown()
    const second = handleRunSingleNode("cut", editor().ctx, "p1", vi.fn(), vi.fn(), pollRef())
    expect(await second).toBe(true)
    wait.settle("A referenced workflow cannot run.")
    expect(await first).toBe(false)
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
    expect(pendingFlips()).toBe(1)
  })

  it("torn down during the linked-video download", async () => {
    const wait = held<boolean>()
    mockEnsureVideoLinks.mockReturnValueOnce(wait.promise).mockResolvedValue(true)
    const old = editor()
    const first = handleRunSingleNode("cut", old.ctx, "p1", vi.fn(), vi.fn(), pollRef())
    await vi.waitFor(() => expect(mockEnsureVideoLinks).toHaveBeenCalledTimes(1))
    old.tearDown()
    const second = handleRunSingleNode("cut", editor().ctx, "p1", vi.fn(), vi.fn(), pollRef())
    expect(await second).toBe(true)
    wait.settle(true)
    expect(await first).toBe(false)
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
    expect(pendingFlips()).toBe(1)
  })

  it("switched in place to a copy holding the same node ids during the linked-video download: the copy's ▶ of that node is a click of its own, and runs once", async () => {
    const wait = held<boolean>()
    mockEnsureVideoLinks.mockReturnValueOnce(wait.promise).mockResolvedValue(true)
    // One editor, as the real one reads a switch: its ref re-pointed, the copy loaded (LEAVES).
    const { ctx, leave } = LEAVES[1]!.editor()
    const first = handleRunSingleNode("cut", ctx, "p1", vi.fn(), vi.fn(), pollRef())
    await vi.waitFor(() => expect(mockEnsureVideoLinks).toHaveBeenCalledTimes(1))
    // The switch releases the left workflow's in-flight ▶ (workflow-editor-main.tsx).
    leave()
    releaseSingleRunGuards()
    const second = handleRunSingleNode("cut", ctx, "p1", vi.fn(), vi.fn(), pollRef())
    expect(await second).toBe(true)
    wait.settle(true)
    expect(await first).toBe(false)
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
    expect(pendingFlips()).toBe(1)
  })

  it("torn down while its confirmation is open, answered yes as it went away", async () => {
    mockEstimateRunCredits.mockReturnValue(RUN_CONFIRM_CREDITS + 1)
    const answer = held<boolean>()
    const asked = vi.fn(() => answer.promise)
    const old = editor({ confirmRun: asked })
    const first = handleRunSingleNode("cut", old.ctx, "p1", vi.fn(), vi.fn(), pollRef())
    await vi.waitFor(() => expect(asked).toHaveBeenCalledTimes(1))
    old.tearDown()
    const second = handleRunSingleNode("cut", editor({ confirmRun: vi.fn().mockResolvedValue(true) }).ctx, "p1", vi.fn(), vi.fn(), pollRef())
    expect(await second).toBe(true)
    answer.settle(true)
    expect(await first).toBe(false)
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
    expect(pendingFlips()).toBe(1)
  })
})
