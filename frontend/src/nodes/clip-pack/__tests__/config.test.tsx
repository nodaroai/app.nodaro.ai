// The Clip Pack settings panel: the clip count and length (clamped to what the
// run reads), framing (None, or a shape with the layouts it draws, a switch
// and an emphasis — a layout the shape does not draw is snapped as the run
// snaps it), captions, Review before render, and an audio recording that
// locks framing and captions off.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/components/editor/config-panels/run-up-to-here-notice", () => ({ RunUpToHereNotice: () => null }))

import { ConfigPanel as ClipPackConfig } from "../config"
import { translate } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { ClipPackData } from "../types"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

const AUDIO_WIRED = {
  nodes: [{ id: "pod", type: "upload-audio", position: { x: 0, y: 0 }, data: { label: "Podcast", audioUrl: "https://r2/ep.mp3" } }] as unknown as WorkflowNode[],
  edges: [{ id: "e1", source: "pod", sourceHandle: "audio", target: "cp1", targetHandle: "media" }] as unknown as WorkflowEdge[],
}

const VIDEO_WIRED = {
  nodes: [{ id: "rec", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Recording", videoUrl: "https://r2/ep.mp4" } }] as unknown as WorkflowNode[],
  edges: [{ id: "e2", source: "rec", sourceHandle: "video", target: "cp1", targetHandle: "media" }] as unknown as WorkflowEdge[],
}

function renderConfig(data: Partial<ClipPackData>, onUpdate: (d: Record<string, unknown>) => void = () => {}, wired: { nodes: WorkflowNode[]; edges: WorkflowEdge[] } = { nodes: [], edges: [] }) {
  return render(
    <ClipPackConfig
      data={{ label: "Clip Pack", fieldMappings: {}, ...data } as ClipPackData as never}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={wired.nodes}
      edges={wired.edges}
      nodeId="cp1"
      kit={{ localizeNodeLabel: (label: string) => label }}
    />,
  )
}

afterEach(() => cleanup())

describe("ClipPackConfig", () => {
  it("shows the run's defaults when none are stored, and its hint", () => {
    renderConfig({})
    // Nothing stored: the fields are empty and show the run's defaults as their placeholders.
    expect((screen.getByLabelText(t("proccfg.clipPackCount")) as HTMLInputElement).placeholder).toBe("8")
    expect((screen.getByLabelText(t("proccfg.clipPackLength")) as HTMLInputElement).placeholder).toBe("60")
    expect(screen.getByRole("combobox", { name: t("proccfg.tightenFraming") }).textContent).toBe("9:16")
    expect(screen.getByRole("switch", { name: t("proccfg.tightenCaptions") }).getAttribute("data-state")).toBe("checked")
    expect(screen.getByText(t("proccfg.clipPackHint"))).toBeInTheDocument()
  })

  it("typing \"3\" then \"0\" gives 30: nothing is clamped while typing, the value is written on leaving the field", async () => {
    const onUpdate = vi.fn()
    renderConfig({ targetDurationSec: 60 }, onUpdate)
    const length = screen.getByLabelText(t("proccfg.clipPackLength")) as HTMLInputElement
    await userEvent.clear(length)
    await userEvent.type(length, "3")
    expect(length.value).toBe("3")
    await userEvent.type(length, "0")
    expect(length.value).toBe("30")
    expect(onUpdate).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ targetDurationSec: 30 })
  })

  it("Enter writes too; out of range is clamped on commit (1–50 clips, 5–180 seconds)", async () => {
    const onUpdate = vi.fn()
    renderConfig({ count: 8, targetDurationSec: 60 }, onUpdate)
    const count = screen.getByLabelText(t("proccfg.clipPackCount")) as HTMLInputElement
    await userEvent.clear(count)
    await userEvent.type(count, "99{Enter}")
    expect(onUpdate).toHaveBeenLastCalledWith({ count: 50 })
    expect(count.value).toBe("50")
    const length = screen.getByLabelText(t("proccfg.clipPackLength")) as HTMLInputElement
    await userEvent.clear(length)
    await userEvent.type(length, "2")
    await userEvent.tab()
    expect(onUpdate).toHaveBeenLastCalledWith({ targetDurationSec: 5 })
  })

  it("a cleared field stays empty (the default is only the placeholder) and writes the run's default", async () => {
    const onUpdate = vi.fn()
    renderConfig({ count: 12 }, onUpdate)
    const count = screen.getByLabelText(t("proccfg.clipPackCount")) as HTMLInputElement
    await userEvent.clear(count)
    expect(count.value).toBe("")
    await userEvent.tab()
    expect(count.value).toBe("")
    expect(count.placeholder).toBe("8")
    expect(onUpdate).toHaveBeenCalledWith({ count: undefined })
  })

  it("16:9 does not draw a stacked layout: it is snapped as the run snaps it, the switch and emphasis kept", () => {
    const onUpdate = vi.fn()
    renderConfig({ framing: { aspect: "16:9", layout: "stacked", switchType: "zoom", emphasisStyle: "border" } }, onUpdate)
    expect(onUpdate).toHaveBeenCalledWith({ framing: { aspect: "16:9", layout: "side-by-side", switchType: "zoom", emphasisStyle: "border" } })
  })

  it("a settled framing writes nothing on open", () => {
    const onUpdate = vi.fn()
    renderConfig({ framing: { aspect: "9:16", layout: "stacked", switchType: "pan", emphasisStyle: "scale" } }, onUpdate)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("None sets no framing; a shape picked from None takes the default switch and emphasis", async () => {
    const onUpdate = vi.fn()
    renderConfig({}, onUpdate)
    await userEvent.click(screen.getByRole("combobox", { name: t("proccfg.tightenFraming") }))
    await userEvent.click(screen.getByRole("option", { name: t("proccfg.clipPackFramingNone") }))
    expect(onUpdate).toHaveBeenLastCalledWith({ framing: null })
    cleanup()
    renderConfig({ framing: null }, onUpdate)
    expect(screen.queryByRole("combobox", { name: t("proccfg.tightenFramingLayout") })).toBeNull()
    await userEvent.click(screen.getByRole("combobox", { name: t("proccfg.tightenFraming") }))
    await userEvent.click(screen.getByRole("option", { name: "16:9" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ framing: { aspect: "16:9", layout: "side-by-side", switchType: "pan", emphasisStyle: "scale" } })
  })

  it("offers only the layouts the shape draws, the switches with their names, and the emphasis as toggles ('none' when all are off)", async () => {
    const onUpdate = vi.fn()
    renderConfig({ framing: { aspect: "9:16", layout: "stacked", switchType: "pan", emphasisStyle: "scale" } }, onUpdate)
    await userEvent.click(screen.getByRole("combobox", { name: t("proccfg.tightenFramingLayout") }))
    expect(screen.queryByRole("option", { name: t("speakerView.layout.sideBySide") })).toBeNull()
    expect(screen.getByRole("option", { name: t("speakerView.layout.stacked") })).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("combobox", { name: t("proccfg.clipPackSwitch") }).textContent).toBe(t("speakerView.switch.pan"))
    await userEvent.click(screen.getByRole("checkbox", { name: t("speakerView.emphasis.border") }))
    expect(onUpdate).toHaveBeenLastCalledWith({ framing: { aspect: "9:16", layout: "stacked", switchType: "pan", emphasisStyle: "scale+border" } })
    await userEvent.click(screen.getByRole("checkbox", { name: t("speakerView.emphasis.scale") }))
    expect(onUpdate).toHaveBeenLastCalledWith({ framing: { aspect: "9:16", layout: "stacked", switchType: "pan", emphasisStyle: "none" } })
  })

  it("an audio recording wired locks framing and captions off, says why, and writes it once", () => {
    const onUpdate = vi.fn()
    renderConfig({}, onUpdate, AUDIO_WIRED)
    // One write, and only the forced values: remembering and giving back is the store's, on the wire change.
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ framing: null, captions: false })
    expect(screen.getByText(t("proccfg.clipPackAudioForced"))).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: t("proccfg.tightenFraming") })).toBeDisabled()
    expect(screen.getByRole("switch", { name: t("proccfg.tightenCaptions") })).toBeDisabled()
    cleanup()
    onUpdate.mockReset()
    renderConfig({ framing: null, captions: false }, onUpdate, AUDIO_WIRED)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("an audio recording wired onto a node already at framing None, captions never set, still writes the forced pair once", () => {
    // The fail-safe writes whenever any forced value differs: an unset captions is not `false`.
    const onUpdate = vi.fn()
    renderConfig({ framing: null }, onUpdate, AUDIO_WIRED)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ framing: null, captions: false })
  })

  it("a video wired never makes the panel write: giving settings back is the store's (lib/__tests__/use-case-audio-lock.test.ts)", () => {
    const onUpdate = vi.fn()
    renderConfig({ framing: null, captions: false, settingsBeforeAudio: { captions: true } }, onUpdate, VIDEO_WIRED)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("half-typed text that is no number (\"1e\") is not a clear: the last valid value stays", async () => {
    const onUpdate = vi.fn()
    renderConfig({ targetDurationSec: 45 }, onUpdate)
    const length = screen.getByLabelText(t("proccfg.clipPackLength")) as HTMLInputElement
    await userEvent.clear(length)
    await userEvent.type(length, "1e")
    await userEvent.tab()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(length.value).toBe("45")
  })

  it("Review before render writes the setting", async () => {
    const onUpdate = vi.fn()
    renderConfig({}, onUpdate)
    await userEvent.click(screen.getByRole("switch", { name: t("proccfg.tightenReview") }))
    expect(onUpdate).toHaveBeenCalledWith({ reviewBeforeRender: true })
    expect(screen.getByText(t("proccfg.clipPackReviewHint"))).toBeInTheDocument()
  })
})
