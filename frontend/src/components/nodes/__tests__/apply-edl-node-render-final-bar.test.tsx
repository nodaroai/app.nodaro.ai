// Render final / Update preview under a Preview (A6.1): the bar shows while the
// take on show IS a Preview — read from its stamp, never from the node's Quality
// setting (a Render final runs with a one-shot override while the node stays on
// Preview) — and not on a final, an unstamped take or an empty node.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, id }: any) => <div data-testid={`handle-${type}-${id}`} />,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))
vi.mock("../base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))
vi.mock("../handle-with-popover", () => ({
  HandleWithPopover: () => null,
  HANDLE_COLORS: { video: "#000", audio: "#000" },
}))
vi.mock("../run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({ updateNodeData: () => {}, runSingleNode: () => {} }),
}))
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 10 }))
vi.mock("@/hooks/use-apply-edl-estimate-minutes", () => ({ useApplyEdlEstimateMinutes: () => 1 }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: () => {} }),
}))
vi.mock("@/components/render/render-review-bar", () => ({
  RenderReviewBar: ({ renderId }: { renderId: string }) => <div data-testid="review-bar">{renderId}</div>,
}))

// The review entries read the canvas; this test stands the store in with a stub.
vi.mock("@/components/render/review-cut-button", () => ({ ReviewCutButton: () => null }))
vi.mock("@/components/render/edited-since-note", () => ({ EditedSincePreviewNote: () => null }))

import { ApplyEdlNode } from "../apply-edl-node"

const take = (url: string, quality?: "proxy" | "final") => ({ url, jobId: url, timestamp: "t", ...(quality ? { quality } : {}) })

function renderNode(data: Record<string, unknown>) {
  return render(<ApplyEdlNode {...({ id: "node-1", data: { label: "Apply EDL", executionStatus: "completed", ...data }, selected: false } as any)} />)
}

describe("ApplyEdlNode — the review bar", () => {
  afterEach(() => cleanup())

  it("shows under a Preview take, for this render", () => {
    renderNode({ quality: "proxy", generatedResults: [take("p.mp4", "proxy")], generatedVideoUrl: "p.mp4" })
    expect(screen.getByTestId("review-bar").textContent).toBe("node-1")
  })

  it("follows the take on show: a final under a node still set to Preview has no bar", () => {
    renderNode({ quality: "proxy", generatedResults: [take("p.mp4", "proxy"), take("f.mp4", "final")], activeResultIndex: 1 })
    expect(screen.queryByTestId("review-bar")).toBeNull()
  })

  it("a take with no stamp, or no take at all, has no bar", () => {
    renderNode({ quality: "proxy", generatedResults: [take("old.mp4")] })
    expect(screen.queryByTestId("review-bar")).toBeNull()
    cleanup()
    renderNode({ quality: "proxy" })
    expect(screen.queryByTestId("review-bar")).toBeNull()
  })

  it("no bar while it renders", () => {
    renderNode({ quality: "proxy", executionStatus: "running", generatedResults: [take("p.mp4", "proxy")] })
    expect(screen.queryByTestId("review-bar")).toBeNull()
  })
})
