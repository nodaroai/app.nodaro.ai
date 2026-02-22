import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { LoopNode } from "../loop-node"

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
  BaseNode: ({ children, label, category, credits, id, isRunning, handles }: any) => (
    <div data-testid="base-node" data-label={label} data-category={category} data-credits={credits} data-id={id} data-is-running={isRunning}>
      {handles?.map((h: any) => <div key={h.id} data-testid={`handle-${h.id}`} data-type={h.type} />)}
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return { Repeat: I }
})

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: any) => <div data-testid="run-node-button" />,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    runSingleNode: () => {},
    edges: [],
  }),
}))

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Loop", columns: [], rows: [] },
    selected: false,
    ...overrides,
  } as any
  return render(<LoopNode {...defaultProps} />)
}

describe("LoopNode", () => {
  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct label", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "Loop")
  })

  it("passes correct category", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "input")
  })

  it("passes correct credits", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "0")
  })

  it("shows 'Click to configure...' when no columns", () => {
    renderNode()
    expect(screen.getByText("Click to configure...")).toBeInTheDocument()
  })

  it("shows row x col count when columns exist", () => {
    renderNode({
      data: {
        label: "Loop",
        columns: [
          { name: "A", handleId: "col_a" },
          { name: "B", handleId: "col_b" },
        ],
        rows: [
          { col_a: "1", col_b: "2" },
          { col_a: "3", col_b: "4" },
        ],
      },
    })
    expect(screen.getByText(/2 rows/)).toBeInTheDocument()
  })

  it("renders handle for each column", () => {
    renderNode({
      data: {
        label: "Loop",
        columns: [
          { name: "A", handleId: "col_a" },
          { name: "B", handleId: "col_b" },
        ],
        rows: [
          { col_a: "1", col_b: "2" },
          { col_a: "3", col_b: "4" },
        ],
      },
    })
    expect(screen.getByTestId("handle-col_a")).toBeInTheDocument()
    expect(screen.getByTestId("handle-col_b")).toBeInTheDocument()
  })
})
