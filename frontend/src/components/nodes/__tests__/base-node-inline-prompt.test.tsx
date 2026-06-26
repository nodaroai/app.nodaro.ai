import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// Mutable config the hoisted mocks read at render time. `vi.hoisted` so the
// holder exists before the (hoisted) mock factories run. Each test reassigns
// `cfg.store` / `cfg.xyflow` via setup() before rendering.
const cfg = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  xyflow: {} as Record<string, unknown>,
}))

// BaseNode reads `elementsSelectable` (inline gate) and `transform` (run strip)
// from the React Flow store via useStore.
vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ id, type }: any) => <div data-testid={`handle-${id}`} data-type={type} />,
  NodeToolbar: ({ children }: any) => <div>{children}</div>,
  NodeResizeControl: ({ position }: any) => <div data-testid="resize-control" data-position={position} />,
  useStore: (sel: any) => sel(cfg.xyflow),
  useUpdateNodeInternals: () => () => {},
}))

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
vi.mock("lucide-react", () => ({ MoreHorizontal: (p: any) => <span {...p} /> }))

// Stub the heavy TipTap editor. This suite asserts BaseNode's DECISION to mount
// the inline editor (the `showInline` gate), not the editor's internals — those
// are covered by inline-node-prompt's own tests.
vi.mock("../inline-node-prompt/inline-node-prompt", () => ({
  InlineNodePrompt: ({ nodeId }: any) => <div data-testid="inline-node-prompt" data-node-id={nodeId} />,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign((selector: any) => selector(cfg.store), {
    getState: () => cfg.store,
    setState: () => {},
  }),
}))

import { BaseNode } from "../base-node"

function setup({
  inlinePromptMode = true,
  elementsSelectable = true,
  nodeType = "generate-image",
}: { inlinePromptMode?: boolean; elementsSelectable?: boolean; nodeType?: string } = {}) {
  cfg.store = {
    nodes: [{ id: "n1", type: nodeType, data: {} }],
    updateNodeWithData: () => {},
    newNodeIds: new Set(),
    clearNewNode: () => {},
    selectedNodeId: null,
    quickStripPinnedNodeId: null,
    inlinePromptMode,
  }
  cfg.xyflow = { transform: [0, 0, 1], elementsSelectable }
  return render(
    <BaseNode id="n1" label="Node" icon={<span />} category="ai" handles={[]}>
      <div>body</div>
    </BaseNode>,
  )
}

// The inline 3-mode editor was historically hand-wired into only generate-image
// and generate-video. It now lives in BaseNode, driven purely by the registry
// (`nodeHasInlinePrompt`) gated on the global toggle + an editable canvas, so it
// rolls out to every media-preview node with zero per-node wiring. These tests
// lock that gate: flagged nodes mount it, everything else stays untouched.
describe("BaseNode inline prompt (centralized gate)", () => {
  it("mounts the inline editor for a flagged media-preview node when inline mode is on", () => {
    setup({ nodeType: "generate-image" })
    const inline = screen.getByTestId("inline-node-prompt")
    expect(inline).toBeInTheDocument()
    expect(inline).toHaveAttribute("data-node-id", "n1")
  })

  it("mounts the inline editor for a newly-covered flagged node (voice-design)", () => {
    setup({ nodeType: "voice-design" })
    expect(screen.getByTestId("inline-node-prompt")).toBeInTheDocument()
  })

  it("does NOT mount the inline editor for a non-flagged node type (llm-chat)", () => {
    setup({ nodeType: "llm-chat" })
    expect(screen.queryByTestId("inline-node-prompt")).not.toBeInTheDocument()
  })

  it("does NOT mount the inline editor when inline mode is off (default look preserved)", () => {
    setup({ nodeType: "generate-image", inlinePromptMode: false })
    expect(screen.queryByTestId("inline-node-prompt")).not.toBeInTheDocument()
  })

  it("does NOT mount the inline editor in a read-only canvas (elementsSelectable false)", () => {
    setup({ nodeType: "generate-image", elementsSelectable: false })
    expect(screen.queryByTestId("inline-node-prompt")).not.toBeInTheDocument()
  })

  it("still renders the node body when inline is active", () => {
    setup({ nodeType: "generate-image" })
    expect(screen.getByText("body")).toBeInTheDocument()
  })
})
