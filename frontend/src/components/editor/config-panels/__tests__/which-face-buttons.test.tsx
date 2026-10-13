/**
 * "Which face is …?" on the panels (tap-first, decided 2026-10-13): when
 * Speaker Frames' result ties no face to a speaker of the video-fed Speaker
 * View it feeds, both panels offer the button that opens that Speaker View's
 * region editor — only while video mode is live (R15).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

// `priced`: Speaker View; `frames`: Speaker Frames. Video mode is open only with both (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))

import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { SpeakerFramesConfig } from "../speaker-frames-config"
import { SpeakerViewConfig } from "../speaker-view-config"
import { useFramingOpenStore } from "@/hooks/use-framing-open-store"
import { translate } from "@/lib/i18n"
import type { SpeakerFramesNodeData, SpeakerViewData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

const TRANSCRIPT = { version: 1, words: [{ text: "so", startMs: 0, endMs: 400, speaker: "speaker_0" }, { text: "right", startMs: 12_000, endMs: 12_400, speaker: "speaker_1" }] }
const TRACKS = {
  version: 1, sampleFps: 2, detector: { id: "yunet" }, url: "https://x/speaker-tracks/j.json", sha256: "a".repeat(64), bytes: 10,
  sources: [{ sourceId: "video", clock: "source", frame: { w: 640, h: 360 }, sampledSpans: [{ startMs: 0, endMs: 14_000 }], tracks: [{ id: "video/t1", boxCount: 4 }, { id: "video/t2", boxCount: 4 }] }],
}

function graph(framesData: Record<string, unknown> = {}) {
  const frames = { label: "Speaker Frames", fieldMappings: {}, generatedJson: TRACKS, ...framesData }
  const view = { label: "Speaker View", fieldMappings: {} }
  const nodes = [
    { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Clip", url: "https://cdn/clip.mp4", metadata: { width: 1920, height: 1080 } } },
    { id: "tx", type: "transcribe", position: { x: 0, y: 0 }, data: { label: "Transcribe", generatedResults: [{ url: "", transcript: TRANSCRIPT }], activeResultIndex: 0 } },
    { id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: frames },
    { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: view },
  ] as unknown as WorkflowNode[]
  const edges = [
    { id: "e1", source: "up", target: "sv", targetHandle: "video" },
    { id: "e2", source: "tx", target: "sv", targetHandle: "transcript" },
    { id: "e3", source: "sf", sourceHandle: "tracks", target: "sv", targetHandle: "tracks" },
    { id: "e4", source: "up", target: "sf", targetHandle: "video" },
  ] as unknown as WorkflowEdge[]
  return { nodes, edges, frames: frames as unknown as SpeakerFramesNodeData, view: view as unknown as SpeakerViewData }
}

const common = { onUpdate: () => {}, sources: [], fieldMappings: {}, onMapField: () => {} }
const renderFrames = (g: ReturnType<typeof graph>) => render(<SpeakerFramesConfig {...common} data={g.frames} nodes={g.nodes} edges={g.edges} nodeId="sf" />)
const renderView = (g: ReturnType<typeof graph>) => render(<SpeakerViewConfig {...common} data={g.view} nodes={g.nodes} edges={g.edges} nodeId="sv" />)

beforeEach(() => {
  flag.priced = true
  flag.frames = true
  useFramingOpenStore.setState({ hostMounted: true, nodeId: null })
})
afterEach(cleanup)

describe("Which face is …? on the panels", () => {
  it("Speaker View's panel asks about the first speaker no face is tied to, and opens its region editor", () => {
    renderView(graph())
    const button = screen.getByTestId("speaker-view-which-face")
    expect(button.textContent).toBe(t("speakerView.framing.whichFace", { speaker: "speaker_0" }))
    fireEvent.click(button)
    expect(useFramingOpenStore.getState().nodeId).toBe("sv")
  })

  it("Speaker Frames' panel opens the Speaker View its tracks feed", () => {
    renderFrames(graph())
    fireEvent.click(screen.getByTestId("speaker-frames-which-face"))
    expect(useFramingOpenStore.getState().nodeId).toBe("sv")
  })

  it("asks nothing once every speaker has a face", () => {
    const g = graph({ trackAssignments: [{ trackId: "video/t1", speaker: "speaker_0", rawSpeaker: "speaker_0" }, { trackId: "video/t2", speaker: "speaker_1", rawSpeaker: "speaker_1" }] })
    renderView(g)
    expect(screen.queryByTestId("speaker-view-which-face")).toBeNull()
    cleanup()
    renderFrames(g)
    expect(screen.queryByTestId("speaker-frames-which-face")).toBeNull()
  })

  it("R15: hidden on both panels while video mode is not live", () => {
    flag.frames = false
    renderView(graph())
    expect(screen.queryByTestId("speaker-view-which-face")).toBeNull()
    cleanup()
    renderFrames(graph())
    expect(screen.queryByTestId("speaker-frames-which-face")).toBeNull()
  })
})
