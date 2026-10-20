// The Speaker Layout settings panel: the shape, the layouts that shape draws,
// the switch and emphasis through Speaker View's own sections (fed the same
// rules the primitive offers), the framing source with the spec's absent
// default, review, and the Cameras section. What the run would read
// differently from the stored value is shown as the run's resolver reads it;
// the panel never writes it back.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/components/editor/config-panels/run-up-to-here-notice", () => ({ RunUpToHereNotice: () => null }))
// What Speaker View's own sections are handed (their pickers have tests of their own).
const sections = vi.hoisted(() => ({ switch: null as Record<string, unknown> | null, emphasis: null as Record<string, unknown> | null }))
vi.mock("@/components/editor/config-panels/speaker-view-sections", () => ({
  SpeakerViewSwitchSection: (props: Record<string, unknown>) => {
    sections.switch = props
    return <div data-testid="switch-section" data-value={String(props.value)} />
  },
  SpeakerViewEmphasisSection: (props: Record<string, unknown>) => {
    sections.emphasis = props
    return <div data-testid="emphasis-section" data-value={String(props.value)} />
  },
}))
const viewer = vi.hoisted(() => ({ state: "loading" as "loading" | "offered" | "withheld" }))
vi.mock("@/lib/use-case-multicam-viewer", () => ({
  usecaseMulticamOffered: () => viewer.state === "offered",
  usecaseMulticamViewer: () => viewer.state,
  useUseCaseMulticamViewer: () => viewer.state,
}))
const frames = vi.hoisted(() => ({ state: "offered" as "loading" | "offered" | "withheld" }))
vi.mock("@/lib/use-case-frames-viewer", () => ({
  usecaseFramesOffered: () => frames.state === "offered",
  usecaseFramesWithheld: () => frames.state === "withheld",
  usecaseFramesViewer: () => frames.state,
  useUseCaseFramesViewer: () => frames.state,
}))

import { EDL_TARGET_ASPECTS } from "@nodaro/shared/edl"
import {
  SPEAKER_LAYOUT_DEFAULTS,
  resolveSpeakerLayoutSettings,
  tightenFramingLayouts,
  usecaseDescriptor,
  validSpeakerCrossfade,
  validSpeakerEmphasis,
  validSpeakerSwitches,
} from "@nodaro/render-rules"
import { ConfigPanel as SpeakerLayoutConfig } from "../config"
import { SPEAKER_LAYOUT_LABEL_KEYS } from "@/components/nodes/speaker-view-label-keys"
import { translate } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { SpeakerLayoutData } from "../types"

const t = (key: Parameters<typeof translate>[1]) => translate("en", key)

interface Options {
  readonly data: Partial<SpeakerLayoutData>
  readonly onUpdate?: (d: Record<string, unknown>) => void
  readonly nodes?: ReadonlyArray<Record<string, unknown>>
  readonly edges?: ReadonlyArray<Record<string, unknown>>
  readonly sources?: ReadonlyArray<Record<string, unknown>>
}

function renderConfig({ data, onUpdate = () => {}, nodes = [], edges = [], sources = [] }: Options) {
  return render(
    <SpeakerLayoutConfig
      data={{ label: "Speaker Layout", fieldMappings: {}, ...data } as SpeakerLayoutData as never}
      onUpdate={onUpdate}
      sources={sources as never}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={nodes as unknown as WorkflowNode[]}
      edges={edges as unknown as WorkflowEdge[]}
      nodeId="sl1"
      kit={{ localizeNodeLabel: (label: string) => label }}
    />,
  )
}

const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent)
const box = (key: Parameters<typeof translate>[1]) => screen.getByRole("combobox", { name: t(key) })

afterEach(() => {
  cleanup()
  viewer.state = "loading"
  frames.state = "offered"
  sections.switch = null
  sections.emphasis = null
})

