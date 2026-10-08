/**
 * The Speaker View config panel (U2, U2b; C3.2 rules, C3.3 pickers): reads the
 * edit wired into the node from the canvas and greys what the aspect or the
 * speaker count rules out, saying why (SV3) — never "unavailable". The rules are
 * the pure functions the quick strip and the run read, pinned in backend/src/
 * lib/__tests__/speaker-view-rules.test.ts; these render the real panel.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react"

vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: Object.assign((s: (x: unknown) => unknown) => s({}), { getState: () => ({}) }) }))

import { SpeakerViewConfig } from "../speaker-view-config"
import { translate } from "@/lib/i18n"
import type { SpeakerViewData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const seg = (id: string, inS: number, video: string, speaker?: string, outS = inS + 5) => ({ id, inMs: inS * 1000, outMs: outS * 1000, video, ...(speaker ? { speaker } : {}) })
const TWO = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest")] }
const JUMP = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 8, "b", "Guest")] }
const THREE = { version: 1, clock: "master", sources: [src("a"), src("b"), src("c")], segments: [seg("s0", 0, "a", "H"), seg("s1", 5, "b", "G"), seg("s2", 10, "c", "P")] }
const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
const words = (...speakers: string[]) => ({ version: 1, words: speakers.map((speaker, i) => ({ text: "w", startMs: i * 10, endMs: i * 10 + 5, speaker })) })

interface PanelOptions {
  readonly edl?: unknown
  readonly producer?: "edit-plan" | "camera-switch"
  readonly producerData?: Record<string, unknown>
  readonly transcript?: unknown
  readonly onUpdate?: (d: Record<string, unknown>) => void
}

function panel(data: Partial<SpeakerViewData>, opts: PanelOptions = {}) {
  const producer = opts.producer ?? "edit-plan"
  const nodes = [
    { id: "plan", type: producer, position: { x: 0, y: 0 }, data: { label: "Edit Plan", ...(opts.edl !== undefined ? { generatedJson: opts.edl } : {}), ...opts.producerData } },
    ...(opts.transcript !== undefined ? [{ id: "tr", type: "transcribe", position: { x: 0, y: 0 }, data: { label: "Transcribe", generatedJson: opts.transcript } }] : []),
    { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", ...data } },
  ] as unknown as WorkflowNode[]
  const edges = [
    ...(opts.edl !== undefined || opts.producerData ? [{ id: "e", source: "plan", target: "sv", targetHandle: "edl" }] : []),
    ...(opts.transcript !== undefined ? [{ id: "e2", source: "tr", target: "sv", targetHandle: "transcript" }] : []),
  ] as unknown as WorkflowEdge[]
  return render(<SpeakerViewConfig data={{ label: "Speaker View", fieldMappings: {}, ...data } as SpeakerViewData} onUpdate={opts.onUpdate ?? (() => {})} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={nodes} edges={edges} nodeId="sv" />)
}

const group = (name: string) => screen.getByRole(name === t("speakerView.field.emphasis") ? "group" : "radiogroup", { name })
const tile = (g: HTMLElement, name: RegExp | string) => within(g).getByRole(g.getAttribute("role") === "group" ? "checkbox" : "radio", { name })

afterEach(() => cleanup())

describe("SpeakerViewConfig: the input and its states (U2b)", () => {
  it("says it is not priced yet", () => {
    panel({})
    expect(screen.getByTestId("speaker-view-not-priced").textContent).toBe(t("speakerView.notPriced"))
  })

  it("with no edit wired: says what to wire, and rules out by the aspect alone", () => {
    panel({ targetAspect: "9:16" })
    expect(screen.getByText(t("speakerView.inputNone"))).toBeTruthy()
    const sbs = tile(group(t("speakerView.field.layout")), t("speakerView.layout.sideBySide"))
    expect(sbs.getAttribute("title")).toBe(t("speakerView.reason.aspectNotDrawn", { layout: t("speakerView.layout.sideBySide"), aspect: "9:16" }))
  })

  it("an upstream that has not run: names it, and says what waits on it", () => {
    panel({}, { producerData: {} })
    expect(screen.getByTestId("speaker-view-input-state").textContent).toBe(t("speakerView.state.notRun", { producer: "Edit Plan" }))
  })

  it("summarises the wired edit, and a clip pack across its clips", () => {
    panel({}, { edl: TWO })
    expect(screen.getByTestId("speaker-view-input-summary").textContent).toBe(t("speakerView.inputSummary", { speakers: 2, cameras: 2 }))
    cleanup()
    panel({}, { edl: [TWO, THREE] })
    expect(screen.getByTestId("speaker-view-input-summary").textContent).toBe(t("speakerView.inputPack", { clips: 2, min: 2, max: 3 }))
  })

  it("shows the validity badge for the wired edit", () => {
    panel({}, { edl: TWO })
    expect(screen.getByTestId("edl-validity-badge").getAttribute("data-ok")).toBe("true")
  })

  it("warns when the transcript's speakers are not the edit's", () => {
    panel({}, { edl: TWO, transcript: words("speaker_0", "speaker_1") })
    expect(screen.getByTestId("speaker-view-input-state").textContent).toBe(t("speakerView.state.labelMismatch", { labels: "speaker_0, speaker_1", names: "Host, Guest" }))
  })

  it("says nothing of the transcript when its speakers are the edit's", () => {
    panel({}, { edl: TWO, transcript: words("Host", "Guest") })
    expect(screen.queryByTestId("speaker-view-input-state")).toBeNull()
  })

  it("SV24: several cameras and no speaker on any segment: wire Camera Switch", () => {
    const unnamed = { version: 1, clock: "master", sources: [src("a"), src("b"), src("c")], segments: [seg("s0", 0, "a"), seg("s1", 5, "b")] }
    panel({}, { edl: unnamed, transcript: words("speaker_0", "speaker_1") })
    expect(screen.getByTestId("speaker-view-input-state").textContent).toBe(t("speakerView.state.wireCameraSwitch"))
  })

  it("SV24: a partly named edit: asks for a transcript, then for its speaker labels", () => {
    const partly = { version: 1, clock: "master", sources: [src("a"), src("b"), src("c")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "b")] }
    panel({}, { edl: partly })
    expect(screen.getByTestId("speaker-view-input-state").textContent).toBe(t("speakerView.state.noTranscript"))
    cleanup()
    panel({}, { edl: partly, transcript: words() })
    expect(screen.getByTestId("speaker-view-input-state").textContent).toBe(t("speakerView.state.noLabels"))
  })
})

describe("SpeakerViewConfig: layout", () => {
  it("draws one tile per layout, the stored one checked", () => {
    panel({ layout: "grid" }, { edl: THREE })
    const g = group(t("speakerView.field.layout"))
    expect(within(g).getAllByRole("radio")).toHaveLength(6)
    expect(tile(g, t("speakerView.layout.grid")).getAttribute("aria-checked")).toBe("true")
  })

  it("names why a 3-speaker edit cannot fill side by side and pip, but offers a grid", () => {
    panel({ targetAspect: "16:9" }, { edl: THREE })
    const g = group(t("speakerView.field.layout"))
    const sbs = tile(g, t("speakerView.layout.sideBySide"))
    expect(sbs.getAttribute("aria-disabled")).toBe("true")
    expect(sbs.getAttribute("title")).toBe(t("speakerView.reason.tooMany", { layout: t("speakerView.layout.sideBySide"), max: 2, count: 3 }))
    expect(tile(g, t("speakerView.layout.pip")).getAttribute("aria-disabled")).toBe("true")
    expect(tile(g, t("speakerView.layout.grid")).getAttribute("aria-disabled")).toBeNull()
    const reasons = screen.getByTestId("speaker-view-layout-reasons").textContent!
    expect(reasons).toContain(t("speakerView.reason.tooMany", { layout: t("speakerView.layout.sideBySide"), max: 2, count: 3 }))
  })

  it("picking a layout writes it; a ruled-out one writes nothing", () => {
    const onUpdate = vi.fn()
    panel({ targetAspect: "16:9" }, { edl: THREE, onUpdate })
    const g = group(t("speakerView.field.layout"))
    fireEvent.click(tile(g, t("speakerView.layout.grid")))
    expect(onUpdate).toHaveBeenCalledWith({ layout: "grid" })
    onUpdate.mockClear()
    fireEvent.click(tile(g, t("speakerView.layout.sideBySide")))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("says what a stored layout will render as when the aspect rules it out", () => {
    panel({ layout: "side-by-side", targetAspect: "9:16" }, { edl: TWO })
    expect(screen.getByTestId("speaker-view-snap").textContent).toBe(t("speakerView.snappedAspect", { from: t("speakerView.layout.sideBySide"), aspect: "9:16", to: t("speakerView.layout.stacked") }))
  })
})

describe("SpeakerViewConfig: output", () => {
  it("picks the aspect from tiles, the edit's own checked by default", () => {
    const onUpdate = vi.fn()
    panel({}, { edl: { ...TWO, meta: { targetAspect: "9:16" } }, onUpdate })
    const g = screen.getByRole("radiogroup", { name: t("field.aspectRatio") })
    expect(within(g).getAllByRole("radio")).toHaveLength(4)
    expect(within(g).getByRole("radio", { name: /9:16/ }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(within(g).getByRole("radio", { name: /1:1/ }))
    expect(onUpdate).toHaveBeenCalledWith({ targetAspect: "1:1" })
  })
})

describe("SpeakerViewConfig: switch", () => {
  it("offers Cut, Pan, Zoom and Crossfade", () => {
    panel({}, { edl: TWO })
    const g = group(t("speakerView.field.switch"))
    expect(within(g).getAllByRole("radio").map((r) => r.textContent)).toEqual([t("speakerView.switch.cut"), t("speakerView.switch.pan"), t("speakerView.switch.zoom"), t("speakerView.switch.crossfadeMore")])
  })

  it("a fixed multi-slot layout rules Pan and Zoom out, with the reason", () => {
    panel({ layout: "grid" }, { edl: THREE })
    const g = group(t("speakerView.field.switch"))
    for (const name of [t("speakerView.switch.pan"), t("speakerView.switch.zoom")]) {
      expect(tile(g, name).getAttribute("aria-disabled")).toBe("true")
      expect(tile(g, name).getAttribute("title")).toBe(t("speakerView.reason.slotsFixed", { layout: t("speakerView.layout.grid") }))
    }
    expect(tile(g, t("speakerView.switch.cut")).getAttribute("aria-disabled")).toBeNull()
  })

  it("picking Zoom writes it; a crossfade is written as xfade:<id> from the popover", () => {
    const onUpdate = vi.fn()
    panel({ layout: "single" }, { edl: JUMP, onUpdate })
    fireEvent.click(tile(group(t("speakerView.field.switch")), t("speakerView.switch.zoom")))
    expect(onUpdate).toHaveBeenCalledWith({ switchType: "zoom" })
    fireEvent.click(tile(group(t("speakerView.field.switch")), t("speakerView.switch.crossfadeMore")))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /Dissolve/ }))
    expect(onUpdate).toHaveBeenLastCalledWith({ switchType: "xfade:dissolve" })
  })

  it("a stored crossfade is the checked tile and is named", () => {
    panel({ layout: "single", switchType: "xfade:wipe-left" }, { edl: TWO })
    expect(tile(group(t("speakerView.field.switch")), t("speakerView.switch.crossfadeOf", { name: "Wipe Left" })).getAttribute("aria-checked")).toBe("true")
  })

  it("counts the speaker changes Pan and Crossfade apply to (SV5, SV21)", () => {
    const edl = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "a", "Guest"), seg("s2", 12, "b", "Host", 15)] }
    panel({ layout: "single" }, { edl })
    const notes = screen.getByTestId("speaker-view-switch-notes").textContent!
    expect(notes).toContain(t("speakerView.note.panCount", { applies: 1, changes: 2, cut: 1 }))
    expect(notes).toContain(t("speakerView.note.crossfadeCount", { applies: 1, changes: 2 }))
  })

  it("says so when no change is a clock jump, and when Pan applies to all", () => {
    const edl = { version: 1, clock: "master", sources: [src("a")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "a", "Guest")] }
    panel({ layout: "single" }, { edl })
    const notes = screen.getByTestId("speaker-view-switch-notes").textContent!
    expect(notes).toContain(t("speakerView.note.panAll", { changes: 1 }))
    // The "applies to none" case is no longer a note: the Crossfade tile is greyed with that reason.
    expect(notes).not.toContain(t("speakerView.note.crossfadeCount", { applies: 0, changes: 1 }))
  })

  describe("the Crossfade tile when no speaker change crosses a clock jump (decided 2026-10-08)", () => {
    const REASON = (changes: number) => t("speakerView.reason.noClockJump", { changes })

    it("is greyed with its reason on hover, and the reason is listed under the picker", () => {
      panel({ layout: "single" }, { edl: TWO })
      const crossfade = tile(group(t("speakerView.field.switch")), t("speakerView.switch.crossfadeMore"))
      expect(crossfade.getAttribute("aria-disabled")).toBe("true")
      expect(crossfade.getAttribute("title")).toBe(REASON(1))
      expect(screen.getByTestId("speaker-view-switch-reasons").textContent).toContain(REASON(1))
    })

    it("shows the reason on keyboard focus and does not open", () => {
      panel({ layout: "single" }, { edl: TWO })
      const crossfade = tile(group(t("speakerView.field.switch")), t("speakerView.switch.crossfadeMore"))
      fireEvent.focus(crossfade)
      expect(screen.getByTestId("stv-reason-caption").textContent).toBe(REASON(1))
      fireEvent.click(crossfade)
      expect(screen.queryByRole("dialog")).toBeNull()
    })

    it("is greyed under a fixed layout too when there is no jump, and open when there is one", () => {
      panel({ layout: "grid" }, { edl: THREE })
      expect(tile(group(t("speakerView.field.switch")), t("speakerView.switch.crossfadeMore")).getAttribute("aria-disabled")).toBe("true")
      cleanup()
      panel({ layout: "single" }, { edl: JUMP })
      const crossfade = tile(group(t("speakerView.field.switch")), t("speakerView.switch.crossfadeMore"))
      expect(crossfade.getAttribute("aria-disabled")).toBeNull()
      expect(crossfade.getAttribute("title")).toBeNull()
    })

    it("stays open with no edit wired", () => {
      panel({})
      expect(tile(group(t("speakerView.field.switch")), t("speakerView.switch.crossfadeMore")).getAttribute("aria-disabled")).toBeNull()
    })

    it("a stored crossfade is left as set (greyed, still the checked tile)", () => {
      const onUpdate = vi.fn()
      panel({ layout: "single", switchType: "xfade:wipe-left" }, { edl: TWO, onUpdate })
      const crossfade = tile(group(t("speakerView.field.switch")), t("speakerView.switch.crossfadeOf", { name: "Wipe Left" }))
      expect(crossfade.getAttribute("aria-checked")).toBe("true")
      expect(crossfade.getAttribute("aria-disabled")).toBe("true")
      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  it("Pan's ruled-out reason reads \"No speaker change can pan here.\"", () => {
    const edl = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest")] }
    panel({ layout: "single" }, { edl })
    expect(tile(group(t("speakerView.field.switch")), t("speakerView.switch.pan")).getAttribute("title")).toBe("No speaker change can pan here.")
  })

  it("has no minimum-shot control anywhere (Advanced holds only the Border colour)", () => {
    const { container } = panel({ layout: "single" }, { edl: TWO })
    expect(container.textContent).not.toMatch(/min(imum)?\.? shot|shortest shot/i)
    const advanced = container.querySelector("details")!
    expect(advanced.querySelectorAll("input")).toHaveLength(1)
    expect(advanced.querySelector("#speaker-view-accent")).toBeTruthy()
  })

  it("under a fixed layout there is no Pan count (it is ruled out, with its reason)", () => {
    panel({ layout: "grid" }, { edl: THREE })
    expect(screen.queryByTestId("speaker-view-switch-notes")).toBeNull()
  })

  it("the duration is a slider, in 50 ms steps, showing its value", () => {
    const onUpdate = vi.fn()
    panel({ layout: "single", switchDurationMs: 600 }, { edl: TWO, onUpdate })
    expect(screen.getByText(t("speakerView.ms", { ms: 600 }))).toBeTruthy()
    fireEvent.keyDown(screen.getByRole("slider", { name: t("speakerView.field.switchMs") }), { key: "ArrowRight" })
    expect(onUpdate).toHaveBeenCalledWith({ switchDurationMs: 650 })
  })
})

describe("SpeakerViewConfig: emphasis", () => {
  it("under Single, greys all three with ONE reason, however many atoms it rules out", () => {
    panel({ layout: "single" }, { edl: TWO })
    const g = group(t("speakerView.field.emphasis"))
    for (const atom of [t("speakerView.emphasis.scale"), t("speakerView.emphasis.border"), t("speakerView.emphasis.dim")]) {
      expect(tile(g, atom).getAttribute("aria-disabled")).toBe("true")
    }
    const items = screen.getByTestId("speaker-view-emphasis-reasons").querySelectorAll("li")
    expect([...items].filter((li) => li.textContent === t("speakerView.reason.singleShowsOne"))).toHaveLength(1)
  })

  it("writes the emphasis as a +-joined set, and none when all are off", () => {
    const onUpdate = vi.fn()
    panel({ layout: "grid", emphasisStyle: "scale" }, { edl: THREE, onUpdate })
    fireEvent.click(tile(group(t("speakerView.field.emphasis")), t("speakerView.emphasis.border")))
    expect(onUpdate).toHaveBeenCalledWith({ emphasisStyle: "scale+border" })
    fireEvent.click(tile(group(t("speakerView.field.emphasis")), t("speakerView.emphasis.scale")))
    expect(onUpdate).toHaveBeenLastCalledWith({ emphasisStyle: "none" })
  })

  it("the ease is a slider too", () => {
    const onUpdate = vi.fn()
    panel({ layout: "grid", emphasisDurationMs: 300 }, { edl: THREE, onUpdate })
    fireEvent.keyDown(screen.getByRole("slider", { name: t("speakerView.field.emphasisMs") }), { key: "ArrowLeft" })
    expect(onUpdate).toHaveBeenCalledWith({ emphasisDurationMs: 250 })
  })
})

describe("SpeakerViewConfig: framing and advanced", () => {
  it("says every speaker is full frame until crops are set, then how many are", () => {
    panel({}, { edl: TWO })
    expect(screen.getByTestId("speaker-view-framing").textContent).toBe(t("speakerView.framing.full"))
    cleanup()
    panel({ speakerRegions: [{ source: "a", speaker: "Host", region: { x: 0, y: 0, w: 0.5, h: 1 } }] } as Partial<SpeakerViewData>, { edl: TWO })
    expect(screen.getByTestId("speaker-view-framing").textContent).toBe(t("speakerView.framing.set", { count: 1 }))
  })

  it("keeps the border colour under Advanced", () => {
    const onUpdate = vi.fn()
    panel({}, { edl: TWO, onUpdate })
    const advanced = screen.getByText(t("speakerView.section.advanced")).closest("details")!
    expect(advanced.open).toBe(false)
    fireEvent.change(within(advanced).getByLabelText(t("speakerView.field.accent")), { target: { value: "#ff0000" } })
    expect(onUpdate).toHaveBeenCalledWith({ accentColor: "#FF0000" })
  })
})
