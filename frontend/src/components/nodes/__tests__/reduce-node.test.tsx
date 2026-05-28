import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ReduceNode } from "../reduce-node"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${type}-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverAnchor: ({ children }: any) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/hooks/use-handle-connections", () => ({
  useHandleConnections: () => [],
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning, handles }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
      data-is-running={isRunning}
      data-handles={JSON.stringify(handles?.map((h: any) => ({ id: h.id, type: h.type })) ?? [])}
    >
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return { Funnel: I, Braces: I, FileText: I }
})

vi.mock("../run-node-button", () => ({
  RunNodeButton: () => <div data-testid="run-node-button" />,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  EXECUTION_DATA_KEYS: new Set(["executionStatus"]),
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        runFromHere: () => {},
        updateNodeData: () => {},
        loadGeneration: 0,
      }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

vi.mock("../editable-node-label", () => ({
  EditableNodeLabel: ({ label }: any) => (
    <div data-testid="editable-label">{label ?? "(no label)"}</div>
  ),
}))

vi.mock("../handle-icon", () => ({
  HandleIcon: ({ icon }: any) => <div data-testid="handle-icon">{icon}</div>,
}))

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "C1",
    data: {
      label: "Reduce",
      strategyId: "concat",
      strategyConfig: {},
    },
    selected: false,
    ...overrides,
  } as any
  return render(<ReduceNode {...defaultProps} />)
}

describe("ReduceNode", () => {
  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes processing category", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "processing")
  })

  it("passes zero credits (strategy cost surfaced in config panel, not header)", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "0")
  })

  it("renders the strategy label as subtitle", () => {
    renderNode({
      data: { label: "Reduce", strategyId: "pick-best-llm", strategyConfig: {} },
    })
    expect(screen.getByText(/pick best/i)).toBeInTheDocument()
  })

  it("renders 'N → 1' pill when upstream listResults are available", () => {
    renderNode({
      data: {
        label: "Reduce",
        strategyId: "concat",
        strategyConfig: {},
        __upstreamCount: 5,
      },
    })
    expect(screen.getByText(/5\s*→\s*1/)).toBeInTheDocument()
  })

  it("renders idle pill (no count) when upstream has not run", () => {
    renderNode({
      data: { label: "Reduce", strategyId: "concat", strategyConfig: {} },
    })
    const pill = screen.queryByText(/→\s*1/)
    expect(pill).toBeNull()
  })

  it("falls back to 'Reduce' when the strategyId is unknown", () => {
    renderNode({
      data: { label: "Reduce", strategyId: "nonexistent-strategy", strategyConfig: {} },
    })
    // Strategy subtitle should fall back to "Reduce"
    const baseNode = screen.getByTestId("base-node")
    expect(baseNode.textContent ?? "").toContain("Reduce")
  })

  it("declares target input and source output handles via BaseNode", () => {
    renderNode()
    const handles = JSON.parse(screen.getByTestId("base-node").getAttribute("data-handles") ?? "[]")
    expect(handles).toEqual(
      expect.arrayContaining([
        { id: "in", type: "target" },
        { id: "out", type: "source" },
      ]),
    )
  })
})
