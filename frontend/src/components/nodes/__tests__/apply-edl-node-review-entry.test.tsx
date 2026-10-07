// The review's entries on a render's node face (A3-5, R18 a): "Review cut" is
// there for any take on show, or none — it is the one control that is not
// Preview-gated — and the "edited since" note only under a Preview that is on
// show. Render final / Update preview stay under a Preview (A6.1).
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
vi.mock("@/components/render/review-cut-button", () => ({
  ReviewCutButton: ({ renderId }: { renderId: string }) => <button data-testid="review-cut">{renderId}</button>,
}))
vi.mock("@/components/render/edited-since-note", () => ({
  EditedSincePreviewNote: ({ renderId }: { renderId: string }) => <p data-testid="edited-since">{renderId}</p>,
}))

import { ApplyEdlNode } from "../apply-edl-node"

const take = (url: string, quality?: "proxy" | "final") => ({ url, jobId: url, timestamp: "t", ...(quality ? { quality } : {}) })

function renderNode(data: Record<string, unknown>) {
  return render(<ApplyEdlNode {...({ id: "node-1", data: { label: "Apply EDL", executionStatus: "completed", ...data }, selected: false } as any)} />)
}

describe("ApplyEdlNode — Review cut", () => {
  afterEach(() => cleanup())

  it.each([
    ["a Preview", { quality: "proxy", generatedResults: [take("p.mp4", "proxy")], generatedVideoUrl: "p.mp4" }],
    ["a Final", { quality: "proxy", generatedResults: [take("f.mp4", "final")], generatedVideoUrl: "f.mp4" }],
    ["an unstamped take", { quality: "proxy", generatedResults: [take("old.mp4")] }],
    ["no take at all", { quality: "final" }],
    ["a failed run", { executionStatus: "failed" }],
  ])("is on the face with %s on show, for this render", (_label, data) => {
    renderNode(data)
    expect(screen.getByTestId("review-cut").textContent).toBe("node-1")
  })

  it("is on the face while the render runs: the review opens, edits locked", () => {
    renderNode({ executionStatus: "running", generatedResults: [take("p.mp4", "proxy")] })
    expect(screen.getByTestId("review-cut")).toBeTruthy()
  })
})

describe("ApplyEdlNode — edited since this preview", () => {
  afterEach(() => cleanup())

  it("is asked under a Preview on show", () => {
    renderNode({ quality: "proxy", generatedResults: [take("p.mp4", "proxy")], generatedVideoUrl: "p.mp4" })
    expect(screen.getByTestId("edited-since").textContent).toBe("node-1")
  })

  it("is not asked under a Final, an unstamped take or no take", () => {
    renderNode({ generatedResults: [take("f.mp4", "final")], generatedVideoUrl: "f.mp4" })
    expect(screen.queryByTestId("edited-since")).toBeNull()
    cleanup()
    renderNode({ generatedResults: [take("old.mp4")] })
    expect(screen.queryByTestId("edited-since")).toBeNull()
    cleanup()
    renderNode({})
    expect(screen.queryByTestId("edited-since")).toBeNull()
  })
})
