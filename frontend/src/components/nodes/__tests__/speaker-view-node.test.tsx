// The Speaker View node face (U1b, C3.2): empty, ready (what it will render and
// whether the edit is valid), running, failed and a landed take — and, until C4
// sets a price, an honest "not priced yet" with Run disabled and no credit pill.
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
vi.mock("@/hooks/use-result-aspect-ratio", () => ({ useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: () => {} }) }))

import { SpeakerViewNode } from "../speaker-view-node"
import { translate } from "@/lib/i18n"

const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const seg = (id: string, inS: number, video: string, speaker?: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, ...(speaker ? { speaker } : {}) })
const EDL = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest")] }
const take = (url: string, quality?: "proxy" | "final") => ({ url, jobId: url, timestamp: "t", ...(quality ? { quality } : {}) })
const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

function wire(edl: unknown) {
  store.nodes = [{ id: "plan", type: "edit-plan", data: { generatedJson: edl } }, { id: "sv", type: "speaker-view", data: {} }]
  store.edges = [{ id: "e", source: "plan", target: "sv", targetHandle: "edl" }]
}
function renderNode(data: Record<string, unknown> = {}) {
  return render(<SpeakerViewNode {...({ id: "sv", data: { label: "Speaker View", ...data }, selected: false } as any)} />)
}

afterEach(() => { cleanup(); store.nodes = []; store.edges = []; strip.props = undefined; store.updateNodeData.mockClear() })

describe("SpeakerViewNode", () => {
  it("empty: says which input to wire", () => {
    renderNode()
    expect(screen.getByText(t("speakerView.connect"))).toBeTruthy()
  })

  it("ready: states aspect · layout · switch, the speakers and cameras, and that the edit is valid", () => {
    wire(EDL)
    renderNode({ targetAspect: "9:16", layout: "stacked", switchType: "pan" })
    expect(screen.getByTestId("speaker-view-summary").textContent).toBe(`9:16 · ${t("speakerView.layout.stacked")} · ${t("speakerView.switch.pan")}`)
    expect(screen.getByText(t("speakerView.inputSummary", { speakers: 2, cameras: 2 }))).toBeTruthy()
    expect(screen.getByTestId("edl-validity-badge").getAttribute("data-ok")).toBe("true")
  })

  it("ready but refused: the badge says the edit is not valid", () => {
    wire({ ...EDL, segments: EDL.segments.map(({ speaker: _s, ...rest }) => rest) })
    renderNode()
    expect(screen.getByTestId("edl-validity-badge").getAttribute("data-ok")).toBe("false")
  })

  it("says it is not priced yet, disables Run with that reason, and shows no credit pill", () => {
    wire(EDL)
    renderNode()
    expect(screen.getByTestId("speaker-view-not-priced").textContent).toBe(t("speakerView.notPriced"))
    expect(strip.props).toMatchObject({ nodeId: "sv", disabled: true, disabledReason: t("speakerView.notPriced") })
    expect(strip.props && "credits" in strip.props).toBe(false)
  })

  it("running: shows progress, not the summary", () => {
    wire(EDL)
    renderNode({ executionStatus: "running" })
    expect(screen.getByText("progress")).toBeTruthy()
    expect(screen.queryByTestId("speaker-view-summary")).toBeNull()
  })

  it("failed with no take: names the failure", () => {
    renderNode({ executionStatus: "failed", errorMessage: "boom" })
    expect(screen.getByText(t("node.failed"))).toBeTruthy()
    expect(screen.getByText("boom")).toBeTruthy()
  })

  it("a landed Preview carries the Preview label, read from the take (never the node's Quality)", () => {
    const { container } = renderNode({ executionStatus: "completed", quality: "final", generatedResults: [take("p.mp4", "proxy")], generatedVideoUrl: "p.mp4" })
    expect(screen.getByText(t("node.renderPreviewBadge"))).toBeTruthy()
    expect(container.querySelector("video")?.getAttribute("src")).toBe("p.mp4")
    cleanup()
    renderNode({ executionStatus: "completed", quality: "proxy", generatedResults: [take("f.mp4", "final")] })
    expect(screen.queryByText(t("node.renderPreviewBadge"))).toBeNull()
  })

  it("draws the handles the definition declares: edl and transcript in, video and json out", () => {
    renderNode()
    for (const id of ["target-edl", "target-transcript", "source-video", "source-json"]) expect(screen.getByTestId(`handle-${id}`)).toBeTruthy()
  })

  describe("defaults from the topology of the first edit (SV20)", () => {
    const oneCamera = { version: 1, clock: "master", sources: [src("w")], segments: [seg("s0", 0, "w", "Host"), seg("s1", 5, "w", "Guest")] }

    it("sets them once when an edit is known and the node has never been set", () => {
      wire(oneCamera)
      renderNode()
      expect(store.updateNodeData).toHaveBeenCalledWith("sv", { layout: "single", switchType: "pan", switchDurationMs: 600, emphasisStyle: "scale", emphasisDurationMs: 300, targetAspect: "16:9" })
    })

    it("two or more cameras: Auto and Cut", () => {
      wire(EDL)
      renderNode()
      expect(store.updateNodeData).toHaveBeenCalledWith("sv", expect.objectContaining({ layout: "auto", switchType: "cut" }))
    })

    it("never overwrites a setting the person already made, and waits for an edit", () => {
      wire(EDL)
      renderNode({ layout: "grid" })
      expect(store.updateNodeData).not.toHaveBeenCalled()
      cleanup()
      store.nodes = []
      store.edges = []
      renderNode()
      expect(store.updateNodeData).not.toHaveBeenCalled()
    })
  })
})
