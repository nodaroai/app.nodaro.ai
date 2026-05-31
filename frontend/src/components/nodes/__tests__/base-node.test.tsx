import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// BaseNode imports only these from @xyflow/react.
vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ id, type }: any) => <div data-testid={`handle-${id}`} data-type={type} />,
  NodeToolbar: ({ children }: any) => <div data-testid="node-toolbar">{children}</div>,
  NodeResizeControl: ({ position }: any) => (
    <div data-testid="resize-control" data-position={position} />
  ),
  useUpdateNodeInternals: () => () => {},
}))

// Stub the magnifier so the gate is observable by test id.
vi.mock("../custom-handle", () => ({
  CustomHandle: ({ position }: any) => <div data-testid="zoom-handle" data-position={position} />,
}))

vi.mock("@/components/editor/mobile-canvas-context", () => ({
  useMobileCanvas: () => ({ isMobile: false }),
}))

vi.mock("@/hooks/use-alt-key", () => ({
  useAltKeyStore: (selector: any) => selector({ pressed: false }),
}))

vi.mock("@/components/editor/workflow-editor/use-node-insert-animation", () => ({
  useNodeInsertAnimation: () => undefined,
}))

vi.mock("lucide-react", () => ({ MoreHorizontal: (p: any) => <span data-testid="more" {...p} /> }))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        nodes: [],
        updateNodeWithData: () => {},
        newNodeIds: new Set(),
        clearNewNode: () => {},
        selectedNodeId: null,
      }),
    { getState: () => ({ nodes: [] }) },
  ),
}))

import { BaseNode } from "../base-node"

function renderBase(props: Record<string, unknown> = {}) {
  return render(
    <BaseNode id="n1" label="Node" icon={<span />} category="ai" selected handles={[]} {...(props as any)} />,
  )
}

describe("BaseNode zoom handle", () => {
  it("renders the zoom magnifier when enableZoomHandle is set (ai category)", () => {
    renderBase({ enableZoomHandle: true })
    expect(screen.getByTestId("zoom-handle")).toBeInTheDocument()
    expect(screen.getAllByTestId("resize-control")).toHaveLength(1)
  })

  it("renders two plain resize dots (no magnifier) by default for ai category", () => {
    renderBase()
    expect(screen.queryByTestId("zoom-handle")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("resize-control")).toHaveLength(2)
  })

  it("still renders the magnifier for parameter category without the flag", () => {
    renderBase({ category: "parameter" })
    expect(screen.getByTestId("zoom-handle")).toBeInTheDocument()
    expect(screen.getAllByTestId("resize-control")).toHaveLength(1)
  })
})
