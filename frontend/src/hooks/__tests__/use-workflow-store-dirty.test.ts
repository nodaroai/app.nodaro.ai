import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"

/**
 * Dirty-flag semantics for runtime writes (P0 phantom-dirty fix).
 *
 * Transient run-state (executionStatus / currentJobId / progress / fan-out
 * counters) must NOT mark the workflow dirty: polling-driven dirt is what
 * produced spurious autosaves from passive tabs, false "changed in another
 * tab" banners, and the remote-ahead latch that froze autosave. Results
 * (generated*, errorMessage) still dirty — they persist across reload.
 */

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes: unknown[], nodes: unknown[]) => nodes),
  applyEdgeChanges: vi.fn((_changes: unknown[], edges: unknown[]) => edges),
  addEdge: vi.fn((connection: Record<string, unknown>, edges: Record<string, unknown>[]) => [
    ...edges,
    { ...connection, id: (connection.id as string) ?? "edge_mock" },
  ]),
}))

const localStorageStore: Record<string, string> = {}
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value }),
    removeItem: vi.fn((key: string) => { delete localStorageStore[key] }),
    clear: vi.fn(() => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]) }),
    length: 0,
    key: vi.fn(() => null),
  },
  writable: true,
})

vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))

import { useWorkflowStore } from "../use-workflow-store"

function seedNode(id = "n1") {
  useWorkflowStore.setState({
    nodes: [
      {
        id,
        type: "generate-image",
        position: { x: 0, y: 0 },
        data: { label: "Img", prompt: "a cat" },
      } as never,
    ],
    edges: [],
    isDirty: false,
    isReadOnly: false,
  })
}

beforeEach(() => {
  seedNode()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("updateNodeData dirty semantics", () => {
  it("transient-only patches (status/jobId/progress) do NOT dirty the workflow", () => {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData("n1", { executionStatus: "running", currentJobId: "job-1", currentJobProgress: 12 })

    const state = useWorkflowStore.getState()
    expect((state.nodes[0]!.data as Record<string, unknown>).executionStatus).toBe("running")
    expect(state.isDirty).toBe(false)
  })

  it("result arrivals still dirty (they must persist)", () => {
    useWorkflowStore.getState().updateNodeData("n1", {
      executionStatus: "completed",
      generatedImageUrl: "https://r2/x.png",
    })
    expect(useWorkflowStore.getState().isDirty).toBe(true)
  })

  it("generatedResults-only patches dirty", () => {
    useWorkflowStore.getState().updateNodeData("n1", {
      generatedResults: [{ url: "https://r2/x.png" }],
    })
    expect(useWorkflowStore.getState().isDirty).toBe(true)
  })

  it("config edits dirty as before", () => {
    useWorkflowStore.getState().updateNodeData("n1", { prompt: "a dog" })
    expect(useWorkflowStore.getState().isDirty).toBe(true)
  })

  it("errorMessage dirties (persisted outcome)", () => {
    useWorkflowStore.getState().updateNodeData("n1", { errorMessage: "boom" })
    expect(useWorkflowStore.getState().isDirty).toBe(true)
  })
})

describe("markNodesStatus dirty semantics", () => {
  it("optimistic status flips do NOT dirty the workflow", () => {
    useWorkflowStore.getState().markNodesStatus(["n1"], "pending")

    const state = useWorkflowStore.getState()
    expect((state.nodes[0]!.data as Record<string, unknown>).executionStatus).toBe("pending")
    expect(state.isDirty).toBe(false)
  })
})
