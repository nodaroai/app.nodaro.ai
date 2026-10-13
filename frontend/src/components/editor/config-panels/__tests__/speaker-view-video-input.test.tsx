/**
 * Speaker View's Video input in the panel (decided 2026-10-11), on a live
 * canvas store: a video stands in for the edit, the transcript is required and
 * "Add Transcribe" inserts and wires it as one step (D3), and the badge carries
 * the wiring rule, the source-shape rules and the centre-of-frame note.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

// `priced`: Speaker View; `frames`: Speaker Frames. Video mode is open only with both (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))
beforeEach(() => {
  flag.priced = true
  flag.frames = true
})
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))

import { SpeakerViewConfig } from "../speaker-view-config"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { translate } from "@/lib/i18n"
import type { SpeakerViewData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
const URL = "https://cdn.example.test/uploads/videos/clip.mp4"
const WORDS = { version: 1, words: [{ text: "a", startMs: 0, endMs: 400, speaker: "Alex" }, { text: "b", startMs: 5000, endMs: 5400, speaker: "Sam" }] }

function seed(opts: { transcript?: boolean; edl?: boolean; meta?: Record<string, unknown>; data?: Partial<SpeakerViewData> } = {}) {
  const nodes = [
    { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Video", url: URL, metadata: opts.meta ?? { width: 3840, height: 2160 } } },
    ...(opts.transcript ? [{ id: "tx", type: "transcribe", position: { x: 0, y: 0 }, data: { label: "Transcribe", generatedResults: [{ url: "", transcript: WORDS }], activeResultIndex: 0 } }] : []),
    ...(opts.edl ? [{ id: "plan", type: "edit-plan", position: { x: 0, y: 0 }, data: { label: "Edit Plan" } }] : []),
    { id: "sv", type: "speaker-view", position: { x: 400, y: 0 }, data: { label: "Speaker View", fieldMappings: {}, ...opts.data } },
  ] as unknown as WorkflowNode[]
  const edges = [
    { id: "e1", source: "up", sourceHandle: "video", target: "sv", targetHandle: "video" },
    ...(opts.transcript ? [{ id: "e2", source: "tx", sourceHandle: "json", target: "sv", targetHandle: "transcript" }] : []),
    ...(opts.edl ? [{ id: "e3", source: "plan", sourceHandle: "edl", target: "sv", targetHandle: "edl" }] : []),
  ] as unknown as WorkflowEdge[]
  useWorkflowStore.setState({ nodes, edges, isReadOnly: false } as never)
}

function panel() {
  const { nodes, edges } = useWorkflowStore.getState()
  const data = nodes.find((n) => n.id === "sv")!.data as SpeakerViewData
  return render(<SpeakerViewConfig data={data} onUpdate={() => {}} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={nodes} edges={edges} nodeId="sv" />)
}

afterEach(() => cleanup())

/** The badge's details live in a popover: open it, then read what it lists. */
function badgeDetails(): string {
  fireEvent.click(screen.getByTestId("edl-validity-badge"))
  return document.body.textContent ?? ""
}

describe("Speaker View: a bare video in place of an edit", () => {
  it("R15: while Speaker Frames is unpriced, offers no Add Transcribe and the badge says video mode is not open", () => {
    flag.frames = false
    seed()
    panel()
    expect(screen.queryByTestId("speaker-view-add-transcribe")).toBeNull()
    expect(badgeDetails()).toContain("Speaker View from a video is not available yet")
  })

  it("says the input is a video, and offers Add Transcribe while no transcript is wired", () => {
    seed()
    panel()
    expect(screen.getByTestId("speaker-view-video-input").textContent).toBe(t("speakerView.video.input"))
    expect(screen.getAllByTestId("speaker-view-input-state").map((e) => e.textContent)).toContain(t("speakerView.video.needTranscript"))
    expect(screen.getByTestId("speaker-view-add-transcribe")).toBeTruthy()
  })

  it("Add Transcribe inserts Transcribe with speaker detection and wires the video into it and its transcript into Speaker View, as one step", () => {
    seed()
    panel()
    fireEvent.click(screen.getByTestId("speaker-view-add-transcribe"))
    const { nodes, edges } = useWorkflowStore.getState()
    const added = nodes.find((n) => n.type === "transcribe")
    expect(added?.data).toMatchObject({ provider: "elevenlabs-stt", diarize: true })
    expect(edges.some((e) => e.source === "up" && e.target === added!.id && e.targetHandle === "audio")).toBe(true)
    expect(edges.some((e) => e.source === added!.id && e.target === "sv" && e.targetHandle === "transcript")).toBe(true)
  })

  it("offers no Add Transcribe once a transcript is wired, and shows the centre-of-frame note (D9)", () => {
    seed({ transcript: true })
    panel()
    expect(screen.queryByTestId("speaker-view-add-transcribe")).toBeNull()
    expect(badgeDetails()).toMatch(/No framing set for Alex, Sam: the centre of the frame is used\./)
  })

  it("offers no Add Transcribe on a read-only canvas", () => {
    seed()
    useWorkflowStore.setState({ isReadOnly: true } as never)
    panel()
    expect(screen.queryByTestId("speaker-view-add-transcribe")).toBeNull()
  })

  it("refuses an edit and a video together, in the badge", () => {
    seed({ transcript: true, edl: true })
    panel()
    expect(badgeDetails()).toMatch(/not both/i)
  })

  it("D18: refuses a video already as narrow as the target, naming it", () => {
    seed({ transcript: true, meta: { width: 1080, height: 1920 } })
    panel()
    expect(badgeDetails()).toMatch(/1080×1920/)
  })

  it("D10: warns, naming the upscale, for a low-resolution video", () => {
    seed({ transcript: true, meta: { width: 640, height: 360 } })
    panel()
    expect(badgeDetails()).toMatch(/640×360/)
  })
})
