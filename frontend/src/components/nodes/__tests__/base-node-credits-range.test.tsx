/**
 * A price that depends on a length the editor does not know yet (Video Mask's
 * clip, Mask Composite's foreground) shows as a RANGE — from the cheapest row
 * up to the most it can cost — with a tooltip that says the video's length
 * decides it (decided 2026-10-12: "should be up to X"). Speech keeps its text tooltip.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ id, type }: any) => <div data-testid={`handle-${id}`} data-type={type} />,
  NodeToolbar: ({ children }: any) => <div data-testid="node-toolbar">{children}</div>,
  NodeResizeControl: ({ position }: any) => <div data-testid="resize-control" data-position={position} />,
  useStore: (sel: any) => sel({ transform: [0, 0, 1] }),
  useUpdateNodeInternals: () => () => {},
}))
vi.mock("../custom-handle", () => ({ CustomHandle: () => <div data-testid="zoom-handle" /> }))
vi.mock("@/components/editor/mobile-canvas-context", () => ({ useMobileCanvas: () => ({ isMobile: false }) }))
vi.mock("@/hooks/use-alt-key", () => ({ useAltKeyStore: (selector: any) => selector({ pressed: false }) }))
vi.mock("@/components/editor/workflow-editor/use-node-insert-animation", () => ({ useNodeInsertAnimation: () => undefined }))
vi.mock("../node-policy-overlay", () => ({ NodePolicyOverlay: () => <div data-testid="policy-overlay" /> }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

/** A small stateful store: one node with the size a person once dragged it to. */
const store = vi.hoisted(() => {
  let state: Record<string, unknown> = {}
  const api = {
    reset(node: Record<string, unknown>) {
      state = { nodes: [node], updateNodeWithData: () => {}, newNodeIds: new Set(), clearNewNode: () => {}, selectedNodeId: null }
    },
    getState: () => state,
    setState: (patch: unknown) => {
      state = { ...state, ...(typeof patch === "function" ? (patch as (s: unknown) => object)(state) : (patch as object)) }
    },
    node: () => (state.nodes as Array<Record<string, unknown>>)[0]!,
  }
  return api
})
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign((selector: any) => selector(store.getState()), { getState: store.getState, setState: store.setState }),
}))

vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => true }))

import { BaseNode } from "../base-node"

describe("BaseNode credit range", () => {
  it("a length-priced node shows min–max with the video-length tooltip", () => {
    store.reset({ id: "n1", type: "video-mask", data: {} })
    render(<BaseNode id="n1" label="Video Mask" icon={<span />} category="ai" handles={[]} creditsRange={{ min: 50, max: 2825 }} creditsRangeBasis="length" />)
    const badge = screen.getByTestId("node-credits-range")
    expect(badge.textContent).toBe("50–2825cr")
    expect(badge.getAttribute("title")).toBe("From 50 up to 2825 credits — priced by the video's length when it runs")
  })
  it("speech keeps the text tooltip", () => {
    store.reset({ id: "n1", type: "text-to-speech", data: {} })
    render(<BaseNode id="n1" label="Speech" icon={<span />} category="ai" handles={[]} creditsRange={{ min: 8, max: 80 }} />)
    expect(screen.getByTestId("node-credits-range").getAttribute("title")).toContain("text that arrives at run time")
  })
})
