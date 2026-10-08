// Review on the Speaker View node face (C3.4, as on Apply EDL's: A3-5, A6.1):
// Review cut for any take or none; "Edited since this preview" and the Render
// final / Update preview bar while the take on show is a Preview. Until C4 sets
// a price the bar is there but cannot run, says why, and quotes no price.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

const { store, strip } = vi.hoisted(() => ({
  store: { nodes: [] as unknown[], edges: [] as unknown[], updateNodeData: vi.fn() },
  strip: { props: undefined as undefined | Record<string, unknown> },
}))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "sv"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))
vi.mock("../base-node", () => ({ BaseNode: ({ children, topToolbarContent }: any) => <div data-testid="base-node">{topToolbarContent}{children}</div> }))
vi.mock("../handle-with-popover", () => ({ HandleWithPopover: ({ handleId, type }: any) => <i data-testid={`handle-${type}-${handleId}`} />, HANDLE_COLORS: { video: "#000", audio: "#000" } }))
vi.mock("../node-quick-strip", () => ({ NodeQuickStrip: (props: Record<string, unknown>) => { strip.props = props; return null } }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => <span>progress</span> }))
vi.mock("lucide-react", () => new Proxy({}, { get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined), has: () => true }))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: (selector: any) => selector(store) }))
vi.mock("@/hooks/use-render-final", () => ({
  useRenderFinal: () => ({ renderFinal: vi.fn(), updatePreview: vi.fn(), finalCredits: 0, previewCredits: 0, canUpdatePreview: true, checkPending: false, checking: null }),
}))
vi.mock("@/components/render/review-cut-button", () => ({ ReviewCutButton: ({ renderId }: { renderId: string }) => <i data-testid={`review-cut-${renderId}`} /> }))
vi.mock("@/components/render/edited-since-note", () => ({ EditedSincePreviewNote: ({ renderId }: { renderId: string }) => <i data-testid={`edited-since-${renderId}`} /> }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({ useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: () => {} }) }))

import { SpeakerViewNode } from "../speaker-view-node"
import { translate } from "@/lib/i18n"

const take = (url: string, quality: "proxy" | "final") => ({ url, jobId: url, timestamp: "t", quality })
const t = (key: Parameters<typeof translate>[1]) => translate("en", key)

function renderNode(data: Record<string, unknown> = {}) {
  store.nodes = [{ id: "sv", type: "speaker-view", data }]
  return render(<SpeakerViewNode {...({ id: "sv", data: { label: "Speaker View", ...data }, selected: false } as any)} />)
}

afterEach(() => { cleanup(); store.nodes = []; store.edges = [] })

describe("SpeakerViewNode review (C3.4)", () => {
  it("a Preview on show: the review bar, disabled with why and no price, plus Review cut and the edited-since note", () => {
    renderNode({ executionStatus: "completed", generatedResults: [take("p.mp4", "proxy")], generatedVideoUrl: "p.mp4" })
    expect(screen.getByTestId("render-review-refusal").textContent).toBe(t("speakerView.notPriced"))
    for (const name of [/^Render final$/, /^Update preview$/]) expect((screen.getByText(name).closest("button") as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId("review-cut-sv")).toBeTruthy()
    expect(screen.getByTestId("edited-since-sv")).toBeTruthy()
  })

  it("a Final on show: no review bar and no edited-since note, Review cut stays", () => {
    renderNode({ executionStatus: "completed", generatedResults: [take("f.mp4", "final")], generatedVideoUrl: "f.mp4" })
    expect(screen.queryByText(/^Render final$/)).toBeNull()
    expect(screen.queryByTestId("edited-since-sv")).toBeNull()
    expect(screen.getByTestId("review-cut-sv")).toBeTruthy()
  })

  it("no take yet: Review cut only (it hides itself where no review can open)", () => {
    renderNode()
    expect(screen.queryByText(/^Render final$/)).toBeNull()
    expect(screen.getByTestId("review-cut-sv")).toBeTruthy()
  })
})
