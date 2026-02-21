import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { StickyNoteNode } from "../sticky-note-node"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning }: any) => (
    <div data-testid="base-node" data-label={label} data-category={category} data-credits={credits} data-id={id} data-is-running={isRunning}>
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t: any, prop: string) => {
    if (prop === '__esModule') return false
    return (p: any) => <span data-testid={`icon-${prop}`} {...p} />
  },
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    updateNodeData: () => {},
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
    const textarea = screen.getByPlaceholderText("Write notes here...")
    expect(textarea).toBeInTheDocument()
  })

  it("applies background color", () => {
    renderNode({ data: { label: "Note", text: "", color: "#ff6633" } })
    const container = screen.getByRole("textbox").closest(".w-full.h-full")
    expect(container).toHaveStyle({ backgroundColor: "#ff6633" })
  })

  it("shows toolbar when selected", () => {
    renderNode({ selected: true })
    expect(screen.getByTitle("Bold")).toBeInTheDocument()
  })

  it("hides toolbar when not selected", () => {
    renderNode({ selected: false })
    expect(screen.queryByTitle("Bold")).not.toBeInTheDocument()
  })

  it("renders text content", () => {
    renderNode({ data: { label: "Note", text: "Hello world", color: "#2d2d44" } })
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
    expect(textarea.value).toBe("Hello world")
  })

  it("applies font size", () => {
    renderNode({ data: { label: "Note", text: "", color: "#2d2d44", fontSize: "lg" } })
    const textarea = screen.getByRole("textbox")
    expect(textarea).toHaveStyle({ fontSize: "90px" })
  })

  it("applies bold style", () => {
    renderNode({ data: { label: "Note", text: "", color: "#2d2d44", bold: true } })
    const textarea = screen.getByRole("textbox")
    expect(textarea).toHaveStyle({ fontWeight: "bold" })
  })
})
