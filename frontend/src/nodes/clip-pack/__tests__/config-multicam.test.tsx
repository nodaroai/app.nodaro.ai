// The Clip Pack settings panel on several recordings and with a framing source
// (decided 2026-10-17/19/20): the Cameras section only for a viewer who may use
// Speaker Map, the audio lock over the recordings THAT viewer's run reads, and
// where a framed pack's boxes come from.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/components/editor/config-panels/run-up-to-here-notice", () => ({ RunUpToHereNotice: () => null }))
// The viewer's answers: may they use Speaker Map (several recordings) and Speaker Frames (following faces)?
const viewer = vi.hoisted(() => ({ map: "loading" as "loading" | "offered" | "withheld", frames: "offered" as "loading" | "offered" | "withheld" }))
vi.mock("@/lib/use-case-multicam-viewer", () => ({
  usecaseMulticamOffered: () => viewer.map === "offered",
  usecaseMulticamViewer: () => viewer.map,
  useUseCaseMulticamViewer: () => viewer.map,
}))
vi.mock("@/lib/use-case-frames-viewer", () => ({
  usecaseFramesOffered: () => viewer.frames === "offered",
  usecaseFramesWithheld: () => viewer.frames === "withheld",
  usecaseFramesViewer: () => viewer.frames,
  useUseCaseFramesViewer: () => viewer.frames,
}))

import { ConfigPanel as ClipPackConfig } from "../config"
import { translate } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { ClipPackData } from "../types"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

const node = (id: string, type = "upload-video") => ({ id, type, data: { label: `cam-${id}` } })
const into = (id: string, handle = "media", sourceHandle = "video") => ({ id: `${id}-${handle}`, source: id, target: "cp1", sourceHandle, targetHandle: handle })
const src = (id: string, handle = "media", type = "upload-video") => ({ id, type, label: `cam-${id}`, value: "", targetHandle: handle })
type Wiring = { nodes: unknown[]; edges: unknown[]; sources: unknown[] }
const TWO_AND_MASTER: Wiring = {
  nodes: [node("a"), node("b"), node("mic", "upload-audio")],
  edges: [into("a"), into("b"), into("mic", "masterAudio", "audio")],
  sources: [src("a"), src("b"), src("mic", "masterAudio", "upload-audio")],
}
/** A sound-only first recording beside a camera: one recording reads sound only, both read video. */
const SOUND_THEN_CAMERA: Wiring = {
  nodes: [node("mix", "upload-audio"), node("b"), { id: "cp1", type: "clip-pack", data: {} }],
  edges: [into("mix", "media", "audio"), into("b")],
  sources: [src("mix", "media", "upload-audio"), src("b")],
}

function renderWired(data: Partial<ClipPackData>, wiring: Wiring = { nodes: [], edges: [], sources: [] }, onUpdate: (d: Record<string, unknown>) => void = () => {}) {
  return render(
    <ClipPackConfig
      data={{ label: "Clip Pack", fieldMappings: {}, ...data } as ClipPackData as never}
      onUpdate={onUpdate}
      sources={wiring.sources as never}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={wiring.nodes as unknown as WorkflowNode[]}
      edges={wiring.edges as unknown as WorkflowEdge[]}
      nodeId="cp1"
      kit={{ localizeNodeLabel: (label: string) => label }}
    />,
  )
}

afterEach(() => {
  cleanup()
  viewer.map = "loading"
  viewer.frames = "offered"
})

