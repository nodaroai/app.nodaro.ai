import { describe, it, expect, vi, beforeEach } from "vitest"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * A Sub-workflow node run on the canvas is the one place the editor itself runs
 * a multi-node graph. A video-fed Speaker View inside it is held to R5 (decided
 * 2026-10-12) like one on the server: a source that exists is measured before
 * anything runs; a source the run produces is awaited by every paid node that
 * feeds the Speaker View, and measured the moment it exists, so Transcribe never
 * charges for a clip the Speaker View is going to refuse.
 */
// Speaker View and Speaker Frames priced: video mode is open (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))

const mockUpdateNodeData = vi.fn()
const mockExecuteNode = vi.fn()
const mockLoad = vi.fn()
const mockBuildExecutionLevels = vi.fn()
const mockMeasure = vi.fn()
const store = { nodes: [] as WorkflowNode[], edges: [] as WorkflowEdge[] }

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ updateNodeData: mockUpdateNodeData, nodes: store.nodes, edges: store.edges }),
    setState: (next: { nodes?: WorkflowNode[]; edges?: WorkflowEdge[] }) => {
      if (next.nodes) store.nodes = next.nodes
      if (next.edges) store.edges = next.edges
    },
  },
}))
vi.mock("@/lib/api", () => ({ measureClipLength: (p: unknown) => mockMeasure(p) }))
vi.mock("../sub-workflow-route-graph", () => ({
  SUB_WORKFLOW_MAX_DEPTH: 5,
  subWorkflowRouteKey: (d: { referencedWorkflowId?: string; selectedRouteId?: string }) => `${d.referencedWorkflowId}:${d.selectedRouteId}`,
  loadSubWorkflowRouteGraph: (...a: unknown[]) => mockLoad(...a),
}))
vi.mock("../execute-node", () => ({ executeNode: (...a: unknown[]) => mockExecuteNode(...a) }))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: (...a: unknown[]) => mockBuildExecutionLevels(...a),
  extractNodeOutput: (n: { data?: { url?: string; generatedVideoUrl?: string } }) => n.data?.url ?? n.data?.generatedVideoUrl,
}))
vi.mock("../node-input-resolver", () => ({ getListFanOutForNode: () => undefined }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn() }))
vi.mock("../poll-job", () => ({ RUN_START_RESET: {} }))
vi.mock("../types", () => ({ isExecutableNode: (n: { type?: string }) => !["sub-workflow-input", "upload-video"].includes(n.type ?? "") }))

const { executeSubWorkflow } = await import("../sub-workflow-executor")

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const wire = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle: "out", targetHandle }) as unknown as WorkflowEdge

const parent = node("s1", "sub-workflow", {
  label: "Vertical route",
  referencedWorkflowId: "wf-a",
  selectedRouteId: "r1",
  routeSnapshot: { inputPorts: [], outputPorts: [], visibleOutputPortId: "out" },
})
const inputNode = node("in", "sub-workflow-input", { routeId: "r1" })
const outputNode = node("out", "sub-workflow-output", { routeId: "r1", ports: [] })
const ctx = { userId: "u1", isWorkflowStale: () => false } as never

const P = "__sub_s1_"
const URL = "https://cdn.example.test/uploads/a.mp4"
const NARROW = { durationMs: 5_000, width: 1080, height: 1920 }
const WIDE = { durationMs: 5_000, width: 3840, height: 2160 }

beforeEach(() => {
  vi.clearAllMocks()
  store.nodes = []
  store.edges = []
})

