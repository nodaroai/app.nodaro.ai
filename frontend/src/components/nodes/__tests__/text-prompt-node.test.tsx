import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { TextPromptNode } from "../text-prompt-node"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
    >
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", () => ({
  Type: () => <span data-testid="type-icon" />,
}))

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Text Prompt", text: "", variables: {} },
    selected: false,
    ...overrides,
  } as any
  return render(<TextPromptNode {...defaultProps} />)
}

describe("TextPromptNode", () => {
  it("renders with label passed to BaseNode", () => {
    renderNode({ data: { label: "My Prompt", text: "hello", variables: {} } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "My Prompt")
  })

  it("renders text content from data", () => {
    renderNode({ data: { label: "Prompt", text: "A sunset scene", variables: {} } })
    expect(screen.getByText("A sunset scene")).toBeInTheDocument()
  })

  it("shows placeholder when text is empty", () => {
    renderNode({ data: { label: "Prompt", text: "", variables: {} } })
    expect(screen.getByText("Enter your prompt...")).toBeInTheDocument()
  })

  it("shows placeholder when text is undefined", () => {
    renderNode({ data: { label: "Prompt", variables: {} } })
    expect(screen.getByText("Enter your prompt...")).toBeInTheDocument()
  })

  it("passes correct category and credits to BaseNode", () => {
    renderNode({ data: { label: "Prompt", text: "test", variables: {} } })
    const baseNode = screen.getByTestId("base-node")
    expect(baseNode).toHaveAttribute("data-category", "input")
    expect(baseNode).toHaveAttribute("data-credits", "0")
  })

  it("passes node id to BaseNode", () => {
    renderNode({ id: "node-42", data: { label: "Prompt", text: "test", variables: {} } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-id", "node-42")
  })

  it("truncates long text with line-clamp", () => {
    renderNode({ data: { label: "Prompt", text: "A very long prompt text", variables: {} } })
    const paragraph = screen.getByText("A very long prompt text")
    expect(paragraph).toHaveClass("line-clamp-4")
  })
})
