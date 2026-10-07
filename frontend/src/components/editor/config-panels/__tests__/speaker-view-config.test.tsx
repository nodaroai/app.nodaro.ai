/**
 * The Speaker View config panel (U2, C3.2): reads the edit wired into the node
 * from the canvas and greys what the aspect or the speaker count rules out,
 * saying why (SV3) — never "unavailable". The rules are the pure functions the
 * quick strip and the run read, pinned in backend/src/lib/__tests__/
 * speaker-view-rules.test.ts; these render the real panel.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: Object.assign((s: (x: unknown) => unknown) => s({}), { getState: () => ({}) }) }))

import { SpeakerViewConfig } from "../speaker-view-config"
import { translate } from "@/lib/i18n"
import type { SpeakerViewData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const seg = (id: string, inS: number, video: string, speaker: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, speaker })
const TWO = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest")] }
const THREE = { version: 1, clock: "master", sources: [src("a"), src("b"), src("c")], segments: [seg("s0", 0, "a", "H"), seg("s1", 5, "b", "G"), seg("s2", 10, "c", "P")] }
const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

function panel(data: Partial<SpeakerViewData>, edl?: unknown, onUpdate: (d: Record<string, unknown>) => void = () => {}) {
  const nodes = [
    { id: "plan", type: "edit-plan", position: { x: 0, y: 0 }, data: { label: "plan", generatedJson: edl } },
    { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", ...data } },
  ] as unknown as WorkflowNode[]
  const edges = edl === undefined ? [] : ([{ id: "e", source: "plan", target: "sv", targetHandle: "edl" }] as unknown as WorkflowEdge[])
  return render(<SpeakerViewConfig data={{ label: "Speaker View", fieldMappings: {}, ...data } as SpeakerViewData} onUpdate={onUpdate} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={nodes} edges={edges} nodeId="sv" />)
}

afterEach(() => cleanup())

describe("SpeakerViewConfig", () => {
  it("says it is not priced yet", () => {
    panel({})
    expect(screen.getByTestId("speaker-view-not-priced").textContent).toBe(t("speakerView.notPriced"))
  })

  it("with no edit wired: says what to wire, and rules out by the aspect alone", () => {
    panel({ targetAspect: "9:16" })
    expect(screen.getByText(t("speakerView.inputNone"))).toBeTruthy()
    const layoutName = t("speakerView.layout.sideBySide")
    expect(screen.getByTestId("speaker-view-reasons").textContent).toContain(t("speakerView.reason.aspectNotDrawn", { layout: layoutName, aspect: "9:16" }))
  })

  it("names why a 3-speaker edit cannot fill side by side and pip, but offers a grid", () => {
    panel({ targetAspect: "16:9" }, THREE)
    const reasons = screen.getByTestId("speaker-view-reasons").textContent!
    expect(reasons).toContain(t("speakerView.reason.tooMany", { layout: t("speakerView.layout.sideBySide"), max: 2, count: 3 }))
    expect(reasons).toContain(t("speakerView.reason.tooMany", { layout: t("speakerView.layout.pip"), max: 2, count: 3 }))
    expect(reasons).not.toContain(t("speakerView.reason.tooMany", { layout: t("speakerView.layout.grid"), max: 6, count: 3 }))
  })

  it("says what a stored layout will render as when the aspect rules it out", () => {
    panel({ layout: "side-by-side", targetAspect: "9:16" }, TWO)
    expect(screen.getByTestId("speaker-view-snap").textContent).toBe(t("speakerView.snappedAspect", { from: t("speakerView.layout.sideBySide"), aspect: "9:16", to: t("speakerView.layout.stacked") }))
  })

  it("under Single, greys emphasis with ONE reason, however many atoms it rules out", () => {
    panel({ layout: "single" }, TWO)
    const reasons = screen.getByTestId("speaker-view-reasons").querySelectorAll("li")
    expect([...reasons].filter((li) => li.textContent === t("speakerView.reason.singleShowsOne"))).toHaveLength(1)
    for (const atom of [t("speakerView.emphasis.scale"), t("speakerView.emphasis.border"), t("speakerView.emphasis.dim")]) {
      expect((screen.getByLabelText(atom) as HTMLElement).getAttribute("data-disabled")).not.toBeNull()
    }
  })

  it("summarises the wired edit, and a clip pack across its clips", () => {
    panel({}, TWO)
    expect(screen.getByTestId("speaker-view-input-summary").textContent).toBe(t("speakerView.inputSummary", { speakers: 2, cameras: 2 }))
    cleanup()
    panel({}, [TWO, THREE])
    expect(screen.getByTestId("speaker-view-input-summary").textContent).toBe(t("speakerView.inputPack", { clips: 2, min: 2, max: 3 }))
  })

  it("shows the validity badge for the wired edit", () => {
    panel({}, TWO)
    expect(screen.getByTestId("edl-validity-badge").getAttribute("data-ok")).toBe("true")
  })

  it("writes the emphasis as a +-joined set, and none when all are off", async () => {
    const onUpdate = vi.fn()
    panel({ layout: "grid", emphasisStyle: "scale" }, THREE, onUpdate)
    ;(await import("@testing-library/user-event")).default.setup()
    const border = screen.getByLabelText(t("speakerView.emphasis.border"))
    border.click()
    expect(onUpdate).toHaveBeenCalledWith({ emphasisStyle: "scale+border" })
    cleanup()
    onUpdate.mockClear()
    panel({ layout: "grid", emphasisStyle: "scale" }, THREE, onUpdate)
    screen.getByLabelText(t("speakerView.emphasis.scale")).click()
    expect(onUpdate).toHaveBeenCalledWith({ emphasisStyle: "none" })
  })
})
