import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { ReactFlowProvider, type NodeProps } from "@xyflow/react"
import { useCanvasMode } from "@/components/nodes/read-only-canvas-context"

// A probe node type: it says which canvas mode it sees and whether React Flow
// drew it selected, so the canvas's own decisions are observable without the
// real node cards (those have their own BaseNode tests).
function ProbeNode({ id, data, selected }: NodeProps) {
  const mode = useCanvasMode()
  return (
    <div data-testid={`probe-${id}`} data-mode={mode} data-selected={String(!!selected)}>
      {(data as { label: string }).label}
    </div>
  )
}

vi.mock("@/components/nodes", () => ({ nodeTypes: { probe: ProbeNode } }))
vi.mock("@/components/editor/animated-flow-edge", () => ({ AnimatedFlowEdge: () => null }))

import { ReadOnlyCanvas } from "../read-only-canvas"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, extra: Partial<WorkflowNode> = {}): WorkflowNode =>
  ({ id, type: "probe", position: { x: 0, y: 0 }, data: { label: `Node ${id}` }, ...extra }) as WorkflowNode

function renderCanvas(nodes: WorkflowNode[], mode: "view" | "view-detached" = "view") {
  const edges: WorkflowEdge[] = []
  return render(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlowProvider>
        <ReadOnlyCanvas nodes={nodes} edges={edges} mode={mode} />
      </ReactFlowProvider>
    </div>,
  )
}

describe("ReadOnlyCanvas", () => {
  afterEach(() => cleanup())

  it("renders every visible node, tells each it is on a view-only canvas, and leaves hidden ones out", () => {
    renderCanvas([node("a"), node("b"), node("ghost", { hidden: true })])
    expect(screen.getByTestId("probe-a")).toHaveAttribute("data-mode", "view")
    expect(screen.getByTestId("probe-b")).toHaveTextContent("Node b")
    expect(screen.queryByTestId("probe-ghost")).toBeNull()
  })

  it("passes the detached mode through for the sub-workflow viewer", () => {
    renderCanvas([node("a")], "view-detached")
    expect(screen.getByTestId("probe-a")).toHaveAttribute("data-mode", "view-detached")
  })

  it("lets a view page's visitor move the cards, and nothing moves under the sub-workflow viewer", () => {
    const view = renderCanvas([node("a")])
    expect(view.container.querySelector(".react-flow__node")).toHaveClass("draggable")
    cleanup()
    const detached = renderCanvas([node("a")], "view-detached")
    expect(detached.container.querySelector(".react-flow__node")).not.toHaveClass("draggable")
  })

  it("never draws a node selected, even one saved selected", () => {
    renderCanvas([node("a", { selected: true })])
    expect(screen.getByTestId("probe-a")).toHaveAttribute("data-selected", "false")
  })

  it("marks the canvas view-only (the class globals.css hides node controls under)", () => {
    const { container } = renderCanvas([node("a")])
    expect(container.querySelector(".react-flow.workflow-view-canvas")).not.toBeNull()
  })
})
