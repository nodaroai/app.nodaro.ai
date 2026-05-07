import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — all declared before component imports
// ---------------------------------------------------------------------------

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Handle: ({ type, position, id }: any) => (
      <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
    ),
    NodeResizer: () => null,
    NodeToolbar: ({ children }: any) => <div data-testid="node-toolbar">{children}</div>,
    useStore: vi.fn(() => 1),
    useNodeId: vi.fn(() => "test-node"),
    useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
    useUpdateNodeInternals: vi.fn(() => vi.fn()),
  }
})

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning, handles, toolbarActions, topToolbarContent }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
      data-is-running={isRunning}
    >
      {handles?.map((h: any) => (
        <div
          key={h.id}
          data-testid={`handle-${h.id}`}
          data-type={h.type}
          data-position={h.position}
          data-label={h.label}
        />
      ))}
      {toolbarActions}
      {topToolbarContent}
      {children}
    </div>
  ),
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: any) => (
    <div data-testid="run-node-button" data-credits={props.credits} data-node-id={props.nodeId} />
  ),
}))

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  return { ...actual }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  EXECUTION_DATA_KEYS: new Set(["executionStatus"]),
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        updateNodeData: () => {},
        runSingleNode: () => {},
        nodes: [],
        edges: [],
      }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: () => 0,
}))

// ---------------------------------------------------------------------------
// Component imports (after all mocks)
// ---------------------------------------------------------------------------

import { SubWorkflowInputNode } from "../sub-workflow-input-node"
import { SubWorkflowOutputNode } from "../sub-workflow-output-node"
import { SubWorkflowNode } from "../sub-workflow-node"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderInputNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "sw-input-1",
    data: { label: "Sub-Workflow Input" },
    selected: false,
    ...overrides,
  } as any
  return render(<SubWorkflowInputNode {...defaultProps} />)
}

function renderOutputNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "sw-output-1",
    data: { label: "Sub-Workflow Output" },
    selected: false,
    ...overrides,
  } as any
  return render(<SubWorkflowOutputNode {...defaultProps} />)
}

function renderSubWorkflowNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "sw-1",
    data: { label: "Sub-Workflow" },
    selected: false,
    ...overrides,
  } as any
  return render(<SubWorkflowNode {...defaultProps} />)
}

// ---------------------------------------------------------------------------
// SubWorkflowInputNode
// ---------------------------------------------------------------------------

describe("SubWorkflowInputNode", () => {
  it("renders with empty data", () => {
    renderInputNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct category and credits", () => {
    renderInputNode()
    const base = screen.getByTestId("base-node")
    expect(base).toHaveAttribute("data-category", "processing")
    expect(base).toHaveAttribute("data-credits", "0")
  })

  it("shows placeholder when no ports", () => {
    renderInputNode({ data: { label: "Input", ports: [] } })
    expect(screen.getByText("Click to add ports...")).toBeInTheDocument()
  })

  it("renders port names with media types and colored dots", () => {
    renderInputNode({
      data: {
        label: "Input",
        ports: [
          { id: "p1", name: "Image In", mediaType: "image" },
          { id: "p2", name: "Text In", mediaType: "text" },
        ],
      },
    })
    expect(screen.getByText("Image In")).toBeInTheDocument()
    expect(screen.getByText("Text In")).toBeInTheDocument()
    expect(screen.getByText("(image)")).toBeInTheDocument()
    expect(screen.getByText("(text)")).toBeInTheDocument()
  })

  it("creates source handles for ports", () => {
    renderInputNode({
      data: {
        label: "Input",
        ports: [{ id: "p1", name: "Image", mediaType: "image" }],
      },
    })
    const handle = screen.getByTestId("handle-p1")
    expect(handle).toHaveAttribute("data-type", "source")
    expect(handle).toHaveAttribute("data-position", "right")
  })

  it("shows fallback handle when no ports", () => {
    renderInputNode({ data: { label: "Input", ports: [] } })
    const handle = screen.getByTestId("handle-out")
    expect(handle).toHaveAttribute("data-type", "source")
  })
})

// ---------------------------------------------------------------------------
// SubWorkflowOutputNode
// ---------------------------------------------------------------------------

describe("SubWorkflowOutputNode", () => {
  it("renders with empty data", () => {
    renderOutputNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct category and credits", () => {
    renderOutputNode()
    const base = screen.getByTestId("base-node")
    expect(base).toHaveAttribute("data-category", "processing")
    expect(base).toHaveAttribute("data-credits", "0")
  })

  it("shows placeholder when no ports", () => {
    renderOutputNode({ data: { label: "Output", ports: [] } })
    expect(screen.getByText("Click to add ports...")).toBeInTheDocument()
  })

  it("renders port names", () => {
    renderOutputNode({
      data: {
        label: "Output",
        ports: [{ id: "p1", name: "Video Out", mediaType: "video" }],
      },
    })
    expect(screen.getByText("Video Out")).toBeInTheDocument()
  })

  it("shows (visible) marker for visibleOutputPortId", () => {
    renderOutputNode({
      data: {
        label: "Output",
        ports: [
          { id: "p1", name: "Video Out", mediaType: "video" },
          { id: "p2", name: "Audio Out", mediaType: "audio" },
        ],
        visibleOutputPortId: "p1",
      },
    })
    expect(screen.getByText("(visible)")).toBeInTheDocument()
  })

  it("shows Preview label for visible port", () => {
    renderOutputNode({
      data: {
        label: "Output",
        ports: [{ id: "p1", name: "Result", mediaType: "image" }],
        visibleOutputPortId: "p1",
      },
    })
    expect(screen.getByText("Preview: Result")).toBeInTheDocument()
  })

  it("creates target handles for ports", () => {
    renderOutputNode({
      data: {
        label: "Output",
        ports: [{ id: "p1", name: "In", mediaType: "text" }],
      },
    })
    const handle = screen.getByTestId("handle-p1")
    expect(handle).toHaveAttribute("data-type", "target")
    expect(handle).toHaveAttribute("data-position", "left")
  })
})

