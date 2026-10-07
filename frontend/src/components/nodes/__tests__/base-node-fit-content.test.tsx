/**
 * `fitContent`: a content-driven card (a feed, a scrape) never keeps a stored
 * height. React Flow applies `node.height` to the node wrapper and the body
 * clips behind it — Asaf's feed node carried height 565 from an older, shorter
 * card, and the new card's arrows, thumbnails and "View all" fell below the
 * edge (2026-10-06). The width a person chose stays.
 */
import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"

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

import { BaseNode } from "../base-node"

const resized = () => ({ id: "n1", type: "telegram-channel-feed", width: 602, height: 565, className: "rf-resized", measured: { width: 602, height: 565 }, data: {} })

describe("BaseNode fitContent", () => {
  it("drops a stored height so the card is as tall as its content — the width a person chose stays", () => {
    store.reset(resized())
    render(<BaseNode id="n1" label="Feed" icon={<span />} category="input" handles={[]} fitContent />)
    expect(store.node().height).toBeUndefined()
    expect(store.node().width).toBe(602)
    expect(store.node().className).toBe("rf-resized")
  })

  it("without fitContent a stored height is respected (every other card)", () => {
    store.reset(resized())
    render(<BaseNode id="n1" label="Feed" icon={<span />} category="input" handles={[]} />)
    expect(store.node().height).toBe(565)
  })
})