describe("the Cameras section (shown only to a viewer who may use Speaker Map)", () => {
  it("two cameras and a master: the recordings, the master, already in sync, and an override row per camera", () => {
    viewer.map = "offered"
    renderWired({}, TWO_AND_MASTER)
    const text = screen.getByTestId("use-case-cameras").textContent ?? ""
    expect(text.indexOf("cam-a")).toBeLessThan(text.indexOf("cam-b"))
    expect(text).toContain(t("proccfg.usecaseMasterAudio"))
    expect(screen.getByRole("switch", { name: t("proccfg.usecaseSynced") })).toBeInTheDocument()
  })
  it("a viewer who may not use Speaker Map: no section; a note that the run reads the first recording only", () => {
    viewer.map = "withheld"
    renderWired({}, TWO_AND_MASTER)
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
    expect(screen.getByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeInTheDocument()
  })
  it("until the viewer's availability has landed: neither (no flash); one recording: neither", () => {
    renderWired({}, TWO_AND_MASTER)
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
    expect(screen.queryByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeNull()
    cleanup()
    viewer.map = "offered"
    renderWired({}, { nodes: [node("a")], edges: [into("a")], sources: [src("a")] })
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
  })
  it("the panel writes nothing on its own for the Cameras settings", () => {
    viewer.map = "offered"
    const onUpdate = vi.fn()
    renderWired({ cameras: { wide: 9 } }, TWO_AND_MASTER, onUpdate)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe("the audio lock reads the recordings the viewer's run reads", () => {
  it("a viewer who may use Speaker Map: a camera beside the sound-only recording makes video clips (framing and captions shown)", () => {
    viewer.map = "offered"
    const onUpdate = vi.fn()
    renderWired({}, SOUND_THEN_CAMERA, onUpdate)
    expect(screen.queryByText(t("proccfg.clipPackAudioForced"))).toBeNull()
    expect(onUpdate).not.toHaveBeenCalled()
  })
  it("a viewer who may not: the run reads the sound-only first recording alone — audio clips, framing and captions forced off", () => {
    viewer.map = "withheld"
    const onUpdate = vi.fn()
    renderWired({}, SOUND_THEN_CAMERA, onUpdate)
    expect(screen.getByText(t("proccfg.clipPackAudioForced"))).toBeInTheDocument()
    expect(onUpdate).toHaveBeenCalledWith({ framing: null, captions: false })
  })
  it("while the viewer's availability is loading: audio only when both readings say so (here they differ — nothing forced)", () => {
    const onUpdate = vi.fn()
    renderWired({}, SOUND_THEN_CAMERA, onUpdate)
    expect(screen.queryByText(t("proccfg.clipPackAudioForced"))).toBeNull()
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe("the framing source (decided 2026-10-17/20)", () => {
  const sourceBox = () => screen.queryByRole("combobox", { name: t("proccfg.usecaseFramingSource") })
  const VIDEO: Wiring = { nodes: [node("a")], edges: [into("a")], sources: [src("a")] }

  it("framed by default: Automatic on a new node, with its hint", () => {
    renderWired({ framingSource: "auto" }, VIDEO)
    expect(sourceBox()).toHaveTextContent(t("proccfg.usecaseFramingAuto"))
    expect(screen.getByText(t("proccfg.usecaseFramingHint"))).toBeInTheDocument()
  })
  it("a saved node without one shows Even split — what it runs", () => {
    renderWired({}, VIDEO)
    expect(sourceBox()).toHaveTextContent(t("proccfg.usecaseFramingStatic"))
  })
  it("picking Follow faces writes tracking", async () => {
    const onUpdate = vi.fn()
    renderWired({ framingSource: "auto" }, VIDEO, onUpdate)
    await userEvent.click(sourceBox()!)
    await userEvent.click(screen.getByRole("option", { name: t("proccfg.usecaseFramingTracking") }))
    expect(onUpdate).toHaveBeenCalledWith({ framingSource: "tracking" })
  })
  it("framing None: no framing source", () => {
    renderWired({ framing: null, framingSource: "auto" }, VIDEO)
    expect(sourceBox()).toBeNull()
  })
  it("a sound-only recording (the audio lock): hidden with Framing, its value kept", () => {
    const onUpdate = vi.fn()
    renderWired({ framingSource: "tracking" }, { nodes: [node("pod", "upload-audio")], edges: [into("pod", "media", "audio")], sources: [] }, onUpdate)
    expect(sourceBox()).toBeNull()
    expect(onUpdate.mock.calls.some(([patch]) => "framingSource" in (patch as object))).toBe(false)
  })
  it("Speaker Frames withheld from the viewer: no field (auto is the even split for them) — unless the node follows faces, which a run refuses", () => {
    viewer.frames = "withheld"
    renderWired({ framingSource: "auto" }, VIDEO)
    expect(sourceBox()).toBeNull()
    cleanup()
    renderWired({ framingSource: "tracking" }, VIDEO)
    expect(sourceBox()).toHaveTextContent(t("proccfg.usecaseFramingTracking"))
    expect(screen.getByText(t("proccfg.usecaseFramingNeedsFrames"))).toBeInTheDocument()
  })
})
