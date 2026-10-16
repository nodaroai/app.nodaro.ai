// The Tighten Episode node's face: what it asks for when empty, the episode it
// plays when done, and Continue on a failed run (a from-failed continuation of
// its own run, then the node runs again).
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const store = vi.hoisted(() => ({ updateNodeData: vi.fn(), runSingleNode: vi.fn(), nodes: [{ id: "t1", type: "tighten-episode", data: {} }], edges: [] }))
const fanOut = vi.hoisted(() => ({ listDriven: false }))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, id }: any) => <div data-testid={`handle-${type}-${id}`} />,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "t1"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))
vi.mock("../base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))
vi.mock("../handle-with-popover", () => ({
  HandleWithPopover: ({ handleId, type, label }: any) => <div data-testid={`pip-${type}-${handleId}`}>{label}</div>,
  HANDLE_COLORS: { video: "#000", audio: "#111" },
}))
vi.mock("../run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
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
vi.mock("@/components/render/review-cut-button", () => ({ ReviewCutButton: () => null }))

import { TightenEpisodeNode } from "../tighten-episode-node"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1]) => translate("en", key)

function renderNode(data: Record<string, unknown>) {
  return render(<TightenEpisodeNode {...({ id: "t1", data, selected: false } as any)} />)
}

afterEach(() => {
  cleanup()
  store.updateNodeData.mockReset()
  store.runSingleNode.mockReset()
  fanOut.listDriven = false
})

describe("TightenEpisodeNode", () => {
  it("empty: asks for a recording", () => {
    renderNode({ label: "Tighten Episode", fieldMappings: {} })
    expect(screen.getByText(t("node.tightenConnectRecording"))).toBeInTheDocument()
  })

  it("its pips: Recording and Music in (the label tables' keys), the episode and its edit out", () => {
    renderNode({ label: "T", fieldMappings: {} })
    expect(screen.getByTestId("pip-target-media").textContent).toBe("Recording")
    expect(screen.getByTestId("pip-target-music").textContent).toBe("Music")
    expect(screen.getByTestId("pip-source-media").textContent).toBe(t("node.tightenEpisodeVideo"))
    expect(screen.getByTestId("pip-source-json").textContent).toBe(t("node.tightenPlan"))
  })

  it("a finished video episode plays", () => {
    renderNode({ label: "T", fieldMappings: {}, executionStatus: "completed", generatedVideoUrl: "https://r2/ep.mp4", generatedResults: [{ url: "https://r2/ep.mp4", quality: "final" }] })
    expect(document.querySelector("video")?.getAttribute("src")).toBe("https://r2/ep.mp4")
  })

  it("a finished audio episode plays as audio, and its media pip says so", () => {
    renderNode({ label: "T", fieldMappings: {}, executionStatus: "completed", output: "audio", generatedAudioUrl: "https://r2/ep.m4a", generatedResults: [{ url: "https://r2/ep.m4a" }] })
    expect(document.querySelector("video")).toBeNull()
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("https://r2/ep.m4a")
    expect(screen.getByTestId("pip-source-media").textContent).toBe(t("node.tightenEpisodeAudio"))
  })

  it("a failed run offers Continue, which runs the node as a from-failed continuation of its job — that run's option, never node data", async () => {
    renderNode({ label: "T", fieldMappings: {}, executionStatus: "failed", errorMessage: "Apply Cut: boom", useCaseJobId: "job-0" })
    expect(screen.getByText("Apply Cut: boom")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: t("node.tightenContinue") }))
    expect(store.runSingleNode).toHaveBeenCalledWith("t1", { usecaseContinue: { mode: "from-failed", jobId: "job-0" } })
    // Nothing is written on the node: a click that never starts leaves no continuation behind.
    expect(store.updateNodeData).not.toHaveBeenCalledWith("t1", expect.objectContaining({ useCaseContinue: expect.anything() }))
  })

  it("a failed run that never started its job offers no Continue", () => {
    renderNode({ label: "T", fieldMappings: {}, executionStatus: "failed", errorMessage: "boom" })
    expect(screen.queryByRole("button", { name: t("node.tightenContinue") })).toBeNull()
  })

  it("the take on show plays as its own file's medium — an audio take beside a stale video URL is audio", () => {
    renderNode({
      label: "T", fieldMappings: {}, executionStatus: "completed",
      generatedVideoUrl: "https://r2/old.mp4", generatedAudioUrl: "https://r2/ep.m4a",
      generatedResults: [{ url: "https://r2/ep.m4a" }, { url: "https://r2/old.mp4" }], activeResultIndex: 0,
    })
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("https://r2/ep.m4a")
    expect(document.querySelector("video")).toBeNull()
  })

  const preview = { label: "T", fieldMappings: {}, executionStatus: "completed", generatedVideoUrl: "https://r2/p.mp4", generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: "00000000-0000-4000-8000-000000000001" }] }

  it("a Preview take of a run it can continue offers Render final", () => {
    renderNode({ ...preview, useCaseJobId: "00000000-0000-4000-8000-000000000001" })
    expect(screen.getByTestId("render-review-bar")).toBeInTheDocument()
  })

  it("a click that queued the run keeps the bar, busy — it does not vanish", () => {
    renderNode({ ...preview, executionStatus: "pending" })
    expect(screen.getByTestId("render-review-bar").getAttribute("data-busy")).toBe("true")
  })

  it("no Render final when the take names no run", () => {
    renderNode({ ...preview, useCaseJobId: "00000000-0000-4000-8000-000000000001", generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy" }] })
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
  })

  it("a failed run under an earlier Preview offers Continue only — never Render final beside it", () => {
    renderNode({ ...preview, executionStatus: "failed", errorMessage: "boom", useCaseJobId: "00000000-0000-4000-8000-000000000002" })
    expect(screen.getByRole("button", { name: t("node.tightenContinue") })).toBeInTheDocument()
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
  })

  it("a Final on show (review off, or a Render final done) offers no Render final", () => {
    renderNode({ ...preview, useCaseJobId: "00000000-0000-4000-8000-000000000001", generatedResults: [{ url: "https://r2/f.mp4", quality: "final", jobId: "00000000-0000-4000-8000-00000000000f" }] })
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
  })

  it("a list-driven node (one run per item) offers neither Render final nor Continue", () => {
    fanOut.listDriven = true
    renderNode({ ...preview, useCaseJobId: "00000000-0000-4000-8000-000000000001" })
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
    cleanup()
    renderNode({ label: "T", fieldMappings: {}, executionStatus: "failed", errorMessage: "boom", useCaseJobId: "job-0" })
    expect(screen.queryByRole("button", { name: t("node.tightenContinue") })).toBeNull()
  })

  it("a failed run under an earlier take keeps the take and shows a compact strip", () => {
    renderNode({ ...preview, executionStatus: "failed", errorMessage: "boom", useCaseJobId: "job-0", generatedResults: [{ url: "https://r2/p.mp4", quality: "final" }] })
    expect(screen.getByText("boom")).toBeInTheDocument()
    const strip = screen.getByText("boom").closest("div.bg-red-500\\/5")!
    expect(strip.className).not.toMatch(/flex-1/)
  })

  it("a refused Render final shows its words in the reader's language, and offers no Continue", () => {
    renderNode({ ...preview, executionStatus: "failed", errorMessage: "Already rendered with this edit.", errorCode: "render_final_already_rendered", useCaseJobId: "job-0" })
    expect(screen.getByText(t("runContinuation.alreadyRendered"))).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: t("node.tightenContinue") })).toBeNull()
  })
})