describe("SpeakerLayoutConfig: shape and layout", () => {
  it("a new node shows the decided defaults and writes nothing on open", () => {
    const onUpdate = vi.fn()
    renderConfig({ data: { targetAspect: "9:16", layout: "stacked", switchType: "cut", emphasisStyle: "scale" }, onUpdate })
    expect(box("proccfg.speakerLayoutAspect")).toHaveTextContent("9:16")
    expect(box("proccfg.speakerLayoutLayout")).toHaveTextContent(t("speakerView.layout.stacked"))
    // Never a greyed choice (decided 2026-10-20): the default switch is one Speaker View's rule allows for Stacked.
    const picked = (sections.switch!.options as Array<{ id: string; allowed: boolean }>).find((o) => o.id === sections.switch!.value)
    expect(picked?.allowed).toBe(true)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("the shape offers every aspect a render frames to", async () => {
    renderConfig({ data: {} })
    await userEvent.click(box("proccfg.speakerLayoutAspect"))
    expect(optionNames()).toEqual([...EDL_TARGET_ASPECTS])
  })

  it("the layout list offers only what the shape draws", async () => {
    renderConfig({ data: { targetAspect: "9:16" } })
    await userEvent.click(box("proccfg.speakerLayoutLayout"))
    expect(optionNames()).toEqual(tightenFramingLayouts("9:16").map((l) => t(SPEAKER_LAYOUT_LABEL_KEYS[l]!)))
    expect(optionNames()).not.toContain(t("speakerView.layout.sideBySide"))
  })

  it("a stored layout the shape does not draw shows as the run's resolver snaps it — and is never written back", () => {
    const onUpdate = vi.fn()
    renderConfig({ data: { targetAspect: "9:16", layout: "side-by-side" }, onUpdate })
    const resolved = resolveSpeakerLayoutSettings({ targetAspect: "9:16", layout: "side-by-side" }, "video").layout
    expect(resolved).not.toBe("side-by-side")
    expect(box("proccfg.speakerLayoutLayout")).toHaveTextContent(t(SPEAKER_LAYOUT_LABEL_KEYS[resolved]!))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("an unknown stored value shows as the run reads it (its default), and is never written back", () => {
    const onUpdate = vi.fn()
    renderConfig({ data: { targetAspect: "7:3" as never, switchType: "warp", emphasisStyle: "glow" }, onUpdate })
    expect(box("proccfg.speakerLayoutAspect")).toHaveTextContent("9:16")
    expect(screen.getByTestId("switch-section").getAttribute("data-value")).toBe(SPEAKER_LAYOUT_DEFAULTS.switchType)
    expect(screen.getByTestId("emphasis-section").getAttribute("data-value")).toBe("scale")
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("a new shape keeps the layout when the shape draws it, else writes it as the run snaps it", async () => {
    const onUpdate = vi.fn()
    renderConfig({ data: { targetAspect: "16:9", layout: "side-by-side" }, onUpdate })
    await userEvent.click(box("proccfg.speakerLayoutAspect"))
    await userEvent.click(screen.getByRole("option", { name: "4:5" }))
    expect(onUpdate).toHaveBeenCalledWith({ targetAspect: "4:5", layout: resolveSpeakerLayoutSettings({ targetAspect: "4:5", layout: "side-by-side" }, "video").layout })
    onUpdate.mockReset()
    await userEvent.click(box("proccfg.speakerLayoutAspect"))
    await userEvent.click(screen.getByRole("option", { name: "1:1" }))
    expect(onUpdate).toHaveBeenCalledWith({ targetAspect: "1:1", layout: resolveSpeakerLayoutSettings({ targetAspect: "1:1", layout: "side-by-side" }, "video").layout })
  })

  it("picking a layout writes it", async () => {
    const onUpdate = vi.fn()
    renderConfig({ data: { targetAspect: "9:16", layout: "stacked" }, onUpdate })
    await userEvent.click(box("proccfg.speakerLayoutLayout"))
    await userEvent.click(screen.getByRole("option", { name: t("speakerView.layout.single") }))
    expect(onUpdate).toHaveBeenCalledWith({ layout: "single" })
  })
})

describe("SpeakerLayoutConfig: switch and emphasis are Speaker View's own (the two panels never drift)", () => {
  for (const layout of ["stacked", "single", "pip", "auto"] as const) {
    it(`${layout}: the switches, crossfade and emphasis atoms the primitive offers for that layout`, () => {
      const data = { targetAspect: "9:16" as const, layout, switchType: "pan", emphasisStyle: "scale" }
      renderConfig({ data })
      const resolved = resolveSpeakerLayoutSettings(data, "video")
      const sv = { targetAspect: resolved.targetAspect, layout: resolved.layout, switchType: resolved.switchType, emphasisStyle: resolved.emphasisStyle }
      expect(sections.switch!.options).toEqual(validSpeakerSwitches(sv, undefined))
      expect(sections.switch!.crossfade).toEqual(validSpeakerCrossfade(sv, undefined))
      expect(sections.switch!.value).toBe(resolved.switchType)
      expect(sections.emphasis!.options).toEqual(validSpeakerEmphasis(sv))
      expect(sections.emphasis!.value).toBe(resolved.emphasisStyle)
    })
  }

  it("no tween sliders: a layout's run sets no switch or emphasis duration", () => {
    renderConfig({ data: {} })
    expect(sections.switch!.showDuration).toBe(false)
    expect(sections.emphasis!.showDuration).toBe(false)
    expect(sections.switch!.counts).toBeNull()
  })

  it("a pick writes the node's own switch and emphasis", () => {
    const onUpdate = vi.fn()
    renderConfig({ data: {}, onUpdate })
    ;(sections.switch!.onUpdate as (p: Record<string, unknown>) => void)({ switchType: "cut" })
    ;(sections.emphasis!.onUpdate as (p: Record<string, unknown>) => void)({ emphasisStyle: "border" })
    expect(onUpdate.mock.calls).toEqual([[{ switchType: "cut" }], [{ emphasisStyle: "border" }]])
  })
})

describe("SpeakerLayoutConfig: the framing source", () => {
  const sourceBox = () => screen.queryByRole("combobox", { name: t("proccfg.usecaseFramingSource") })

  it("a node with none shows what an absent one reads as for this type (its spec), Automatic", () => {
    expect(usecaseDescriptor("speaker-layout").absentFramingSource).toBe("auto")
    renderConfig({ data: {} })
    expect(sourceBox()).toHaveTextContent(t("proccfg.usecaseFramingAuto"))
  })

  it("picking Follow faces writes tracking", async () => {
    const onUpdate = vi.fn()
    renderConfig({ data: { framingSource: "auto" }, onUpdate })
    await userEvent.click(sourceBox()!)
    await userEvent.click(screen.getByRole("option", { name: t("proccfg.usecaseFramingTracking") }))
    expect(onUpdate).toHaveBeenCalledWith({ framingSource: "tracking" })
  })

  it("Speaker Frames withheld: no field for an absent or automatic source (the even split for them); a node set to follow faces keeps it, with its note", () => {
    frames.state = "withheld"
    renderConfig({ data: {} })
    expect(sourceBox()).toBeNull()
    cleanup()
    renderConfig({ data: { framingSource: "tracking" } })
    expect(sourceBox()).toHaveTextContent(t("proccfg.usecaseFramingTracking"))
    expect(screen.getByText(t("proccfg.usecaseFramingNeedsFrames"))).toBeInTheDocument()
  })

  it("while the viewer's availability is loading: no field yet", () => {
    frames.state = "loading"
    renderConfig({ data: {} })
    expect(sourceBox()).toBeNull()
  })
})

describe("SpeakerLayoutConfig: review", () => {
  it("Review before render toggles reviewBeforeRender, and says what it does", async () => {
    const onUpdate = vi.fn()
    renderConfig({ data: {}, onUpdate })
    expect(screen.getByText(t("proccfg.speakerLayoutReviewHint"))).toBeInTheDocument()
    await userEvent.click(screen.getByRole("switch", { name: t("proccfg.speakerLayoutReview") }))
    expect(onUpdate).toHaveBeenCalledWith({ reviewBeforeRender: true })
  })
})

describe("SpeakerLayoutConfig: the Cameras section (only to a viewer who may use Speaker Map)", () => {
  const cam = (id: string, type = "upload-video") => ({ id, type, data: { label: `cam-${id}` } })
  const into = (id: string, handle = "media", sourceHandle = "video") => ({ id: `${id}-${handle}`, source: id, target: "sl1", sourceHandle, targetHandle: handle })
  const src = (id: string, handle = "media", type = "upload-video") => ({ id, type, label: `cam-${id}`, value: "", targetHandle: handle })
  const two = { nodes: [cam("a"), cam("b")], edges: [into("a"), into("b")], sources: [src("a"), src("b")] }

  it("one recording: no Cameras section", () => {
    viewer.state = "offered"
    renderConfig({ data: {}, nodes: [cam("a")], edges: [into("a")], sources: [src("a")] })
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
  })

  it("two recordings: the Cameras section, the recordings in mediaOrder", () => {
    viewer.state = "offered"
    renderConfig({ data: { mediaOrder: ["b", "a"] }, ...two })
    const text = screen.getByTestId("use-case-cameras").textContent ?? ""
    expect(text.indexOf("cam-b")).toBeLessThan(text.indexOf("cam-a"))
  })

  it("one recording and a Master audio: the Cameras section too", () => {
    viewer.state = "offered"
    renderConfig({ data: {}, nodes: [cam("a"), cam("mic", "upload-audio")], edges: [into("a"), into("mic", "masterAudio", "audio")], sources: [src("a"), src("mic", "masterAudio", "upload-audio")] })
    expect(screen.getByTestId("use-case-cameras").textContent).toContain(t("proccfg.usecaseMasterAudio"))
  })

  it("six recordings: the refusal the run would give, in the panel", () => {
    viewer.state = "offered"
    const ids = ["a", "b", "c", "d", "e", "f"]
    renderConfig({ data: {}, nodes: ids.map((id) => cam(id)), edges: ids.map((id) => into(id)), sources: ids.map((id) => src(id)) })
    expect(screen.getByText(t("apiErr.reason.tooManyRecordings"))).toBeInTheDocument()
  })

  it("a viewer who may not use Speaker Map: no section, the note that the run reads the first recording only; loading: neither", () => {
    viewer.state = "withheld"
    renderConfig({ data: {}, ...two })
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
    expect(screen.getByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeInTheDocument()
    cleanup()
    viewer.state = "loading"
    renderConfig({ data: {}, ...two })
    expect(screen.queryByTestId("use-case-cameras")).toBeNull()
    expect(screen.queryByText(t("proccfg.usecaseNeedsSpeakerMap"))).toBeNull()
  })

  it("the panel writes no fail-safe for the Cameras settings (the store's invariant keeps them)", () => {
    viewer.state = "offered"
    const onUpdate = vi.fn()
    renderConfig({ data: { cameras: { wide: 9, speakerCameras: { "1": 7 } } }, onUpdate, ...two })
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
