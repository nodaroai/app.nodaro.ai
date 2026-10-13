import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The run gate and the sources of a video-fed Speaker View (decided 2026-10-12,
 * R5). A source that already exists is measured through the cached background
 * job BEFORE the run is sent, so a clip the Speaker View is going to refuse is
 * refused for free instead of after Transcribe has charged. A source the run
 * produces is left to the server's gate (it does not exist yet).
 */
// Speaker View and Speaker Frames priced: video mode is open (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))
const mockMeasure = vi.fn()

const mockToastError = vi.fn()
const mockExecuteNode = vi.fn()
const mockBuildExecutionLevels = vi.fn()
const mockGetEffectivelySkippedIds = vi.fn()
const mockCollapseExpandedClones = vi.fn()
const mockRunWorkflow = vi.fn()
const mockFetchQuery = vi.fn()
const mockEstimateRunCredits = vi.fn()
const mockNestedPreflight = vi.fn()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: { label: string } }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: vi.fn() } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes, edges: mockEdges,
      updateNodeData: vi.fn(), markNodesStatus: vi.fn(),
      isDirty: false, workflowId: "wf-1",
    }),
  },
}))
vi.mock("@/lib/api", () => ({
  measureClipLength: (...a: unknown[]) => mockMeasure(...a),
  getJobStatusLean: vi.fn(),
  getUserCredits: vi.fn(),
  runWorkflow: (...a: unknown[]) => mockRunWorkflow(...a),
  getWorkflowExecution: vi.fn(),
  withDedupRaceRetry: <T,>(fn: () => Promise<T>) => fn(),
  WorkflowAlreadyRunningError: class extends Error {},
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }) }))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/query-client", () => ({
  queryClient: { fetchQuery: (...a: unknown[]) => mockFetchQuery(...a), getQueryData: () => undefined },
}))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
vi.mock("../estimate-run-credits", () => ({ estimateRunCredits: (...a: unknown[]) => mockEstimateRunCredits(...a) }))
vi.mock("../types", () => ({
  WorkflowStaleError: class extends Error {},
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: () => {},
  NODE_CREDIT_COSTS: { "generate-video": 0, "speaker-view": 0 } as Record<string, number>,
  isExecutableNode: () => true,
  getFanOutMultiplier: () => 1,
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: (...a: unknown[]) => mockBuildExecutionLevels(...a),
  getEffectivelySkippedIds: (...a: unknown[]) => mockGetEffectivelySkippedIds(...a),
  collapseExpandedClones: (...a: unknown[]) => mockCollapseExpandedClones(...a),
  extractNodeOutput: (n: { data?: { url?: string; generatedVideoUrl?: string } }) => n.data?.url ?? n.data?.generatedVideoUrl,
}))
vi.mock("../node-input-resolver", () => ({ getListInputForNode: () => null, getListFanOutForNode: () => undefined }))
vi.mock("../execute-node", () => ({ executeNode: (...a: unknown[]) => mockExecuteNode(...a), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
// The nested walk itself is unit-tested in sub-workflow-preflight.test.ts; here
// it stands in for "a referenced workflow the run must not start".
vi.mock("../sub-workflow-preflight", () => ({
  nestedRunPreflight: (...a: unknown[]) => mockNestedPreflight(...a),
}))

const { confirmRunOrAbort, detachActiveWorkflowStream } = await import("../run-handlers")
const { ClipMeasureStopped } = await import("@/lib/clip-measure-poll")

// A Run started by a test leaves the module's stream slot taken; the next test
// would meet a run "already followed" and its Run would refuse without testing anything.
afterEach(() => detachActiveWorkflowStream())

afterEach(() => detachActiveWorkflowStream())


const URL = "https://cdn.example.test/uploads/a.mp4"
const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const wire = (source: string, target: string, targetHandle: string) => ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle: "out", targetHandle })

function makeCtx(over: Record<string, unknown> = {}) {
  return { userId: "u1", projectId: "p1", isWorkflowStale: () => false, ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockNestedPreflight.mockResolvedValue(null)
  mockEstimateRunCredits.mockReturnValue(0)
})

describe("confirmRunOrAbort: the source of a video-fed Speaker View", () => {
  // A URL-only upload: no saved size, so the graph alone cannot judge it.
  const upload = n("up", "upload-video", { url: URL })
  const tx = n("tx", "transcribe")
  const sv = n("sv", "speaker-view", { label: "Vertical cut" })
  const edges = [wire("up", "tx", "audio"), wire("up", "sv", "video"), wire("tx", "sv", "transcript")]
  const all = [upload, tx, sv]

  it("refuses a narrow clip before the run is sent, naming the node by its label", async () => {
    mockMeasure.mockResolvedValue({ durationMs: 5000, width: 1080, height: 1920 })
    const ok = await confirmRunOrAbort(makeCtx() as never, [tx, sv] as never, all as never, edges as never, "from-here", false, true)
    expect(ok).toBe(false)
    expect(mockMeasure).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: URL }))
    const shown = String(mockToastError.mock.calls[0]![0])
    expect(shown).toMatch(/1080×1920/)
    expect(shown).toContain('Speaker View node "Vertical cut"')
    expect(shown).toContain("nothing was charged")
  })

  it("lets a wide clip through", async () => {
    mockMeasure.mockResolvedValue({ durationMs: 5000, width: 3840, height: 2160 })
    expect(await confirmRunOrAbort(makeCtx() as never, [tx, sv] as never, all as never, edges as never, "from-here", false, true)).toBe(true)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("passes the run's Stop and staleness to the wait", async () => {
    mockMeasure.mockResolvedValue({ durationMs: 5000, width: 3840, height: 2160 })
    const stale = () => false
    await confirmRunOrAbort(makeCtx({ isWorkflowStale: stale }) as never, [tx, sv] as never, all as never, edges as never, "from-here", false, true)
    expect(mockMeasure).toHaveBeenCalledWith(expect.objectContaining({ isStale: stale }))
  })

  it("does not measure a source the run itself produces (it does not exist yet)", async () => {
    const gv = n("gv", "generate-video")
    const produced = [gv, tx, sv]
    const wires = [wire("gv", "tx", "audio"), wire("gv", "sv", "video"), wire("tx", "sv", "transcript")]
    expect(await confirmRunOrAbort(makeCtx() as never, produced as never, produced as never, wires as never, "from-here", false, true)).toBe(true)
    expect(mockMeasure).not.toHaveBeenCalled()
  })

  it("does not measure for a Speaker View the run leaves out", async () => {
    expect(await confirmRunOrAbort(makeCtx() as never, [tx] as never, all as never, edges as never, "single", false, true)).toBe(true)
    expect(mockMeasure).not.toHaveBeenCalled()
  })

  it("a Stop or a restarted run during the wait ends the gate quietly: no refusal toast, the run is not sent", async () => {
    mockMeasure.mockRejectedValue(new ClipMeasureStopped("aborted"))
    expect(await confirmRunOrAbort(makeCtx() as never, [tx, sv] as never, all as never, edges as never, "from-here", false, true)).toBe(false)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("reports a clip that cannot be measured in the server's words and does not send the run", async () => {
    mockMeasure.mockRejectedValue(new Error("This file has no picture."))
    expect(await confirmRunOrAbort(makeCtx() as never, [tx, sv] as never, all as never, edges as never, "from-here", false, true)).toBe(false)
    expect(String(mockToastError.mock.calls[0]![0])).toContain("This file has no picture.")
  })
})
