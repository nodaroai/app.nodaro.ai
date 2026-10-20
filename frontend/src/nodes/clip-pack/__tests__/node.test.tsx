// The Clip Pack node's face: what it asks for when empty, the clip it plays
// when done (an audio clip as audio) with a chip per clip of that run, how
// many clips it could not render and which came uncaptioned — that take's
// own run only — Render final on a Preview and Continue on a failed run.
import { describe, it, expect, vi, afterEach } from "vitest"
/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const store = vi.hoisted(() => ({ updateNodeData: vi.fn(), runSingleNode: vi.fn(), nodes: [{ id: "c1", type: "clip-pack", data: {} }], edges: [] }))
const fanOut = vi.hoisted(() => ({ listDriven: false }))
const pips = vi.hoisted(() => ({ masterShown: true }))
vi.mock("@/hooks/use-target-handle-shown", () => ({ useTargetHandleShown: (_id: string, _type: string, handle: string) => handle !== "masterAudio" || pips.masterShown }))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, id }: any) => <div data-testid={`handle-${type}-${id}`} />,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "c1"),
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
vi.mock("@/components/render/review-cut-button", () => ({ ReviewCutButton: () => null }))

import { NodeComponent as ClipPackNode } from "../node"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

function renderNode(data: Record<string, unknown>) {
  return render(<ClipPackNode {...({ id: "c1", data, selected: false } as any)} />)
}

afterEach(() => {
  cleanup()
  store.updateNodeData.mockReset()
  store.runSingleNode.mockReset()
  fanOut.listDriven = false
  pips.masterShown = true
})

const RUN = "00000000-0000-4000-8000-000000000007"
const OLDER = "00000000-0000-4000-8000-000000000006"
const row = (url: string, clipKey: string, title: string | undefined, jobId: string, extra: Record<string, unknown> = {}) => ({ url, quality: "final", jobId, clipKey, ...(title ? { title } : {}), timestamp: "t", ...extra })
const done = {
  label: "Clip Pack", fieldMappings: {}, executionStatus: "completed",
  generatedVideoUrl: "https://r2/c0.mp4",
  generatedResults: [
    row("https://r2/c0.mp4", "k0", "The pivot", RUN, { thumbnailUrl: "https://r2/c0.png" }),
    row("https://r2/c1.mp4", "k1", undefined, RUN, { thumbnailUrl: "https://r2/c1.png" }),
    row("https://r2/old.mp4", "k9", "An older clip", OLDER),
  ],
  activeResultIndex: 0,
}
const chipsOf = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"))
const namesOf = () => chipsOf().map((c) => c.getAttribute("aria-label"))

