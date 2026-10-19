// The Trailer node's face: what it asks for when empty, the trailer it plays
// when done with a chip per format of that run, the formats it could not
// render, Render final on a Preview and Continue on a failed run.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const store = vi.hoisted(() => ({ updateNodeData: vi.fn(), runSingleNode: vi.fn(), nodes: [{ id: "t1", type: "episode-trailer", data: {} }], edges: [] }))
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
vi.mock("@/components/nodes/base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))
vi.mock("@/components/nodes/handle-with-popover", () => ({
  HandleWithPopover: ({ handleId, type, label }: any) => <div data-testid={`pip-${type}-${handleId}`}>{label}</div>,
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
vi.mock("@/components/render/review-cut-button", () => ({ ReviewCutButton: () => null }))

import { NodeComponent as EpisodeTrailerNode } from "../node"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate("en", key, vars)

function renderNode(data: Record<string, unknown>) {
  return render(<EpisodeTrailerNode {...({ id: "t1", data, selected: false } as any)} />)
}

afterEach(() => {
  cleanup()
  store.updateNodeData.mockReset()
  store.runSingleNode.mockReset()
  fanOut.listDriven = false
})

const RUN = "00000000-0000-4000-8000-000000000007"
const OLDER = "00000000-0000-4000-8000-000000000006"
const done = {
  label: "Trailer", fieldMappings: {}, executionStatus: "completed",
  generatedVideoUrl: "https://r2/a.mp4",
  generatedResults: [
    { url: "https://r2/a.mp4", quality: "final", jobId: RUN, format: "9:16", timestamp: "t" },
    { url: "https://r2/b.mp4", quality: "final", jobId: RUN, format: "1:1", timestamp: "t" },
    { url: "https://r2/old.mp4", quality: "final", jobId: OLDER, format: "4:5", timestamp: "t" },
  ],
  activeResultIndex: 0,
}

describe("EpisodeTrailerNode", () => {
  it("empty: asks for a recording", () => {
    renderNode({ label: "Trailer", fieldMappings: {} })
    expect(screen.getByText(t("node.tightenConnectRecording"))).toBeInTheDocument()
  })

  it("its pips: Recording and Intro card in (the label tables' keys), the trailers and the plan out", () => {
    renderNode({ label: "T", fieldMappings: {} })
    expect(screen.getByTestId("pip-target-media").textContent).toBe("Recording")
    expect(screen.getByTestId("pip-target-introCard").textContent).toBe("Intro card")
    expect(screen.getByTestId("pip-source-media").textContent).toBe(t("node.trailerDeliveries"))
    expect(screen.getByTestId("pip-source-json").textContent).toBe(t("node.trailerPlan"))
  })

  it("a finished trailer plays the format on show, and offers a chip per format of THAT run only", () => {
    renderNode(done)
    expect(document.querySelector("video")?.getAttribute("src")).toBe("https://r2/a.mp4")
    expect(document.querySelector("audio")).toBeNull()
    const chips = screen.getAllByRole("button", { pressed: undefined }).filter((b) => b.hasAttribute("aria-pressed"))
    expect(chips.map((c) => c.textContent)).toEqual(["9:16", "1:1"])
    expect(chips[0]!.getAttribute("aria-pressed")).toBe("true")
  })

  it("a chip puts its format on show, as a pick in the results gallery does", async () => {
    renderNode(done)
    await userEvent.click(screen.getByRole("button", { name: "1:1" }))
    expect(store.updateNodeData).toHaveBeenCalledWith("t1", expect.objectContaining({ activeResultIndex: 1, generatedVideoUrl: "https://r2/b.mp4" }))
  })

  it("a take that names no format (a Preview, an older take) shows no chips", () => {
    renderNode({ ...done, generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: RUN, timestamp: "t" }] })
    expect(screen.queryByRole("button", { name: "9:16" })).toBeNull()
  })

  it("names the formats the run of the take on show could not render", () => {
    const rows = done.generatedResults.map((r) => (r.jobId === RUN ? { ...r, failedFormats: ["4:5", "16:9"] } : r))
    renderNode({ ...done, generatedResults: rows, failedFormats: ["4:5", "16:9"] })
    expect(screen.getByText(t("node.trailerFormatsFailed", { formats: "4:5, 16:9" }))).toBeInTheDocument()
  })

  it("an older take picked: names THAT run's failed formats, never the latest run's", () => {
    const rows = [
      { ...done.generatedResults[0]!, failedFormats: ["4:5"] },
      { ...done.generatedResults[1]!, failedFormats: ["4:5"] },
      { ...done.generatedResults[2]!, failedFormats: ["16:9"] },
    ]
    renderNode({ ...done, generatedResults: rows, failedFormats: ["4:5"], activeResultIndex: 2 })
    expect(screen.getByText(t("node.trailerFormatsFailed", { formats: "16:9" }))).toBeInTheDocument()
    expect(screen.queryByText(t("node.trailerFormatsFailed", { formats: "4:5" }))).toBeNull()
    cleanup()
    // An older take whose run delivered every format: no note, whatever the latest run failed.
    renderNode({ ...done, generatedResults: [rows[0]!, rows[1]!, done.generatedResults[2]!], failedFormats: ["4:5"], activeResultIndex: 2 })
    expect(screen.queryByText(/4:5/, { selector: "p" })).toBeNull()
  })

  it("never shows a format twice, even when a run's rows landed twice", () => {
    const twice = [...done.generatedResults.slice(0, 2), { ...done.generatedResults[0]!, url: "https://r2/a-again.mp4" }]
    renderNode({ ...done, generatedResults: twice })
    const chips = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"))
    expect(chips.map((c) => c.textContent)).toEqual(["9:16", "1:1"])
  })

  const preview = { label: "T", fieldMappings: {}, executionStatus: "completed", generatedVideoUrl: "https://r2/p.mp4", generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: RUN }] }

  it("a Preview take of a run it can continue offers Render final", () => {
    renderNode({ ...preview, useCaseJobId: RUN })
    expect(screen.getByTestId("render-review-bar")).toBeInTheDocument()
  })

  it("a Final on show offers no Render final", () => {
    renderNode({ ...done, useCaseJobId: RUN })
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
  })

  it("a failed run offers Continue, a from-failed continuation of its job", async () => {
    renderNode({ label: "T", fieldMappings: {}, executionStatus: "failed", errorMessage: "Apply Cut: boom", useCaseJobId: "job-0" })
    await userEvent.click(screen.getByRole("button", { name: t("node.tightenContinue") }))
    expect(store.runSingleNode).toHaveBeenCalledWith("t1", { usecaseContinue: { mode: "from-failed", jobId: "job-0" } })
  })

  it("a list-driven node offers neither Render final nor Continue", () => {
    fanOut.listDriven = true
    renderNode({ ...preview, useCaseJobId: RUN })
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
    cleanup()
    renderNode({ label: "T", fieldMappings: {}, executionStatus: "failed", errorMessage: "boom", useCaseJobId: "job-0" })
    expect(screen.queryByRole("button", { name: t("node.tightenContinue") })).toBeNull()
  })

  it("fed a list, its refusal names Trailer in the reader's language", () => {
    renderNode({ label: "T", fieldMappings: {}, executionStatus: "failed", errorMessage: "Trailer takes one recording. Use a separate workflow run for each recording.", errorCode: "use_case_list_driven" })
    expect(screen.getByText(t("nodeRun.usecaseListDriven", { label: "Trailer" }))).toBeInTheDocument()
  })

  it("a review-held refusal names its own remedy (its review)", () => {
    renderNode({ label: "T", fieldMappings: {}, executionStatus: "failed", errorMessage: "sent", errorCode: "preview_review_required" })
    expect(screen.getByText(t("previewGate.headlessRefusalReview"))).toBeInTheDocument()
  })
})
