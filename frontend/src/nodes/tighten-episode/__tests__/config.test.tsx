// The Tighten Episode settings panel: an audio recording forces an audio
// episode; framing offers only the layouts its shape draws (the run's own
// rule) and snaps a stored one it does not; captions, review and the music
// duck appear only where they apply.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/components/editor/config-panels/run-up-to-here-notice", () => ({ RunUpToHereNotice: () => null }))
// The viewer's answer: may they use Speaker Map (several recordings, decided 2026-10-19)? Not landed by default.
const viewer = vi.hoisted(() => ({ state: "loading" as "loading" | "offered" | "withheld" }))
vi.mock("@/lib/use-case-multicam-viewer", () => ({
  usecaseMulticamOffered: () => viewer.state === "offered",
  usecaseMulticamViewer: () => viewer.state,
  useUseCaseMulticamViewer: () => viewer.state,
}))

import { EDL_TARGET_ASPECTS } from "@nodaro/shared/edl"
import { tightenFramingLayouts } from "@nodaro/render-rules"
import { ConfigPanel as TightenEpisodeConfig } from "../config"
import { SPEAKER_LAYOUT_LABEL_KEYS } from "@/components/nodes/speaker-view-label-keys"
import { translate } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { TightenEpisodeData } from "../types"

const t = (key: Parameters<typeof translate>[1]) => translate("en", key)

interface Options {
  readonly data: Partial<TightenEpisodeData>
  readonly onUpdate?: (d: Record<string, unknown>) => void
  readonly nodes?: ReadonlyArray<Record<string, unknown>>
  readonly edges?: ReadonlyArray<Record<string, unknown>>
  readonly sources?: ReadonlyArray<Record<string, unknown>>
}

function renderConfig({ data, onUpdate = () => {}, nodes = [], edges = [], sources = [] }: Options) {
  return render(
    <TightenEpisodeConfig
      data={{ label: "T", fieldMappings: {}, ...data } as TightenEpisodeData as never}
      onUpdate={onUpdate}
      sources={sources as never}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={nodes as unknown as WorkflowNode[]}
      edges={edges as unknown as WorkflowEdge[]}
      nodeId="t1"
      kit={{ localizeNodeLabel: (label: string) => label }}
    />,
  )
}

const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent)

afterEach(() => {
  cleanup()
  viewer.state = "loading"
})