describe("ClipPackNode", () => {
  it("empty: asks for a recording", () => {
    renderNode({ label: "Clip Pack", fieldMappings: {} })
    expect(screen.getByText(t("node.tightenConnectRecording"))).toBeInTheDocument()
  })

  it("its pips: Recordings (top) and Master audio (bottom) in — the label tables' keys — the clips and the clip set out", () => {
    renderNode({ label: "C", fieldMappings: {} })
    expect(screen.getByTestId("pip-target-media").textContent).toBe("Recordings")
    expect(screen.getByTestId("pip-target-masterAudio").textContent).toBe("Master audio")
    expect(["media", "masterAudio"].map((h) => screen.getByTestId(`pip-target-${h}`).getAttribute("data-top"))).toEqual(["24px", "calc(100% - 24px)"])
    expect(screen.getByTestId("pip-source-clips").textContent).toBe(t("node.clipPackClips"))
    expect(screen.getByTestId("pip-source-json").textContent).toBe(t("node.clipPackPlan"))
  })

  it("a finished pack plays the clip on show, and offers a thumbnail per clip of THAT run only, titled by the plan", () => {
    renderNode(done)
    expect(document.querySelector("video")?.getAttribute("src")).toBe("https://r2/c0.mp4")
    expect(namesOf()).toEqual(["The pivot", t("node.clipPackClip", { n: 2 })])
    expect(chipsOf().map((c) => c.querySelector("img")?.getAttribute("src"))).toEqual(["https://r2/c0.png", "https://r2/c1.png"])
    expect(chipsOf()[0]!.getAttribute("title")).toBe("The pivot")
    expect(chipsOf()[0]!.getAttribute("aria-pressed")).toBe("true")
  })

  it("a chip puts its clip on show, as a pick in the results gallery does", async () => {
    renderNode(done)
    await userEvent.click(chipsOf()[1]!)
    expect(store.updateNodeData).toHaveBeenCalledWith("c1", expect.objectContaining({ activeResultIndex: 1, generatedVideoUrl: "https://r2/c1.mp4" }))
  })

  it("an audio recording's clip plays as audio, and its tile is an audio glyph — even with no file extension (the run says it is audio)", () => {
    const audioRow = (url: string, key: string) => row(url, key, undefined, RUN, { medium: "audio" })
    renderNode({ ...done, generatedVideoUrl: undefined, generatedAudioUrl: "https://r2/c0", generatedResults: [audioRow("https://r2/c0", "k0"), audioRow("https://r2/c1", "k1")] })
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("https://r2/c0")
    expect(document.querySelector("video")).toBeNull()
    expect(screen.getAllByTestId("clip-audio-glyph")).toHaveLength(2)
    expect(document.querySelector("img")).toBeNull()
  })

  it("says how many clips the run of the take on show could not render — one, or several", () => {
    const one = done.generatedResults.map((r) => (r.jobId === RUN ? { ...r, failedClips: 1 } : r))
    renderNode({ ...done, generatedResults: one, failedClips: 1 })
    expect(screen.getByText(t("node.clipPackFailedOne"))).toBeInTheDocument()
    cleanup()
    const three = done.generatedResults.map((r) => (r.jobId === RUN ? { ...r, failedClips: 3 } : r))
    renderNode({ ...done, generatedResults: three, failedClips: 3 })
    expect(screen.getByText(t("node.clipPackFailedMany", { count: 3 }))).toBeInTheDocument()
  })

  it("marks each uncaptioned clip, and says captions could not be added to them", () => {
    const rows = [done.generatedResults[0]!, { ...done.generatedResults[1]!, captionsFailed: true }, done.generatedResults[2]!]
    renderNode({ ...done, generatedResults: rows })
    expect(screen.getByText(t("node.clipPackCaptionsFailed"))).toBeInTheDocument()
    const marked = chipsOf().map((c) => c.querySelector("[data-testid='clip-no-captions']") !== null)
    expect(marked).toEqual([false, true])
    // The mark sits on the thumbnail, and the clip's name says it.
    expect(chipsOf()[1]!.querySelector("img")).not.toBeNull()
    expect(chipsOf()[1]!.getAttribute("aria-label")).toBe(`${t("node.clipPackClip", { n: 2 })} — ${t("node.clipPackNoCaptions")}`)
  })

  it("a mixed run (one clip not rendered, one uncaptioned) names both under its own takes", () => {
    const rows = [
      { ...done.generatedResults[0]!, failedClips: 1 },
      { ...done.generatedResults[1]!, failedClips: 1, captionsFailed: true },
      done.generatedResults[2]!,
    ]
    renderNode({ ...done, generatedResults: rows, failedClips: 1 })
    expect(screen.getByText(t("node.clipPackFailedOne"))).toBeInTheDocument()
    expect(screen.getByText(t("node.clipPackCaptionsFailed"))).toBeInTheDocument()
  })

  it("an older take picked: names THAT run's shortfall, never the latest run's", () => {
    const rows = [
      { ...done.generatedResults[0]!, failedClips: 2 },
      { ...done.generatedResults[1]!, failedClips: 2, captionsFailed: true },
      done.generatedResults[2]!,
    ]
    renderNode({ ...done, generatedResults: rows, failedClips: 2, activeResultIndex: 2 })
    expect(namesOf()).toEqual(["An older clip"])
    expect(screen.queryByText(t("node.clipPackFailedMany", { count: 2 }))).toBeNull()
    expect(screen.queryByText(t("node.clipPackCaptionsFailed"))).toBeNull()
  })

  it("never shows a clip twice, even when a run's rows landed twice", () => {
    const twice = [...done.generatedResults.slice(0, 2), { ...done.generatedResults[0]!, url: "https://r2/c0-again.mp4" }]
    renderNode({ ...done, generatedResults: twice })
    expect(chipsOf()).toHaveLength(2)
  })

  const preview = { label: "C", fieldMappings: {}, executionStatus: "completed", generatedVideoUrl: "https://r2/p0.mp4", generatedResults: [{ url: "https://r2/p0.mp4", quality: "proxy", jobId: RUN, clipKey: "k0" }] }

  it("a Preview take of a run it can continue offers Render final", () => {
    renderNode({ ...preview, useCaseJobId: RUN })
    expect(screen.getByTestId("render-review-bar")).toBeInTheDocument()
  })

  it("a Final on show offers no Render final", () => {
    renderNode({ ...done, useCaseJobId: RUN })
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
  })

  it("a failed run offers Continue, a from-failed continuation of its job", async () => {
    renderNode({ label: "C", fieldMappings: {}, executionStatus: "failed", errorMessage: "Render Clip: boom", useCaseJobId: "job-0" })
    await userEvent.click(screen.getByRole("button", { name: t("node.tightenContinue") }))
    expect(store.runSingleNode).toHaveBeenCalledWith("c1", { usecaseContinue: { mode: "from-failed", jobId: "job-0" } })
  })

  it("a list-driven node offers neither Render final nor Continue", () => {
    fanOut.listDriven = true
    renderNode({ ...preview, useCaseJobId: RUN })
    expect(screen.queryByTestId("render-review-bar")).toBeNull()
    cleanup()
    renderNode({ label: "C", fieldMappings: {}, executionStatus: "failed", errorMessage: "boom", useCaseJobId: "job-0" })
    expect(screen.queryByRole("button", { name: t("node.tightenContinue") })).toBeNull()
  })

  it("a run none of whose clips rendered says so in the reader's language", () => {
    renderNode({ label: "C", fieldMappings: {}, executionStatus: "failed", errorMessage: "None of the 3 clips could be rendered: out of memory." })
    expect(screen.getByText(t("nodeRun.clipPackNoneRendered", { count: 3, reason: "out of memory" }))).toBeInTheDocument()
  })

  it("fed a list, its refusal names Clip Pack in the reader's language (it takes the recordings of one conversation)", () => {
    renderNode({ label: "C", fieldMappings: {}, executionStatus: "failed", errorMessage: "Clip Pack takes the recordings of one conversation. Use a separate workflow run for each episode.", errorCode: "use_case_list_driven" })
    expect(screen.getByText(t("nodeRun.usecaseListDrivenEpisode", { label: "Clip Pack" }))).toBeInTheDocument()
  })

  it("a refusal stored in Clip Pack's words before it took several recordings still reads in today's", () => {
    renderNode({ label: "C", fieldMappings: {}, executionStatus: "failed", errorMessage: "Clip Pack takes one recording. Use a separate workflow run for each recording.", errorCode: "use_case_list_driven" })
    expect(screen.getByText(t("nodeRun.usecaseListDrivenEpisode", { label: "Clip Pack" }))).toBeInTheDocument()
  })

  it("no Master audio pip for a viewer it is withheld from (Speaker Map not available, and nothing wired to it): the Recordings pip where it always was", () => {
    pips.masterShown = false
    renderNode({ label: "C", fieldMappings: {} })
    expect(screen.queryByTestId("pip-target-masterAudio")).toBeNull()
    expect(screen.getByTestId("pip-target-media").getAttribute("data-top")).toBe("24px")
  })

  it("under a multicam take, the camera note: a speaker with no clear camera, and recordings that could not be lined up", () => {
    renderNode({
      ...done,
      useCaseCameras: { speakers: [{ speaker: "speaker_1", ordinal: 1, camera: null, marginDb: 0.4 }, { speaker: "speaker_0", ordinal: 2, camera: 2, marginDb: 7 }], syncNotes: ["weak"], mapNotes: [] },
    })
    expect(screen.getByText(t("node.usecaseCameraUnclear", { n: 1 }))).toBeInTheDocument()
    expect(screen.getByText(t("node.usecaseCameraSyncWeak"))).toBeInTheDocument()
  })
  it("a one-recording take: no camera note", () => {
    renderNode(done)
    expect(screen.queryByTestId("use-case-camera-note")).toBeNull()
  })
})
