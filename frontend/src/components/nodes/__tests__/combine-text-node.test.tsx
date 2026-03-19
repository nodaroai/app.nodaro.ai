import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CombineTextNode } from "../combine-text-node"

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

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return { Merge: I, FileText: I, X: I, Copy: I }
})

vi.mock("../run-node-button", () => ({
  RunNodeButton: () => <div data-testid="run-node-button" />,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    runSingleNode: () => {},
  }),
}))

vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom")
  return { ...actual, createPortal: (node: any) => node }
})

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Combine Text", separator: "newline" },
    selected: false,
    ...overrides,
  } as any
  return render(<CombineTextNode {...defaultProps} />)
}

describe("CombineTextNode", () => {
  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct category", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "processing")
  })

  it("passes correct credits", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "0")
  })

  it("shows placeholder when no combined text", () => {
    renderNode()
    const dashed = document.querySelector(".border-dashed")
    expect(dashed).toBeInTheDocument()
  })

  it("shows separator label", () => {
    renderNode()
    expect(screen.getByText(/\\n/)).toBeInTheDocument()
  })

  it("shows line count when text combined", () => {
    renderNode({
      data: {
        label: "Combine Text",
        separator: "newline",
        combinedText: "line 1\nline 2\nline 3",
      },
    })
    expect(screen.getByText("3 lines combined")).toBeInTheDocument()
  })
})
