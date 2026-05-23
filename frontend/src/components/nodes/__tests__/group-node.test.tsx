import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { GroupNode } from "../group-node"

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
    NodeResizer: ({ isVisible, minWidth, minHeight }: any) => (
      <div
        data-testid="node-resizer"
        data-is-visible={String(!!isVisible)}
        data-min-width={minWidth}
        data-min-height={minHeight}
      />
    ),
    useUpdateNodeInternals: vi.fn(() => () => {}),
  }
})

const updateNodeDataMock = vi.fn()
const deleteEdgeMock = vi.fn()

// Mutable per-test state ---
let mockNodes: any[] = []
let mockEdges: any[] = []

vi.mock("@/hooks/use-workflow-store", () => {
  const useWorkflowStore: any = (selector: any) =>
    selector({
      nodes: mockNodes,
      updateNodeData: updateNodeDataMock,
      deleteEdge: deleteEdgeMock,
    })
  useWorkflowStore.getState = () => ({
    nodes: mockNodes,
    edges: mockEdges,
    updateNodeData: updateNodeDataMock,
    deleteEdge: deleteEdgeMock,
  })
  return { useWorkflowStore }
})

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "group-1",
    data: { label: "New group" },
    selected: false,
    ...overrides,
  } as any
  return render(<GroupNode {...defaultProps} />)
}

function resetMocks(nodes: any[] = [], edges: any[] = []) {
  updateNodeDataMock.mockClear()
  deleteEdgeMock.mockClear()
  mockNodes = nodes
  mockEdges = edges
}

describe("GroupNode", () => {
  it("renders the title bar with default label", () => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "New group" } }])
    renderNode()
    expect(screen.getByText("New group")).toBeInTheDocument()
  })

  it("falls back to 'New group' when label is empty", () => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "" } }])
    renderNode({ data: { label: "" } })
    expect(screen.getByText("New group")).toBeInTheDocument()
  })

  it("renders no output handles when there are no members", () => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } }])
    const { container } = renderNode({ data: { label: "G" } })
    // Only the group itself, no children → no handles
    expect(container.querySelectorAll("[data-testid^='handle-out-']").length).toBe(0)
  })

  it("renders empty-state hint when group has no members", () => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } }])
    renderNode({ data: { label: "G" } })
    expect(screen.getByText("Drop nodes here")).toBeInTheDocument()
  })

  it("renders the NodeResizer with proper minWidth/minHeight (hidden when not selected)", () => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } }])
    renderNode({ data: { label: "G" }, selected: false })
    const resizer = screen.getByTestId("node-resizer")
    expect(resizer).toHaveAttribute("data-is-visible", "false")
    expect(resizer).toHaveAttribute("data-min-width", "240")
    expect(resizer).toHaveAttribute("data-min-height", "160")
  })

  it("makes the NodeResizer visible when selected", () => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } }])
    renderNode({ data: { label: "G" }, selected: true })
    expect(screen.getByTestId("node-resizer")).toHaveAttribute("data-is-visible", "true")
  })

  it("renders an output handle per type present in members", () => {
    resetMocks([
      { id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } },
      // text-prompt child → text bucket
      { id: "tp-1", parentId: "group-1", type: "text-prompt", position: { x: 0, y: 10 }, data: { text: "hello" } },
      // generate-image child with output → image bucket
      { id: "gi-1", parentId: "group-1", type: "generate-image", position: { x: 0, y: 20 }, data: { generatedImageUrl: "https://x/img.png" } },
    ])
    renderNode({ data: { label: "G" } })
    expect(screen.getByTestId("handle-out-text")).toBeInTheDocument()
    expect(screen.getByTestId("handle-out-image")).toBeInTheDocument()
    expect(screen.queryByTestId("handle-out-video")).not.toBeInTheDocument()
    expect(screen.queryByTestId("handle-out-audio")).not.toBeInTheDocument()
  })

  it("hides empty-state hint when there is at least one member output", () => {
    resetMocks([
      { id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } },
      { id: "tp-1", parentId: "group-1", type: "text-prompt", position: { x: 0, y: 10 }, data: { text: "hello" } },
    ])
    renderNode({ data: { label: "G" } })
    expect(screen.queryByText("Drop nodes here")).not.toBeInTheDocument()
  })

  it("each handle is on the right side and typed as source", () => {
    resetMocks([
      { id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } },
      { id: "tp-1", parentId: "group-1", type: "text-prompt", position: { x: 0, y: 10 }, data: { text: "hello" } },
    ])
    renderNode({ data: { label: "G" } })
    const handle = screen.getByTestId("handle-out-text")
    expect(handle).toHaveAttribute("data-type", "source")
    expect(handle).toHaveAttribute("data-position", "right")
  })

  it("enters edit mode on double-click and commits new label on Enter", () => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "Old" } }])
    renderNode({ data: { label: "Old" } })
    const labelEl = screen.getByText("Old")
    fireEvent.doubleClick(labelEl)
    const input = screen.getByDisplayValue("Old") as HTMLInputElement
    fireEvent.change(input, { target: { value: "Renamed" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(updateNodeDataMock).toHaveBeenCalledWith("group-1", { label: "Renamed" })
  })

  it("commits new label on blur", () => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "Old" } }])
    renderNode({ data: { label: "Old" } })
    fireEvent.doubleClick(screen.getByText("Old"))
    const input = screen.getByDisplayValue("Old") as HTMLInputElement
    fireEvent.change(input, { target: { value: "After-blur" } })
    fireEvent.blur(input)
    expect(updateNodeDataMock).toHaveBeenCalledWith("group-1", { label: "After-blur" })
  })

  it("cancels rename on Escape without calling updateNodeData", () => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "Original" } }])
    renderNode({ data: { label: "Original" } })
    fireEvent.doubleClick(screen.getByText("Original"))
    const input = screen.getByDisplayValue("Original") as HTMLInputElement
    fireEvent.change(input, { target: { value: "Nope" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(updateNodeDataMock).not.toHaveBeenCalled()
    // Label re-renders without input
    expect(screen.getByText("Original")).toBeInTheDocument()
  })

  it("commits 'New group' fallback when the input is cleared and committed", () => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "Old" } }])
    renderNode({ data: { label: "Old" } })
    fireEvent.doubleClick(screen.getByText("Old"))
    const input = screen.getByDisplayValue("Old") as HTMLInputElement
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(updateNodeDataMock).toHaveBeenCalledWith("group-1", { label: "New group" })
  })
})
