import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { GroupNode } from "../group-node"
import { NODE_COLORS } from "@/lib/node-colors"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    NodeToolbar: ({ children, isVisible }: any) =>
      isVisible ? <div data-testid="node-toolbar">{children}</div> : null,
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

// Pin the theme so the tint assertions below have one palette to expect.
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }))

const updateNodeDataMock = vi.fn()
const deleteEdgeMock = vi.fn()

// Mutable per-test state ---
let mockNodes: any[] = []
let mockEdges: any[] = []

vi.mock("@/hooks/use-workflow-store", () => {
  const useWorkflowStore: any = (selector: any) =>
    selector({
      nodes: mockNodes,
      edges: mockEdges,
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

  // Lane presence derives from MEMBERSHIP, not just results — a pre-run
  // member must already mint its lane pip so outgoing edges are draggable
  // and pre-authored edges render (same fix as collect-node).
  it("renders the lane pip for a member BEFORE it has results", () => {
    resetMocks([
      { id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } },
      { id: "gi-1", parentId: "group-1", type: "generate-image", position: { x: 0, y: 10 }, data: { label: "Cover", prompt: "x" } },
    ])
    renderNode({ data: { label: "G" } })
    expect(screen.getByTestId("handle-out-image")).toBeInTheDocument()
  })

  it("renders the lane pip for a lane referenced by an outgoing edge", () => {
    resetMocks(
      [{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } }],
      [{ id: "e1", source: "group-1", sourceHandle: "out-audio", target: "downstream", targetHandle: "in" }],
    )
    renderNode({ data: { label: "G" } })
    expect(screen.getByTestId("handle-out-audio")).toBeInTheDocument()
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

  // --- tinted frames --------------------------------------------------------
  // A group with `data.color` becomes a titled section: the frame carries a wash
  // of the colour and the label above it becomes a solid banner in the same one.
  const group = (data: Record<string, unknown>) => {
    resetMocks([{ id: "group-1", type: "group", position: { x: 0, y: 0 }, data }])
    return data
  }
  const frame = () => document.querySelector(".group-node") as HTMLElement
  const label = () => screen.getByTestId("group-label")

  describe("untinted (every group that existed before tinting)", () => {
    it("keeps the neutral frame classes and paints no background of its own", () => {
      renderNode({ data: group({ label: "G" }) })
      expect(frame().className).toContain("border-[#2D2D2D]")
      expect(frame().style.backgroundColor).toBe("")
    })

    it("keeps the quiet caption above the frame rather than a banner", () => {
      renderNode({ data: group({ label: "G" }) })
      expect(label().className).toContain("-top-6")
      expect(label().className).not.toContain("bottom-full")
      expect(label().style.backgroundColor).toBe("")
      expect(label().style.fontSize).toBe("")
    })
  })

  describe("tinted", () => {
    it("drops the neutral classes and washes the frame in the tint", () => {
      renderNode({ data: group({ label: "G", color: "#22D3EE40" }) })
      expect(frame().className).not.toContain("border-[#2D2D2D]")
      expect(frame().style.backgroundColor).not.toBe("")
      expect(frame().style.borderColor).not.toBe("")
    })

    it("renders the label as a solid banner flush against the frame", () => {
      renderNode({ data: group({ label: "G", color: "#22D3EE40" }) })
      expect(label().className).toContain("bottom-full")
      // The palette's bright entries carry an alpha byte. A banner reading as a
      // translucent smear defeats the point, so the alpha must be dropped.
      expect(label().style.backgroundColor).toBe("rgb(34, 211, 238)")
    })

    // A frame is thousands of canvas units tall and is read at fit-to-view zoom,
    // where a fixed 15px title would be a ~3px smudge.
    it("scales the banner with the frame height", () => {
      renderNode({ data: group({ label: "G", color: "#22D3EE40" }), height: 2000 })
      expect(parseFloat(label().style.fontSize)).toBeGreaterThan(60)
    })

    it.each([
      [100, 15],
      [100000, 120],
    ])("clamps the banner at height %i", (height, px) => {
      renderNode({ data: group({ label: "G", color: "#22D3EE40" }), height })
      expect(parseFloat(label().style.fontSize)).toBe(px)
    })

    // The palette spans near-black navies and near-white pastels, so a fixed
    // text colour is illegible on one end of it.
    it.each([
      ["#22D3EE40", "rgb(15, 23, 42)"],
      ["#0f172a", "rgb(255, 255, 255)"],
    ])("picks readable banner text for %s", (color, expected) => {
      renderNode({ data: group({ label: "G", color }) })
      expect(label().style.color).toBe(expected)
    })
  })

  describe("colour toolbar", () => {
    it("stays hidden until the group is selected", () => {
      renderNode({ data: group({ label: "G" }) })
      expect(screen.queryByTestId("node-toolbar")).not.toBeInTheDocument()
    })

    it("offers every palette colour plus a neutral reset", () => {
      renderNode({ data: group({ label: "G" }), selected: true })
      const swatches = screen.getByTestId("node-toolbar").querySelectorAll("div[style]")
      expect(swatches.length).toBe(NODE_COLORS.length + 1)
    })

    it("applies a palette colour", () => {
      renderNode({ data: group({ label: "G" }), selected: true })
      const swatches = screen.getByTestId("node-toolbar").querySelectorAll("div[style]")
      fireEvent.click(swatches[1])
      expect(updateNodeDataMock).toHaveBeenCalledWith("group-1", { color: NODE_COLORS[0] })
    })

    it("clears the tint from the neutral swatch", () => {
      renderNode({ data: group({ label: "G", color: NODE_COLORS[0] }), selected: true })
      fireEvent.click(screen.getByTitle("No colour"))
      expect(updateNodeDataMock).toHaveBeenCalledWith("group-1", { color: undefined })
    })
  })
})