describe("TightenEpisodeConfig", () => {
  it("an audio recording forces an audio episode and hides captions", () => {
    const onUpdate = vi.fn()
    renderConfig({
      data: { output: "video", captions: true },
      onUpdate,
      nodes: [{ id: "rec", type: "upload-audio", data: {} }, { id: "t1", type: "tighten-episode", data: {} }],
      edges: [{ id: "e", source: "rec", target: "t1", sourceHandle: "audio", targetHandle: "media" }],
    })
    expect(onUpdate).toHaveBeenCalledWith({ output: "audio", captions: false })
    expect(screen.getByText(t("proccfg.tightenAudioForced"))).toBeInTheDocument()
    expect(screen.queryByText(t("proccfg.tightenCaptions"))).toBeNull()
  })

  it("a video recording forces nothing, and a settled node writes nothing on open", () => {
    const onUpdate = vi.fn()
    renderConfig({
      data: {},
      onUpdate,
      nodes: [{ id: "rec", type: "upload-video", data: {} }],
      edges: [{ id: "e", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }],
    })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByText(t("proccfg.tightenCaptions"))).toBeInTheDocument()
  })

  it("framing: none by default; picking a shape stores aspect + layout (auto); hidden on an audio episode", async () => {
    const onUpdate = vi.fn()
    renderConfig({ data: {}, onUpdate })
    await userEvent.click(screen.getByRole("combobox", { name: t("proccfg.tightenFraming") }))
    await userEvent.click(screen.getByRole("option", { name: "9:16" }))
    expect(onUpdate).toHaveBeenCalledWith({ framing: { aspect: "9:16", layout: "auto" } })
    renderConfig({ data: { output: "audio" } })
    expect(screen.getAllByRole("combobox", { name: t("proccfg.tightenFraming") })).toHaveLength(1)
  })

  it("the layout list offers only what the shape draws", async () => {
    renderConfig({ data: { framing: { aspect: "9:16", layout: "auto" } } })
    await userEvent.click(screen.getByRole("combobox", { name: t("proccfg.tightenFramingLayout") }))
    expect(optionNames()).toContain(t("speakerView.layout.stacked"))
    expect(optionNames()).not.toContain(t("speakerView.layout.sideBySide"))
  })

  it("a stored layout the shape does not draw is snapped as the run snaps it", () => {
    const onUpdate = vi.fn()
    renderConfig({ data: { framing: { aspect: "9:16", layout: "side-by-side" } }, onUpdate })
    expect(onUpdate).toHaveBeenCalledWith({ framing: { aspect: "9:16", layout: "stacked" } })
  })

  it("a new shape keeps the layout when the shape draws it, else snaps it", async () => {
    const onUpdate = vi.fn()
    renderConfig({ data: { framing: { aspect: "16:9", layout: "side-by-side" } }, onUpdate })
    await userEvent.click(screen.getByRole("combobox", { name: t("proccfg.tightenFraming") }))
    await userEvent.click(screen.getByRole("option", { name: "4:5" }))
    expect(onUpdate).toHaveBeenCalledWith({ framing: { aspect: "4:5", layout: "stacked" } })
  })

  it("the caption style list is the caption node's own", async () => {
    renderConfig({ data: {} })
    await userEvent.click(screen.getByRole("combobox", { name: t("proccfg.tightenCaptionStyle") }))
    expect(optionNames()).toEqual([
      t("proccfg.subtitleStatic"), t("proccfg.wordHighlightKinetic"), t("proccfg.karaokeKinetic"),
      t("proccfg.tiktokWordsKinetic"), t("proccfg.wordPopKinetic"), t("proccfg.bouncyKinetic"),
    ])
  })

  it("the music duck slider appears only when a music bed is wired, and writes the amount", async () => {
    renderConfig({ data: {} })
    expect(screen.queryByText(t("proccfg.tightenMusicDuck"))).toBeNull()
    cleanup()
    const onUpdate = vi.fn()
    renderConfig({
      data: {},
      onUpdate,
      nodes: [{ id: "m", type: "upload-audio", data: {} }],
      edges: [{ id: "e", source: "m", target: "t1", sourceHandle: "audio", targetHandle: "music" }],
    })
    expect(screen.getByText(t("proccfg.tightenMusicDuck"))).toBeInTheDocument()
    screen.getByRole("slider", { name: t("proccfg.tightenMusicDuck") }).focus()
    await userEvent.keyboard("{ArrowRight}")
    expect(onUpdate).toHaveBeenCalledWith({ musicDuckAmount: 80 })
  })

  it("a stored framing the run would not read (a shape it has no renderer for) is cleared, as the run clears it", () => {
    const onUpdate = vi.fn()
    renderConfig({ data: { framing: { aspect: "7:3" as never, layout: "auto" } }, onUpdate })
    expect(onUpdate).toHaveBeenCalledWith({ framing: null })
  })

  it("every layout any shape offers has a name", () => {
    for (const aspect of EDL_TARGET_ASPECTS) {
      for (const layout of tightenFramingLayouts(aspect as never)) expect(SPEAKER_LAYOUT_LABEL_KEYS[layout], `${aspect} ${layout}`).toBeDefined()
    }
  })

  it("Review before render toggles reviewBeforeRender", async () => {
    const onUpdate = vi.fn()
    renderConfig({ data: {}, onUpdate })
    await userEvent.click(screen.getByRole("switch", { name: t("proccfg.tightenReview") }))
    expect(onUpdate).toHaveBeenCalledWith({ reviewBeforeRender: true })
  })

  it("the panel only snaps an audio-wired node, in one write; giving settings back is the store's (lib/__tests__/use-case-audio-lock.test.ts)", () => {
    const onUpdate = vi.fn()
    renderConfig({
      data: { output: "audio", captions: false, settingsBeforeAudio: { output: "video", captions: true } },
      onUpdate,
      nodes: [{ id: "rec", type: "upload-video", data: {} }],
      edges: [{ id: "e", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }],
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe("the Cameras section (decided 2026-10-17; shown only to a viewer who may use Speaker Map — 2026-10-19)", () => {
  const cam = (id: string, type = "upload-video") => ({ id, type, data: { label: `cam-${id}` } })
  const into = (id: string, handle = "media", sourceHandle = "video") => ({ id: `${id}-${handle}`, source: id, target: "t1", sourceHandle, targetHandle: handle })
  const src = (id: string, handle = "media", type = "upload-video") => ({ id, type, label: `cam-${id}`, value: "", targetHandle: handle })
  const three = {
    nodes: [cam("a"), cam("b"), cam("c"), cam("mic", "upload-audio")],
    edges: [into("a"), into("b"), into("c"), into("mic", "masterAudio", "audio")],
    sources: [src("a"), src("b"), src("c"), src("mic", "masterAudio", "upload-audio")],
  }

  it("one recording: no Cameras section", () => {
    viewer.state = "offered"
    renderConfig({ data: {}, nodes: [cam("a")], edges: [into("a")], sources: [src("a")] })
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
  })

  it("three recordings and a master: the recordings in mediaOrder, the wide camera, already in sync, and one override row per camera", async () => {
    viewer.state = "offered"
    renderConfig({ data: { mediaOrder: ["c", "a"] }, ...three })
    const section = screen.getByTestId("use-case-cameras")
    const text = section.textContent ?? ""
    expect(text.indexOf("cam-c")).toBeLessThan(text.indexOf("cam-a"))
    expect(text.indexOf("cam-a")).toBeLessThan(text.indexOf("cam-b"))
    expect(text).toContain(t("proccfg.usecaseMasterAudio"))
    expect(screen.getByRole("switch", { name: t("proccfg.usecaseSynced") })).toBeInTheDocument()
    expect(screen.getAllByRole("combobox", { name: /^Speaker \d$/ })).toHaveLength(3)
    await userEvent.click(screen.getByRole("combobox", { name: t("proccfg.usecaseWideCamera") }))
    expect(optionNames()).toEqual(["None", "Camera 1", "Camera 2", "Camera 3"])
  })

  it("one override row per speaker of the last run's report; choosing Camera 2 for Speaker 1 writes it", async () => {
    viewer.state = "offered"
    const onUpdate = vi.fn()
    const report = { speakers: [{ speaker: "speaker_0", ordinal: 1, camera: null, marginDb: 0.2 }, { speaker: "speaker_1", ordinal: 2, camera: 1, marginDb: 8 }], syncNotes: [], mapNotes: [] }
    renderConfig({ data: { useCaseCameras: report }, onUpdate, ...three })
    expect(screen.getAllByRole("combobox", { name: /^Speaker \d$/ })).toHaveLength(2)
    await userEvent.click(screen.getByRole("combobox", { name: "Speaker 1" }))
    await userEvent.click(screen.getByRole("option", { name: "Camera 2" }))
    expect(onUpdate).toHaveBeenCalledWith({ cameras: { speakerCameras: { "1": 2 } } })
  })

  it("six recordings and no master: the refusal the run would give, in the panel", () => {
    viewer.state = "offered"
    const ids = ["a", "b", "c", "d", "e", "f"]
    renderConfig({ data: {}, nodes: ids.map((id) => cam(id)), edges: ids.map((id) => into(id)), sources: ids.map((id) => src(id)) })
    expect(screen.getByText(t("apiErr.reason.tooManyRecordings"))).toBeInTheDocument()
  })

  it("a viewer who may not use Speaker Map: no section; a note that the run reads the first recording only (two recordings, or one and a master)", () => {
    viewer.state = "withheld"
    renderConfig({ data: {}, ...three })
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
    expect(screen.getByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeInTheDocument()
    cleanup()
    renderConfig({ data: {}, nodes: [cam("a"), cam("mic", "upload-audio")], edges: [into("a"), into("mic", "masterAudio", "audio")], sources: [src("a"), src("mic", "masterAudio", "upload-audio")] })
    expect(screen.getByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeInTheDocument()
    cleanup()
    renderConfig({ data: {}, nodes: [cam("a")], edges: [into("a")], sources: [src("a")] })
    expect(screen.queryByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeNull()
  })

  it("until the viewer's availability has landed: neither (no flash)", () => {
    renderConfig({ data: {}, ...three })
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
    expect(screen.queryByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeNull()
  })

  it("while the viewer's availability is loading, a sound-only recording first and a camera after forces nothing (an admin's run may read both)", () => {
    const onUpdate = vi.fn()
    const nodes = [cam("m", "upload-audio"), cam("a"), { id: "t1", type: "tighten-episode", data: {} }]
    renderConfig({ data: { output: "video", captions: true }, onUpdate, nodes, edges: [into("m", "media", "audio"), into("a")], sources: [src("m", "media", "upload-audio"), src("a")] })
    expect(onUpdate).not.toHaveBeenCalled()
    cleanup()
    // Every recording sound only: audio whichever the viewer turns out to be.
    renderConfig({ data: { output: "video", captions: true }, onUpdate, nodes: [cam("m", "upload-audio"), { id: "t1", type: "tighten-episode", data: {} }], edges: [into("m", "media", "audio")], sources: [src("m", "media", "upload-audio")] })
    expect(onUpdate).toHaveBeenCalledWith({ output: "audio", captions: false })
  })

  it("the panel writes no fail-safe for the Cameras settings (the store's invariant keeps them)", () => {
    viewer.state = "offered"
    const onUpdate = vi.fn()
    renderConfig({ data: { output: "video", cameras: { wide: 9, speakerCameras: { "1": 7 } } }, onUpdate, ...three })
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