// ---------------------------------------------------------------------------
// SubWorkflowNode
// ---------------------------------------------------------------------------

describe("SubWorkflowNode", () => {
  it("renders with empty data", () => {
    renderSubWorkflowNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct category and credits", () => {
    renderSubWorkflowNode()
    const base = screen.getByTestId("base-node")
    expect(base).toHaveAttribute("data-category", "processing")
    expect(base).toHaveAttribute("data-credits", "0")
  })

  it("shows 'Select a workflow...' placeholder when no referencedWorkflowId", () => {
    renderSubWorkflowNode({ data: { label: "Sub-Workflow" } })
    expect(screen.getByText("Select a workflow...")).toBeInTheDocument()
  })

  it("shows workflow name when referenced", () => {
    renderSubWorkflowNode({
      data: {
        label: "Sub-Workflow",
        referencedWorkflowId: "wf-1",
        referencedWorkflowName: "My Awesome Workflow",
      },
    })
    expect(screen.getByText("My Awesome Workflow")).toBeInTheDocument()
  })

  it("shows 'Unnamed' when referencedWorkflowName is empty", () => {
    renderSubWorkflowNode({
      data: {
        label: "Sub-Workflow",
        referencedWorkflowId: "wf-1",
        referencedWorkflowName: "",
      },
    })
    expect(screen.getByText("Unnamed")).toBeInTheDocument()
  })

  it("shows route label when routeSnapshot is set", () => {
    renderSubWorkflowNode({
      data: {
        label: "Sub-Workflow",
        referencedWorkflowId: "wf-1",
        referencedWorkflowName: "My WF",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process Image",
          inputPorts: [],
          outputPorts: [],
          visibleOutputPortId: "",
        },
      },
    })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "Process Image")
  })

  it("shows progress bar when running", () => {
    const { container } = renderSubWorkflowNode({
      data: {
        label: "Sub-Workflow",
        referencedWorkflowId: "wf-1",
        referencedWorkflowName: "WF",
        executionStatus: "running",
        subWorkflowProgress: { currentNode: "gen-1", completed: 2, total: 5 },
      },
    })
    expect(screen.getByText("2/5")).toBeInTheDocument()
    // Progress bar exists
    expect(container.querySelector(".bg-\\[\\#ff0073\\]")).toBeInTheDocument()
  })

  it("shows error message when failed", () => {
    renderSubWorkflowNode({
      data: {
        label: "Sub-Workflow",
        referencedWorkflowId: "wf-1",
        referencedWorkflowName: "WF",
        executionStatus: "failed",
        errorMessage: "Circular reference detected",
      },
    })
    expect(screen.getByText("Circular reference detected")).toBeInTheDocument()
  })

  it("shows image preview when completed with visible output", () => {
    renderSubWorkflowNode({
      data: {
        label: "Sub-Workflow",
        referencedWorkflowId: "wf-1",
        referencedWorkflowName: "WF",
        executionStatus: "completed",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process",
          inputPorts: [],
          outputPorts: [{ id: "p1", name: "Image Out", mediaType: "image" }],
          visibleOutputPortId: "p1",
        },
        outputResults: { p1: "https://example.com/result.png" },
      },
    })
    const img = screen.getByAltText("Output")
    expect(img).toHaveAttribute("src", "https://example.com/result.png")
  })

  it("shows fallback handles when no routeSnapshot", () => {
    renderSubWorkflowNode({ data: { label: "Sub-Workflow" } })
    expect(screen.getByTestId("handle-in")).toHaveAttribute("data-type", "target")
    expect(screen.getByTestId("handle-out")).toHaveAttribute("data-type", "source")
  })

  it("renders RunNodeButton with credits=0", () => {
    renderSubWorkflowNode()
    const btn = screen.getByTestId("run-node-button")
    expect(btn).toHaveAttribute("data-credits", "0")
    expect(btn).toHaveAttribute("data-node-id", "sw-1")
  })

  it("shows dynamic handles from routeSnapshot", () => {
    renderSubWorkflowNode({
      data: {
        label: "Sub-Workflow",
        referencedWorkflowId: "wf-1",
        referencedWorkflowName: "WF",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process",
          inputPorts: [{ id: "ip1", name: "Source Image", mediaType: "image" }],
          outputPorts: [{ id: "op1", name: "Result Video", mediaType: "video" }],
          visibleOutputPortId: "op1",
        },
      },
    })
    const inputHandle = screen.getByTestId("handle-in_ip1")
    expect(inputHandle).toHaveAttribute("data-type", "target")
    expect(inputHandle).toHaveAttribute("data-position", "left")

    const outputHandle = screen.getByTestId("handle-out_op1")
    expect(outputHandle).toHaveAttribute("data-type", "source")
    expect(outputHandle).toHaveAttribute("data-position", "right")
  })
})
