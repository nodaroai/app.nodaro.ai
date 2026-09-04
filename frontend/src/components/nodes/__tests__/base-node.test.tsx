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
  // NodeRunStripShell (mounted only when a toolbar prop is passed) reads canvas
  // zoom via useStore((s) => s.transform[2]).
  useStore: (sel: any) => sel({ transform: [0, 0, 1] }),
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

// The job-policy overlay is stubbed so this file asserts the MOUNT, not the
// overlay's own rendering (that is node-policy-overlay.test.tsx's job).
vi.mock("../node-policy-overlay", () => ({
  NodePolicyOverlay: ({ nodeId }: any) => (
    <div data-testid="policy-overlay" data-node-id={nodeId} />
  ),
}))

vi.mock("lucide-react", () => new Proxy({ MoreHorizontal: (p: Record<string, unknown>) => <span data-testid="more" {...p} /> }, {
  get: (t, prop) => (prop in t ? (t as Record<PropertyKey, unknown>)[prop] : typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
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

describe("BaseNode run strip", () => {
  it("frames topToolbarContent in the shared zoom-scaled shell (every node looks the same)", () => {
    renderBase({ topToolbarContent: <button>RUNME</button> })
    const shell = screen.getByTestId("node-run-strip")
    expect(shell).toContainElement(screen.getByText("RUNME"))
  })

  it("renders rawToolbarContent as-is, NOT wrapped in the shell (bespoke self-framing toolbars)", () => {
    renderBase({ rawToolbarContent: <button>BESPOKE</button> })
    expect(screen.queryByTestId("node-run-strip")).not.toBeInTheDocument()
    expect(screen.getByText("BESPOKE")).toBeInTheDocument()
  })

  it("renders a settings-only strip when neither toolbar prop is set", () => {
    // Previously this asserted NO strip at all. That was correct while the
    // settings toggle floated off the node's right edge; now the strip is the
    // only way in, so a node passing no toolbar content still gets one — with
    // the settings button and nothing else.
    renderBase()
    expect(screen.getByTestId("node-run-strip")).toBeInTheDocument()
    expect(screen.getByTestId("node-settings-button")).toBeInTheDocument()
  })
})

describe("BaseNode job-policy overlay", () => {
  // D15 — the ONE mount point. `jobRecovering` was added as a per-card prop and
  // is passed by 1 of 98 call sites, so "Recovering…" has never reached a user.
  // BaseNode mounting the overlay itself is what makes "awaiting review" and
  // "blocked by content policy" reach ALL 98 cards, including card #99.
  it("mounts <NodePolicyOverlay> for its own node id, with no per-card prop", () => {
    renderBase()
    const overlay = screen.getByTestId("policy-overlay")
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveAttribute("data-node-id", "n1")
  })

  it("mounts exactly one overlay per card", () => {
    renderBase({ topToolbarContent: <button>RUNME</button> })
    expect(screen.getAllByTestId("policy-overlay")).toHaveLength(1)
  })
})
