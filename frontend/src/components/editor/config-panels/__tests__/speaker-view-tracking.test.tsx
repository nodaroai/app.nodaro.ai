/**
 * Speaker View's FACE TRACKING section (P3.9) on a live canvas store: Glide is
 * greyed, with its reason, until Speaker Frames is wired (P3-10); with tracks
 * wired the summary counts them; "Add face tracking" inserts and wires
 * Speaker Frames as one step (P3-17 (c)).
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }) }))

import { SpeakerViewConfig } from "../speaker-view-config"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { translate } from "@/lib/i18n"
import type { SpeakerViewData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const EDL = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "a", speaker: "Host" }, { id: "s1", inMs: 5000, outMs: 9000, video: "b", speaker: "Guest" }] }
const TRACKS = {
  version: 1, sampleFps: 2, detector: { id: "yunet" }, url: "https://x/speaker-tracks/j.json", sha256: "a".repeat(64), bytes: 10,
  sources: [{ sourceId: "a", clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: 0, endMs: 9000 }], tracks: [{ id: "a/t1", speaker: "Host", boxCount: 4 }, { id: "a/t2", boxCount: 4 }] }],
}

function seed(opts: { tracks?: "wired" | "not-run"; data?: Partial<SpeakerViewData> } = {}) {
  const nodes = [
    { id: "plan", type: "edit-plan", position: { x: 0, y: 0 }, data: { label: "Edit Plan", generatedJson: EDL } },
    ...(opts.tracks ? [{ id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: { label: "Speaker Frames", fieldMappings: {}, ...(opts.tracks === "wired" ? { generatedJson: TRACKS } : {}) } }] : []),
    { id: "sv", type: "speaker-view", position: { x: 400, y: 0 }, data: { label: "Speaker View", fieldMappings: {}, ...opts.data } },
  ] as unknown as WorkflowNode[]
  const edges = [
    { id: "e1", source: "plan", sourceHandle: "edl", target: "sv", targetHandle: "edl" },
    ...(opts.tracks ? [{ id: "e3", source: "sf", sourceHandle: "tracks", target: "sv", targetHandle: "tracks" }] : []),
  ] as unknown as WorkflowEdge[]
  useWorkflowStore.setState({ nodes, edges, isReadOnly: false } as never)
}

function panel(onUpdate: (d: Record<string, unknown>) => void = () => {}) {
  const { nodes, edges } = useWorkflowStore.getState()
  const data = nodes.find((n) => n.id === "sv")!.data as SpeakerViewData
  return render(<SpeakerViewConfig data={data} onUpdate={onUpdate} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={nodes} edges={edges} nodeId="sv" />)
}

afterEach(() => cleanup())

describe("Speaker View: face tracking", () => {
  it("without tracks: Glide is greyed and says why; Static is checked (v1 framing)", () => {
    seed()
    const onUpdate = vi.fn()
    panel(onUpdate)
    const glide = screen.getByTestId("speaker-view-motion-glide") as HTMLButtonElement
    // Ruled out, not dead: it stays in the tab order, and focus or a screen reader reads why.
    expect(glide.disabled).toBe(false)
    expect(glide.getAttribute("aria-disabled")).toBe("true")
    expect(glide.tabIndex).not.toBe(-1)
    expect(document.getElementById(glide.getAttribute("aria-describedby")!)?.textContent).toBe(t("speakerView.reason.needsTracks"))
    expect(glide.title).toBe(t("speakerView.reason.needsTracks"))
    fireEvent.click(glide)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByTestId("speaker-view-motion-reasons").textContent).toBe(t("speakerView.reason.needsTracks"))
    expect(screen.getByTestId("speaker-view-motion-static").getAttribute("aria-checked")).toBe("true")
    expect(screen.getByTestId("speaker-view-tracks-state").textContent).toBe(t("speakerView.tracks.none"))
  })

  it("with tracks wired: Glide is offered and checked by default, and the tracks are counted", () => {
    seed({ tracks: "wired" })
    panel()
    expect((screen.getByTestId("speaker-view-motion-glide") as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByTestId("speaker-view-motion-glide").getAttribute("aria-checked")).toBe("true")
    expect(screen.getByTestId("speaker-view-tracks-state").textContent).toBe(t("speakerView.tracks.summary", { tracks: 2, cameras: 1, labelled: 1 }))
    // Counts read as "Label: n", never a hard-coded plural ("1 cameras").
    expect(screen.getByTestId("speaker-view-tracks-state").textContent).toBe("Face tracks: 2 · Cameras: 1 · Labelled: 1")
    expect(screen.queryByTestId("speaker-view-add-face-tracking")).toBeNull()
  })

  it("says Speaker Frames has not run while it has no result", () => {
    seed({ tracks: "not-run" })
    panel()
    expect(screen.getByTestId("speaker-view-tracks-state").textContent).toBe(t("speakerView.tracks.notRun"))
  })

  it("a read-only panel shows the choice but writes nothing", () => {
    seed({ tracks: "wired", data: { motion: "glide" } })
    const onUpdate = vi.fn()
    const { nodes, edges } = useWorkflowStore.getState()
    const data = nodes.find((n) => n.id === "sv")!.data as SpeakerViewData
    useWorkflowStore.setState({ isReadOnly: true } as never)
    render(<SpeakerViewConfig data={data} onUpdate={onUpdate} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={nodes} edges={edges} nodeId="sv" />)
    fireEvent.click(screen.getByTestId("speaker-view-motion-static"))
    expect(onUpdate).not.toHaveBeenCalledWith({ motion: "static" })
  })

  it("picking Static writes it", () => {
    seed({ tracks: "wired", data: { motion: "glide" } })
    const onUpdate = vi.fn()
    panel(onUpdate)
    fireEvent.click(screen.getByTestId("speaker-view-motion-static"))
    expect(onUpdate).toHaveBeenCalledWith({ motion: "static" })
  })

  it("Add face tracking inserts Speaker Frames on the same edit and wires its tracks in", () => {
    seed()
    panel()
    fireEvent.click(screen.getByTestId("speaker-view-add-face-tracking"))
    const { nodes, edges } = useWorkflowStore.getState()
    const frames = nodes.find((n) => n.type === "speaker-frames")!
    expect(frames).toBeTruthy()
    expect(edges.some((e) => e.source === "plan" && e.target === frames.id && e.targetHandle === "edl")).toBe(true)
    expect(edges.some((e) => e.source === frames.id && e.sourceHandle === "tracks" && e.target === "sv" && e.targetHandle === "tracks")).toBe(true)
  })
})