describe("executeSubWorkflow: a source the run produces (Generate Video)", () => {
  const graph = () => ({
    nodes: [node("gv", "generate-video"), node("tx", "transcribe"), node("sv", "speaker-view", { label: "Inner cut" })],
    edges: [wire("gv", "tx", "audio"), wire("gv", "sv", "video"), wire("tx", "sv", "transcript")],
    inputNode,
    outputNode,
  })

  it("orders every paid feeder after the source in the level builder", async () => {
    mockLoad.mockResolvedValue(graph())
    mockBuildExecutionLevels.mockReturnValue([])
    await executeSubWorkflow(parent, ctx)
    const extra = mockBuildExecutionLevels.mock.calls[0]![2] as Array<{ source: string; target: string }>
    expect(extra).toContainEqual(expect.objectContaining({ source: `${P}gv`, target: `${P}tx` }))
  })

  it("refuses Transcribe once the generated video exists and measures narrow: Transcribe never runs, nothing is charged", async () => {
    mockLoad.mockResolvedValue(graph())
    // Levels as the builder returns them with the ordering edge: source, then the feeder, then the Speaker View.
    mockBuildExecutionLevels.mockImplementation((nodes: WorkflowNode[]) => [
      [nodes.find((n) => n.id === `${P}gv`)!],
      [nodes.find((n) => n.id === `${P}tx`)!],
      [nodes.find((n) => n.id === `${P}sv`)!],
    ])
    mockExecuteNode.mockImplementation(async (n: WorkflowNode) => {
      if (n.id === `${P}gv`) store.nodes = store.nodes.map((x) => (x.id === n.id ? ({ ...x, data: { ...x.data, generatedVideoUrl: URL, executionStatus: "completed" } } as WorkflowNode) : x))
    })
    mockMeasure.mockResolvedValue(NARROW)

    await expect(executeSubWorkflow(parent, ctx)).rejects.toThrow(/1080×1920/)

    const ran = mockExecuteNode.mock.calls.map((c) => (c[0] as WorkflowNode).id)
    expect(ran).toEqual([`${P}gv`])
    expect(mockMeasure).toHaveBeenCalledTimes(1)
    expect(mockMeasure).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: URL }))
  })

  it("lets the whole chain run when the generated video is wide", async () => {
    mockLoad.mockResolvedValue(graph())
    mockBuildExecutionLevels.mockImplementation((nodes: WorkflowNode[]) => [
      [nodes.find((n) => n.id === `${P}gv`)!],
      [nodes.find((n) => n.id === `${P}tx`)!],
      [nodes.find((n) => n.id === `${P}sv`)!],
    ])
    mockExecuteNode.mockImplementation(async (n: WorkflowNode) => {
      if (n.id === `${P}gv`) store.nodes = store.nodes.map((x) => (x.id === n.id ? ({ ...x, data: { ...x.data, generatedVideoUrl: URL, executionStatus: "completed" } } as WorkflowNode) : x))
    })
    mockMeasure.mockResolvedValue(WIDE)

    await executeSubWorkflow(parent, ctx)

    expect(mockExecuteNode.mock.calls.map((c) => (c[0] as WorkflowNode).id)).toEqual([`${P}gv`, `${P}tx`, `${P}sv`])
    expect(mockMeasure).toHaveBeenCalledTimes(1)
  })
})

describe("executeSubWorkflow: a source that already exists (an Upload)", () => {
  it("measures it before anything runs and refuses a narrow one, naming the node by its label", async () => {
    mockLoad.mockResolvedValue({
      nodes: [node("up", "upload-video", { url: URL }), node("tx", "transcribe"), node("sv", "speaker-view", { label: "Inner cut" })],
      edges: [wire("up", "tx", "audio"), wire("up", "sv", "video"), wire("tx", "sv", "transcript")],
      inputNode,
      outputNode,
    })
    mockBuildExecutionLevels.mockImplementation((nodes: WorkflowNode[]) => [nodes])
    mockMeasure.mockResolvedValue(NARROW)

    const err = await executeSubWorkflow(parent, ctx).catch((e: unknown) => e)

    expect((err as Error).message).toMatch(/1080×1920/)
    expect((err as Error).message).toContain('Speaker View node "Inner cut"')
    expect(mockExecuteNode).not.toHaveBeenCalled()
    expect(store.nodes.some((n) => n.id.startsWith(P))).toBe(false)
  })
})
