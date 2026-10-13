/**
 * Speaker View's `tracks` lane on the canvas (P3.9): Speaker Frames' saved
 * descriptor reaches `inputs.tracks` as a JSON string, with the corrections its
 * node holds — the mirror of the backend resolver (speaker-view-dag.test.ts).
 */
import { describe, expect, it } from "vitest"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const TRACKS = {
  version: 1, sampleFps: 2, detector: { id: "yunet" }, url: "https://x/speaker-tracks/j.json", sha256: "a".repeat(64), bytes: 10,
  sources: [{ sourceId: "a", clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: 0, endMs: 9000 }], tracks: [{ id: "a/t1", boxCount: 4 }] }],
}

describe("the tracks lane", () => {
  it("routes Speaker Frames' descriptor and its corrections, never into the prompt", () => {
    const nodes = [
      { id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: { label: "Speaker Frames", generatedJson: TRACKS, trackAssignments: [{ trackId: "a/t1", speaker: "Host" }] } },
      { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View" } },
    ] as unknown as WorkflowNode[]
    const edges = [{ id: "e", source: "sf", sourceHandle: "tracks", target: "sv", targetHandle: "tracks" }] as unknown as WorkflowEdge[]
    const inputs = resolveNodeInputs(nodes[1]!, nodes, edges)
    expect(JSON.parse(inputs.tracks as string)).toEqual(TRACKS)
    expect(inputs.trackAssignments).toEqual([{ trackId: "a/t1", speaker: "Host" }])
    expect(inputs.prompt).toBeUndefined()
  })

  it("records a wire whose Speaker Frames has no output as \"\" (refused by the run, never v1) — the backend's null", () => {
    const nodes = [
      { id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: { label: "Speaker Frames" } },
      { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View" } },
    ] as unknown as WorkflowNode[]
    const edges = [{ id: "e", source: "sf", sourceHandle: "tracks", target: "sv", targetHandle: "tracks" }] as unknown as WorkflowEdge[]
    expect(resolveNodeInputs(nodes[1]!, nodes, edges).tracks).toBe("")
  })

  it("a video fed in place of an edit gets the corrections too — what \"Which face is …?\" saved (tap-first, decided 2026-10-13)", () => {
    const VIDEO_TRACKS = { ...TRACKS, sources: [{ ...TRACKS.sources[0]!, sourceId: "video", tracks: [{ id: "video/t1", boxCount: 4 }] }] }
    const nodes = [
      { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Clip", url: "https://cdn/clip.mp4" } },
      { id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: { label: "Speaker Frames", generatedJson: VIDEO_TRACKS, trackAssignments: [{ trackId: "video/t1", speaker: "speaker_1", rawSpeaker: "speaker_1" }] } },
      { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View" } },
    ] as unknown as WorkflowNode[]
    const edges = [
      { id: "v", source: "up", target: "sv", targetHandle: "video" },
      { id: "e", source: "sf", sourceHandle: "tracks", target: "sv", targetHandle: "tracks" },
    ] as unknown as WorkflowEdge[]
    const inputs = resolveNodeInputs(nodes[2]!, nodes, edges)
    expect(inputs.videoUrl).toBe("https://cdn/clip.mp4")
    expect(JSON.parse(inputs.tracks as string)).toEqual(VIDEO_TRACKS)
    expect(inputs.trackAssignments).toEqual([{ trackId: "video/t1", speaker: "speaker_1", rawSpeaker: "speaker_1" }])
  })

  it("leaves tracks unset with no wire", () => {
    const sv = { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", tracks: TRACKS } } as unknown as WorkflowNode
    expect(resolveNodeInputs(sv, [sv], []).tracks).toBeUndefined()
  })
})
