import { describe, it, expect, afterEach, vi } from "vitest"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    getSharedWorkflow: vi.fn(),
    runSharedWorkflow: vi.fn(),
    getSharedExecutionStatus: vi.fn(),
  }
})

import { usePresentationStore } from "../use-presentation-store"
import { getSharedWorkflow } from "@/lib/api"

afterEach(() => {
  usePresentationStore.setState({
    workflowId: null,
    workflowName: "",
    nodes: [],
    edges: [],
    shareToken: null,
    isOwner: false,
    executionStatus: "idle",
    errorMessage: null,
  })
  vi.clearAllMocks()
})

describe("usePresentationStore.loadSharedWorkflow — loop→list migration", () => {
  it("migrates legacy loop nodes to list (single-column) on load", async () => {
    vi.mocked(getSharedWorkflow).mockResolvedValue({
      workflowId: "wf_1",
      name: "Shared WF",
      nodes: [
        { id: "loop_1", type: "loop", position: { x: 0, y: 0 }, data: { columns: [{ id: "c1", name: "Shot", handleId: "col_c1", type: "text" }], rows: [["a"]] } },
      ],
      edges: [],
      isOwner: false,
    } as never)

    await usePresentationStore.getState().loadSharedWorkflow("tok")

    const nodes = usePresentationStore.getState().nodes
    expect(nodes[0].type).toBe("list")
    expect(usePresentationStore.getState().executionStatus).toBe("idle")
  })

  it("preserves a multi-column loop's columns/rows when migrating to list", async () => {
    vi.mocked(getSharedWorkflow).mockResolvedValue({
      workflowId: "wf_2",
      name: "Shared WF 2",
      nodes: [
        {
          id: "loop_multi",
          type: "loop",
          position: { x: 0, y: 0 },
          data: {
            columns: [
              { id: "c1", name: "Name", handleId: "col_c1", type: "text" },
              { id: "c2", name: "Face", handleId: "col_c2", type: "image-url" },
            ],
            rows: [["Ana", "u1"], ["Bo", "u2"]],
          },
        },
      ],
      edges: [{ id: "e1", source: "loop_multi", target: "x" }],
      isOwner: true,
    } as never)

    await usePresentationStore.getState().loadSharedWorkflow("tok2")

    const node = usePresentationStore.getState().nodes[0]
    expect(node.type).toBe("list")
    const data = node.data as Record<string, unknown>
    // All columns survive — a former multi-column loop must not lose columns 2+
    expect((data.columns as unknown[]).length).toBe(2)
    expect(data.rows).toEqual([["Ana", "u1"], ["Bo", "u2"]])
    // Edges untouched
    expect(usePresentationStore.getState().edges).toEqual([{ id: "e1", source: "loop_multi", target: "x" }])
  })

  it("leaves an already-canonical list and unrelated nodes alone", async () => {
    vi.mocked(getSharedWorkflow).mockResolvedValue({
      workflowId: "wf_3",
      name: "Shared WF 3",
      nodes: [
        { id: "tp", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "hi" } },
        { id: "list_1", type: "list", position: { x: 0, y: 0 }, data: { columns: [{ id: "c1", name: "Items", handleId: "col_c1", type: "text" }], rows: [["x"]] } },
      ],
      edges: [],
      isOwner: false,
    } as never)

    await usePresentationStore.getState().loadSharedWorkflow("tok3")

    const nodes = usePresentationStore.getState().nodes
    expect(nodes.find((n) => n.id === "tp")!.type).toBe("text-prompt")
    expect(nodes.find((n) => n.id === "list_1")!.type).toBe("list")
  })
})
