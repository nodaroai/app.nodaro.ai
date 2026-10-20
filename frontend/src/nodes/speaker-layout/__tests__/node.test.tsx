// The Speaker Layout node's face: what it asks for when empty, the framed video
// it plays, its pips (Recordings top, Master audio bottom), the Preview's
// Render final bar, the camera note, and Continue on a failed run. A layout has
// no plan: no review inspector is offered from the node.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const store = vi.hoisted(() => ({ updateNodeData: vi.fn(), runSingleNode: vi.fn(), nodes: [{ id: "sl1", type: "speaker-layout", data: {} }], edges: [] }))
const fanOut = vi.hoisted(() => ({ listDriven: false }))
const pips = vi.hoisted(() => ({ masterShown: true }))
vi.mock("@/hooks/use-target-handle-shown", () => ({ useTargetHandleShown: (_id: string, _type: string, handle: string) => handle !== "masterAudio" || pips.masterShown }))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, id }: any) => <div data-testid={`handle-${type}-${id}`} />,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "sl1"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))
vi.mock("@/components/nodes/base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))
vi.mock("@/components/nodes/handle-with-popover", () => ({
  HandleWithPopover: ({ handleId, type, label, top }: any) => <div data-testid={`pip-${type}-${handleId}`} data-top={top}>{label}</div>,
  HANDLE_COLORS: { video: "#000", audio: "#111" },
}))
vi.mock("@/components/nodes/run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("@/components/nodes/editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("@/components/nodes/node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector(store),
}))
vi.mock("@/hooks/use-use-case-credits", () => ({ useUseCaseCredits: () => 10 }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: () => {} }),
}))
vi.mock("@/components/render/render-review-bar", () => ({ RenderReviewBar: ({ busy }: any) => <div data-testid="render-review-bar" data-busy={String(busy)} /> }))
vi.mock("@/components/editor/workflow-editor/use-case-render-final-set", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usecaseListDriven: () => fanOut.listDriven,
}))
vi.mock("@/components/render/review-cut-button", () => ({ ReviewCutButton: () => <div data-testid="review-cut" /> }))

import { NodeComponent as SpeakerLayoutNode } from "../node"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1]) => translate("en", key)

function renderNode(data: Record<string, unknown>) {
  return render(<SpeakerLayoutNode {...({ id: "sl1", type: "speaker-layout", data, selected: false } as any)} />)
}

afterEach(() => {
  cleanup()
  store.updateNodeData.mockReset()
  store.runSingleNode.mockReset()
  fanOut.listDriven = false
  pips.masterShown = true
})

const JOB = "00000000-0000-4000-8000-000000000001"
const preview = { label: "SL", fieldMappings: {}, reviewBeforeRender: true, executionStatus: "completed", generatedVideoUrl: "https://r2/p.mp4", generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: JOB }], useCaseJobId: JOB }

describe("SpeakerLayoutNode", () => {
  it("empty: asks for a video recording", () => {
    renderNode({ label: "Speaker Layout", fieldMappings: {} })
    expect(screen.getByText(t("node.speakerLayoutConnectRecording"))).toBeInTheDocument()
  })

  it("its pips: Recordings (top) and Master audio (bottom) in — the label tables' keys — the framed video and its edit out", () => {
    renderNode({ label: "SL", fieldMappings: {} })
    expect(screen.getByTestId("pip-target-media").textContent).toBe("Recordings")
    expect(screen.getByTestId("pip-target-masterAudio").textContent).toBe("Master audio")
    expect(["media", "masterAudio"].map((h) => screen.getByTestId(`pip-target-${h}`).getAttribute("data-top"))).toEqual(["24px", "calc(100% - 24px)"])
    expect(screen.getByTestId("pip-source-media").textContent).toBe(t("node.speakerLayoutVideo"))
    expect(screen.getByTestId("pip-source-json").textContent).toBe(t("node.speakerLayoutEdit"))
  })

  it("no Master audio pip for a viewer it is withheld from", () => {
    pips.masterShown = false
    renderNode({ label: "SL", fieldMappings: {} })
    expect(screen.queryByTestId("pip-target-masterAudio")).toBeNull()
    expect(screen.getByTestId("pip-target-media")).toBeInTheDocument()
  })

  it("a finished framed video plays", () => {
    renderNode({ label: "SL", fieldMappings: {}, executionStatus: "completed", generatedVideoUrl: "https://r2/f.mp4", generatedResults: [{ url: "https://r2/f.mp4", quality: "final" }] })
    expect(document.querySelector("video")?.getAttribute("src")).toBe("https://r2/f.mp4")
  })

  it("a Preview of a run it can continue offers Render final; no review inspector (a layout has no plan)", () => {
    renderNode(preview)
    expect(screen.getByTestId("render-review-bar")).toBeInTheDocument()
    expect(screen.queryByTestId("review-cut")).toBeNull()
  })

  it("a click that queued the run keeps the bar, busy", () => {
    renderNode({ ...preview, executionStatus: "pending" })
    expect(screen.getByTestId("render-review-bar").getAttribute("data-busy")).toBe("true")
  })

  it("no Render final for a Final take, a take naming no run, or a list-driven node", () => {
    renderNode({ ...preview, generatedResults: [{ url: "https://r2/f.mp4", quality: "final", jobId: JOB }] })
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
    cleanup()
    renderNode({ ...preview, generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy" }] })
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
    cleanup()
    fanOut.listDriven = true
    renderNode(preview)
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
  })

  it("under a multicam take, the camera note", () => {
    renderNode({
      label: "SL", fieldMappings: {}, executionStatus: "completed", generatedVideoUrl: "https://r2/f.mp4", generatedResults: [{ url: "https://r2/f.mp4", quality: "final" }],
      useCaseCameras: { speakers: [{ speaker: "speaker_1", ordinal: 1, camera: null, marginDb: 0.4 }], syncNotes: ["weak"], mapNotes: [] },
    })
    expect(screen.getByText(translate("en", "node.usecaseCameraUnclear", { n: 1 }))).toBeInTheDocument()
    expect(screen.getByText(t("node.usecaseCameraSyncWeak"))).toBeInTheDocument()
  })

  it("a failed run offers Continue (its own run, from where it failed) — never Render final beside it", async () => {
    renderNode({ ...preview, executionStatus: "failed", errorMessage: "Speaker View: boom", useCaseJobId: "job-0" })
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: t("node.tightenContinue") }))
    expect(store.runSingleNode).toHaveBeenCalledWith("sl1", { usecaseContinue: { mode: "from-failed", jobId: "job-0" } })
  })

  it("a refused Render final shows its words, and offers no Continue", () => {
    renderNode({ ...preview, executionStatus: "failed", errorMessage: "Already rendered with this edit.", errorCode: "render_final_already_rendered", useCaseJobId: "job-0" })
    expect(screen.getByText(t("runContinuation.alreadyRendered"))).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: t("node.tightenContinue") })).toBeNull()
  })
})
