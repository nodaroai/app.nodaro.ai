import { describe, it, expect, vi, beforeEach } from "vitest"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * Single-node Run on a Sub-workflow node is the one canvas entry point that
 * executes a MULTI-NODE graph in the browser: the run gate only ever saw the
 * sub-workflow node itself, so a transcribe(whisper) → add-captions chain inside
 * the referenced workflow reached the engine, billed the transcription, and then
 * failed the captions node with "transcript has no words to caption" — the
 * paid-then-fail outcome the refusal exists to remove (the backend's
 * sub-workflow handler already refuses the same graph).
 *
 * The check runs after the route filter and BEFORE anything is added to the
 * store or executed.
 */

// Priced, so the video-fed run-start questions are the ones that speak (F5).
// Speaker View and Speaker Frames priced: video mode is open (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))

const mockToastError = vi.fn()
const mockUpdateNodeData = vi.fn()
const mockSetState = vi.fn()
const mockExecuteNode = vi.fn()
const mockLoad = vi.fn()
const mockBuildExecutionLevels = vi.fn()

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: vi.fn() } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ updateNodeData: mockUpdateNodeData, nodes: [], edges: [] }),
    setState: (...a: unknown[]) => mockSetState(...a),
  },
}))
vi.mock("../sub-workflow-route-graph", () => ({
  SUB_WORKFLOW_MAX_DEPTH: 5,
  subWorkflowRouteKey: (d: { referencedWorkflowId?: string; selectedRouteId?: string }) =>
    `${d.referencedWorkflowId}:${d.selectedRouteId}`,
  loadSubWorkflowRouteGraph: (...a: unknown[]) => mockLoad(...a),
}))
vi.mock("../execute-node", () => ({ executeNode: (...a: unknown[]) => mockExecuteNode(...a) }))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: (...a: unknown[]) => mockBuildExecutionLevels(...a),
  extractNodeOutput: () => undefined,
}))
vi.mock("../node-input-resolver", () => ({ getListFanOutForNode: () => undefined }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn() }))
vi.mock("../poll-job", () => ({ RUN_START_RESET: {} }))
vi.mock("../types", () => ({ isExecutableNode: (n: { type?: string }) => n.type !== "sub-workflow-input" }))

const { executeSubWorkflow } = await import("../sub-workflow-executor")

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, sourceHandle: "json", targetHandle }) as unknown as WorkflowEdge

const parent = node("s1", "sub-workflow", {
  label: "Captions Route",
  referencedWorkflowId: "wf-a",
  selectedRouteId: "r1",
  routeSnapshot: { inputPorts: [], outputPorts: [], visibleOutputPortId: "out" },
})

const inputNode = node("in", "sub-workflow-input", { routeId: "r1" })
const outputNode = node("out", "sub-workflow-output", { routeId: "r1", ports: [] })

const ctx = { userId: "u1" } as never

beforeEach(() => {
  vi.clearAllMocks()
  mockBuildExecutionLevels.mockReturnValue([])
})

describe("executeSubWorkflow — nested word-timings refusal", () => {
  it("refuses a wordless transcript chain inside the referenced workflow, before anything runs", async () => {
    mockLoad.mockResolvedValue({
      nodes: [node("t1", "transcribe", { label: "Inner Transcribe", provider: "whisper" }), node("c1", "add-captions")],
      edges: [edge("t1", "c1", "transcript")],
      inputNode,
      outputNode,
    })

    const promise = executeSubWorkflow(parent, ctx)
    promise.catch(() => {})
    await expect(promise).rejects.toThrow(/whisper/)

    expect(mockExecuteNode).not.toHaveBeenCalled()
    // Nothing namespaced ever entered the store — the refusal is BEFORE step 4
    // (the cleanup pass in `finally` filters, it never adds).
    for (const call of mockSetState.mock.calls) {
      const added = ((call[0] as { nodes?: WorkflowNode[] }).nodes ?? []).some((n) => n.id.startsWith("__sub_"))
      expect(added).toBe(false)
    }
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ executionStatus: "failed", errorMessage: expect.stringContaining("elevenlabs-stt") }),
    )
  })

  it("runs a referenced workflow whose transcript lane can produce word timings", async () => {
    const inner = [node("t1", "transcribe", { provider: "elevenlabs-stt" }), node("c1", "add-captions")]
    mockLoad.mockResolvedValue({
      nodes: inner,
      edges: [edge("t1", "c1", "transcript")],
      inputNode,
      outputNode,
    })
    mockBuildExecutionLevels.mockImplementation((nodes: WorkflowNode[]) => [nodes])
    mockExecuteNode.mockResolvedValue(undefined)

    await executeSubWorkflow(parent, ctx)

    expect(mockExecuteNode).toHaveBeenCalledTimes(2)
  })
})

// F5 (decided 2026-10-12): a video-fed Speaker View inside the referenced graph
// is asked the same run-start questions as one on the canvas.
describe("executeSubWorkflow — nested video-fed Speaker View refusal", () => {
  it("refuses a video wired into a Speaker View with no transcript, naming the node by its label, before anything runs", async () => {
    mockLoad.mockResolvedValue({
      nodes: [node("up", "upload-video", { url: "https://cdn.example.test/a.mp4" }), node("sv", "speaker-view", { label: "Inner cut" })],
      edges: [{ id: "up-sv", source: "up", target: "sv", sourceHandle: "video", targetHandle: "video" } as unknown as WorkflowEdge],
      inputNode,
      outputNode,
    })

    const promise = executeSubWorkflow(parent, ctx)
    promise.catch(() => {})
    await expect(promise).rejects.toThrow(/Transcribe/)
    await expect(promise).rejects.toThrow(/Speaker View node "Inner cut"/)
    expect(mockExecuteNode).not.toHaveBeenCalled()
  })
})
