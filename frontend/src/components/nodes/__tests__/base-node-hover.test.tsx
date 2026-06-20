import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

// Unlike base-node.test.tsx (which mocks NodeToolbar to render children
// unconditionally), this suite makes NodeToolbar HONOR `isVisible` so the run
// strip's visibility is observable — that's the behavior under test.
vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ id, type }: any) => <div data-testid={`handle-${id}`} data-type={type} />,
  NodeToolbar: ({ children, isVisible }: any) =>
    isVisible ? <div data-testid="node-toolbar">{children}</div> : null,
  NodeResizeControl: ({ position }: any) => (
    <div data-testid="resize-control" data-position={position} />
  ),
  useStore: (sel: any) => sel({ transform: [0, 0, 1] }),
  useUpdateNodeInternals: () => () => {},
}))

vi.mock("../custom-handle", () => ({
  CustomHandle: ({ position }: any) => <div data-testid="zoom-handle" data-position={position} />,
}))

// The top toolbar (preset dropdown / 3-dots) is irrelevant to this suite —
// stub it so only the bottom run strip drives assertions.
vi.mock("../node-top-toolbar", () => ({
  NodeTopToolbar: () => null,
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

describe("BaseNode whole-node hover (sibling overlay)", () => {
  it("reveals the run strip when the node element is hovered, even though an absolutely-positioned sibling overlay covers BaseNode's own div", () => {
    // Mirror the real video-result node DOM: React Flow wraps the node in
    // `.react-flow__node`; the node component renders BaseNode plus a z-10
    // VideoResultOverlay sibling that covers the card once a result lands.
    const { container } = render(
      <div className="react-flow__node">
        <BaseNode
          id="n1"
          label="Node"
          icon={<span />}
          category="ai"
          handles={[]}
          topToolbarContent={<button>RUNME</button>}
        />
        {/* Stand-in for VideoResultOverlay: a sibling of BaseNode's div that
            intercepts pointer hits, so hover never reaches BaseNode's own div. */}
        <div data-testid="overlay" style={{ position: "absolute", inset: 0, zIndex: 10 }} />
      </div>,
    )

    // At rest the run strip is hidden (it is a hover affordance).
    expect(screen.queryByText("RUNME")).not.toBeInTheDocument()

    // Hovering anywhere on the node — including over the overlay — fires
    // `mouseenter` on the `.react-flow__node` element (the browser dispatches it
    // to every element the pointer enters). BaseNode must treat that as the node
    // being hovered and show the run strip.
    const host = container.querySelector(".react-flow__node") as HTMLElement
    fireEvent.mouseEnter(host)

    expect(screen.getByText("RUNME")).toBeInTheDocument()
  })

  it("hides the run strip a short grace period after the pointer leaves the node", () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <div className="react-flow__node">
          <BaseNode
            id="n1"
            label="Node"
            icon={<span />}
            category="ai"
            handles={[]}
            topToolbarContent={<button>RUNME</button>}
          />
        </div>,
      )
      const host = container.querySelector(".react-flow__node") as HTMLElement

      act(() => { fireEvent.mouseEnter(host) })
      expect(screen.getByText("RUNME")).toBeInTheDocument()

      // Leaving starts a grace timer (so the pointer can travel to the portaled
      // strip) — still visible immediately after leave.
      act(() => { fireEvent.mouseLeave(host) })
      expect(screen.getByText("RUNME")).toBeInTheDocument()

      // After the grace period elapses, the strip hides.
      act(() => { vi.advanceTimersByTime(1300) })
      expect(screen.queryByText("RUNME")).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
