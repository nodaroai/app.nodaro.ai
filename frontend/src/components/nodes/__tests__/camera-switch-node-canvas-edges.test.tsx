// A read-only template or tutorial canvas renders Camera Switch with edges of
// its own — they never enter the workflow store, and a tutorial never loads
// the viewer's availability. A wire on the Speaker map pip there must still
// draw the pip: the node reads the wire from React Flow's own store.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { ReactFlowProvider, type Edge } from "@xyflow/react"

const m = vi.hoisted(() => ({ popoverHandles: [] as string[] }))

vi.mock("../base-node", () => ({ BaseNode: ({ children }: any) => <div>{children}</div> }))
vi.mock("../handle-with-popover", () => ({
  HandleWithPopover: ({ handleId, type }: any) => {
    if (type === "target") m.popoverHandles.push(handleId)
    return null
  },
}))
vi.mock("../node-quick-strip", () => ({ NodeQuickStrip: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("@/components/ui/json-tree", () => ({ JsonTree: () => null }))
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 10 }))
// The workflow store is empty: no nodes, no edges.
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({ updateNodeData: () => {}, nodes: [], edges: [] }),
}))

import { CameraSwitchNode } from "../camera-switch-node"

function renderOnCanvas(edges: Edge[]) {
  m.popoverHandles = []
  render(
    <ReactFlowProvider initialEdges={edges}>
      <CameraSwitchNode {...({ id: "cs", data: { label: "Camera Switch" }, selected: false } as any)} />
    </ReactFlowProvider>,
  )
}

describe("Camera Switch reads its Speaker map wire from the canvas's own edges", () => {
  afterEach(() => cleanup())

  it("a canvas wire on the pip draws it, with no availability loaded and nothing in the workflow store", () => {
    renderOnCanvas([{ id: "e1", source: "sm", sourceHandle: "json", target: "cs", targetHandle: "speakerMap" }])
    expect(m.popoverHandles).toContain("speakerMap")
  })

  it("without a wire, the withheld pip is not drawn", () => {
    renderOnCanvas([{ id: "e1", source: "ep", sourceHandle: "edl", target: "cs", targetHandle: "edl" }])
    expect(m.popoverHandles).toEqual(["edl", "transcript"])
  })
})
