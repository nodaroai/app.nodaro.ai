// The "Preview" label on the Apply EDL node (A1b, F1): read from the take on
// show — its stamped quality — never from the node's Quality setting (a Render
// final runs with a one-shot override while the node stays on Preview).
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
// The pill is `rate × minutes`: the core cost hook (react-query) and the minutes
// resolver (workflow store) are irrelevant to the copy under test.
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 10 }))
vi.mock("@/hooks/use-apply-edl-estimate-minutes", () => ({ useApplyEdlEstimateMinutes: () => 1 }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: () => {} }),
}))

import { ApplyEdlNode } from "../apply-edl-node"
import { translate } from "@/lib/i18n"

const take = (url: string, quality?: "proxy" | "final") => ({ url, jobId: url, timestamp: "t", ...(quality ? { quality } : {}) })

function renderNode(data: Record<string, unknown>) {
  return render(<ApplyEdlNode {...({ id: "node-1", data: { label: "Apply EDL", executionStatus: "completed", ...data }, selected: false } as any)} />)
}

describe("ApplyEdlNode — the Preview label", () => {
  afterEach(() => cleanup())

  it("labels a take rendered at proxy quality", () => {
    renderNode({ quality: "proxy", generatedResults: [take("p.mp4", "proxy")], generatedVideoUrl: "p.mp4" })
    expect(screen.getByText(translate("en", "node.renderPreviewBadge"))).toBeTruthy()
  })

  it("follows the take on show, not the node's Quality setting", () => {
    // Node set to Preview, but the selected take is a final.
    renderNode({ quality: "proxy", generatedResults: [take("p.mp4", "proxy"), take("f.mp4", "final")], activeResultIndex: 1 })
    expect(screen.queryByText(translate("en", "node.renderPreviewBadge"))).toBeNull()
  })

  it("a take with no stamp (rendered before takes carried one) is not labelled", () => {
    renderNode({ quality: "proxy", generatedResults: [take("old.mp4")] })
    expect(screen.queryByText(translate("en", "node.renderPreviewBadge"))).toBeNull()
  })
})
