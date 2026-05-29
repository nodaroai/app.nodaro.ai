import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { StickyNoteNode } from "../sticky-note-node"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Handle: ({ type, position, id }: any) => (
      <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
    ),
    NodeResizer: () => null,
    NodeToolbar: ({ children, isVisible }: any) => isVisible ? <div data-testid="node-toolbar">{children}</div> : null,
    useStore: vi.fn(() => 1),
    useNodeId: vi.fn(() => "test-node"),
    useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
  }
})

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning }: any) => (
    <div data-testid="base-node" data-label={label} data-category={category} data-credits={credits} data-id={id} data-is-running={isRunning}>
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  return { ...actual }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    updateNodeData: () => {},
    updateNode: () => {},
  }),
}))

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Note", text: "", color: "#2d2d44" },
    selected: false,
    ...overrides,
  } as any
  return render(<StickyNoteNode {...defaultProps} />)
}

describe("StickyNoteNode", () => {
  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("renders textarea with placeholder", () => {
    renderNode()
    const textarea = screen.getByPlaceholderText("Write a note...")
    expect(textarea).toBeInTheDocument()
  })

  it("applies background color", () => {
    renderNode({ data: { label: "Note", text: "", color: "#ff6633" } })
    const textarea = screen.getByRole("textbox")
    // The background color is on the parent container div
    const container = textarea.parentElement
    expect(container).toHaveStyle({ backgroundColor: "#ff6633" })
  })

  it("shows toolbar when selected", () => {
    renderNode({ selected: true })
    // NodeToolbar renders when selected; Heading/Paragraph toggle is visible
    expect(screen.getByText("Paragraph")).toBeInTheDocument()
  })

  it("hides toolbar when not selected", () => {
    renderNode({ selected: false })
    // NodeToolbar is not rendered when not selected and not hovered
    expect(screen.queryByText("Paragraph")).not.toBeInTheDocument()
  })

  it("renders text content", () => {
    renderNode({ data: { label: "Note", text: "Hello world", color: "#2d2d44" } })
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
    expect(textarea.value).toBe("Hello world")
  })

  it("applies font size", () => {
    renderNode({ data: { label: "Note", text: "", color: "#2d2d44", fontSize: "lg" } })
    const textarea = screen.getByRole("textbox")
    expect(textarea).toHaveStyle({ fontSize: "18px" })
  })

  it("applies bold style", () => {
    renderNode({ data: { label: "Note", text: "", color: "#2d2d44", bold: true } })
    const textarea = screen.getByRole("textbox")
    expect(textarea).toHaveStyle({ fontWeight: 700 })
  })

  it("renders the 3-dots More options button when selected", () => {
    renderNode({ selected: true })
    expect(screen.getByLabelText("More options")).toBeInTheDocument()
  })

  it("dispatches open-node-context-menu when the 3-dots button is clicked", () => {
    const handler = vi.fn()
    window.addEventListener("open-node-context-menu", handler)
    renderNode({ selected: true })
    fireEvent.click(screen.getByLabelText("More options"))
    window.removeEventListener("open-node-context-menu", handler)
    expect(handler).toHaveBeenCalledTimes(1)
    const evt = handler.mock.calls[0][0] as CustomEvent
    expect(evt.detail.nodeId).toBe("node-1")
  })
})
