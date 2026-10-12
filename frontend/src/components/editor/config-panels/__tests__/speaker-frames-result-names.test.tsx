/**
 * Speaker Frames' panel shows its result through the speaker-rename map of the
 * transcript wired into it (decided 2026-10-10): a correction saved as "Host"
 * shows under today's name once Camera Switch renames that speaker.
 */
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { SpeakerFramesConfig } from "../speaker-frames-config"
import type { SpeakerFramesNodeData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

const EDL = { version: 1, clock: "master", sources: [{ id: "camA", url: "https://x/a.mp4", kind: "video" }], segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "camA" }] }
const RENAMED = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "SPEAKER_00" }], speakerNames: { SPEAKER_00: "Alice", SPEAKER_01: "Bob" } }
const TRACKS = {
  version: 1, sampleFps: 2, detector: { id: "yunet" }, url: "https://x/speaker-tracks/j.json", sha256: "a".repeat(64), bytes: 10,
  sources: [{ sourceId: "camA", clock: "source", frame: { w: 960, h: 540 }, sampledSpans: [{ startMs: 0, endMs: 5000 }], tracks: [
    { id: "camA/t1", speaker: "SPEAKER_00", attribution: { method: "mouth-motion", confidence: 0.9, rawSpeaker: "SPEAKER_00" }, boxCount: 4 },
    { id: "camA/t2", boxCount: 4 },
  ] }],
}

afterEach(cleanup)

function renderPanel(withTranscript: boolean) {
  const data = { label: "Speaker Frames", fieldMappings: {}, generatedJson: TRACKS, trackAssignments: [{ trackId: "camA/t2", speaker: "Host", rawSpeaker: "SPEAKER_01" }] } as unknown as SpeakerFramesNodeData
  const nodes = [
    { id: "cs", type: "camera-switch", position: { x: 0, y: 0 }, data: { generatedJson: { edl: EDL, transcript: RENAMED } } },
    { id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data },
  ] as unknown as WorkflowNode[]
  const edges = [
    { id: "e", source: "cs", sourceHandle: "edl", target: "sf", targetHandle: "edl" },
    ...(withTranscript ? [{ id: "t", source: "cs", sourceHandle: "transcript", target: "sf", targetHandle: "transcript" }] : []),
  ] as unknown as WorkflowEdge[]
  render(<SpeakerFramesConfig data={data} onUpdate={() => {}} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={nodes} edges={edges} nodeId="sf" />)
}

describe("Speaker Frames' result names", () => {
  it("shows the auto label and the correction under today's names", () => {
    renderPanel(true)
    expect(screen.getByTestId("speaker-frames-result").textContent).toContain("Alice, Bob")
  })

  it("shows the file's names when no transcript is wired", () => {
    renderPanel(false)
    expect(screen.getByTestId("speaker-frames-result").textContent).toContain("SPEAKER_00, Host")
  })
})
