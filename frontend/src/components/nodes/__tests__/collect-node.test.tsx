import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CollectNode } from "../collect-node"

const updateNodeInternalsMock = vi.fn()

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    Handle: ({ type, position, id, style }: any) => (
      <div
        data-testid={`handle-${id}`}
        data-type={type}
        data-position={position}
        data-background={style?.background}
        data-top={style?.top}
      />
    ),
    useUpdateNodeInternals: () => updateNodeInternalsMock,
  }
})

// `EditableNodeLabel` subscribes to React Flow's zustand store for a
// zoom-aware font-size floor. The test isn't wrapped in a
// `ReactFlowProvider`, so stub the component to a no-op render — these
// tests assert handle structure, not the label.
vi.mock("@/components/nodes/editable-node-label", () => ({
  EditableNodeLabel: ({ label }: { label?: string }) => (
    <span data-testid="editable-node-label">{label}</span>
  ),
}))

// CollectNode renders its functional handles through BaseNode's `handles`
// array; stub BaseNode (like loop-node.test) so the handles surface as
// `handle-<id>` testids without pulling in BaseNode's heavy dependencies.
vi.mock("@/components/nodes/base-node", () => ({
  BaseNode: ({
    children,
    handles,
  }: {
    children?: import("react").ReactNode
    handles?: ReadonlyArray<{ id: string; type: string; position: string }>
  }) => (
    <div data-testid="base-node">
      {handles?.map((h) => (
        <div
          key={h.id}
          data-testid={`handle-${h.id}`}
          data-type={h.type}
          data-position={h.position}
        />
      ))}
      {children}
    </div>
  ),
}))

const deleteEdgeMock = vi.fn()

// Mutable per-test state ---
let mockNodes: any[] = []
let mockEdges: any[] = []

vi.mock("@/hooks/use-workflow-store", () => {
  const useWorkflowStore: any = (selector: any) =>
    selector({
      nodes: mockNodes,
      edges: mockEdges,
      deleteEdge: deleteEdgeMock,
    })
  useWorkflowStore.getState = () => ({
    nodes: mockNodes,
    edges: mockEdges,
    deleteEdge: deleteEdgeMock,
  })
  return { useWorkflowStore }
})

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "collect-1",
    data: { label: "Collect", order: [] },
    ...overrides,
  } as any
  return render(<CollectNode {...defaultProps} />)
}

function resetMocks(nodes: any[] = [], edges: any[] = []) {
  updateNodeInternalsMock.mockClear()
  deleteEdgeMock.mockClear()
  mockNodes = nodes
  mockEdges = edges
}

describe("CollectNode", () => {
  it("renders the 'in' target handle on the left", () => {
    resetMocks([{ id: "collect-1", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: [] } }])
    renderNode()
    const handle = screen.getByTestId("handle-in")
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute("data-type", "target")
    expect(handle).toHaveAttribute("data-position", "left")
  })

  it("renders 'Connect inputs' hint when there are no incoming edges", () => {
    resetMocks([{ id: "collect-1", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: [] } }])
    renderNode()
    expect(screen.getByText("Connect inputs")).toBeInTheDocument()
  })

  it("renders singular connection count when N = 1", () => {
    resetMocks(
      [
        { id: "collect-1", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: [] } },
        { id: "tp-1", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "hello" } },
      ],
      [
        { id: "e1", source: "tp-1", target: "collect-1", targetHandle: "in" },
      ],
    )
    renderNode()
    expect(screen.getByText("1 connection")).toBeInTheDocument()
  })

  it("renders pluralized connection count when N > 1", () => {
    resetMocks(
      [
        { id: "collect-1", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: [] } },
        { id: "tp-1", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "hello" } },
        { id: "tp-2", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "world" } },
        { id: "gi-1", type: "generate-image", position: { x: 0, y: 0 }, data: { generatedImageUrl: "https://x/img.png" } },
      ],
      [
        { id: "e1", source: "tp-1", target: "collect-1", targetHandle: "in" },
        { id: "e2", source: "tp-2", target: "collect-1", targetHandle: "in" },
        { id: "e3", source: "gi-1", target: "collect-1", targetHandle: "in" },
      ],
    )
    renderNode()
    expect(screen.getByText("3 connections")).toBeInTheDocument()
  })

  it("renders an output handle per type present in upstream sources", () => {
    resetMocks(
      [
        { id: "collect-1", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: [] } },
        { id: "tp-1", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "hello" } },
        { id: "gi-1", type: "generate-image", position: { x: 0, y: 0 }, data: { generatedImageUrl: "https://x/img.png" } },
      ],
      [
        { id: "e1", source: "tp-1", target: "collect-1", targetHandle: "in" },
        { id: "e2", source: "gi-1", target: "collect-1", targetHandle: "in" },
      ],
    )
    renderNode()
    expect(screen.getByTestId("handle-out-text")).toBeInTheDocument()
    expect(screen.getByTestId("handle-out-image")).toBeInTheDocument()
    expect(screen.queryByTestId("handle-out-video")).not.toBeInTheDocument()
    expect(screen.queryByTestId("handle-out-audio")).not.toBeInTheDocument()
  })

  it("places output handles on the right side as source handles", () => {
    resetMocks(
      [
        { id: "collect-1", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: [] } },
        { id: "tp-1", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "hello" } },
      ],
      [{ id: "e1", source: "tp-1", target: "collect-1", targetHandle: "in" }],
    )
    renderNode()
    const handle = screen.getByTestId("handle-out-text")
    expect(handle).toHaveAttribute("data-type", "source")
    expect(handle).toHaveAttribute("data-position", "right")
  })

  it("ignores edges to other target handles when computing connection count", () => {
    resetMocks(
      [
        { id: "collect-1", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: [] } },
        { id: "tp-1", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "hello" } },
      ],
      [
        { id: "e1", source: "tp-1", target: "collect-1", targetHandle: "other" },
      ],
    )
    renderNode()
    expect(screen.getByText("Connect inputs")).toBeInTheDocument()
  })

  it("calls updateNodeInternals when the handle set transitions from empty to populated", () => {
    resetMocks(
      [
        { id: "collect-1", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: [] } },
        { id: "tp-1", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "hello" } },
      ],
      [{ id: "e1", source: "tp-1", target: "collect-1", targetHandle: "in" }],
    )
    renderNode()
    expect(updateNodeInternalsMock).toHaveBeenCalledWith("collect-1")
  })

  it("does NOT delete stale edges on initial mount (no prior handles)", () => {
    resetMocks(
      [
        { id: "collect-1", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: [] } },
        { id: "tp-1", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "hello" } },
        { id: "downstream", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "" } },
      ],
      [
        { id: "e1", source: "tp-1", target: "collect-1", targetHandle: "in" },
        // Outgoing from collect on a handle that won't be in the new set
        { id: "e2", source: "collect-1", sourceHandle: "out-video", target: "downstream" },
      ],
    )
    renderNode()
    expect(deleteEdgeMock).not.toHaveBeenCalled()
  })
})
