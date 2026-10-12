import { describe, expect, it } from "vitest"
import { speakerFramesResultSummary, speakerFramesSourcesOf, toggleSpeakerFramesSource } from "../speaker-frames-panel"
import { speakerViewTranscript } from "../speaker-view-context"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const edl = {
  version: 1,
  clock: "master",
  sources: [
    { id: "camA", url: "https://m.example/a.mp4", kind: "video" },
    { id: "camB", url: "https://m.example/b.mp4", kind: "video" },
  ],
  segments: [{ id: "s0", inMs: 0, outMs: 30_000, video: "camA" }],
}

const graph = (data: Record<string, unknown> = {}, planOut: unknown = edl) => {
  const nodes = [
    { id: "camA", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Host cam" } },
    { id: "plan", type: "edit-plan", position: { x: 0, y: 0 }, data: { label: "Plan", generatedJson: planOut } },
    { id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: { label: "Speaker Frames", ...data } },
  ] as unknown as WorkflowNode[]
  const edges = [{ id: "e", source: "plan", target: "sf", sourceHandle: "edl", targetHandle: "edl" }] as unknown as WorkflowEdge[]
  return { nodes, edges }
}

describe("speakerFramesSourcesOf", () => {
  it("lists each camera with its canvas label, frames and tick", () => {
    const { nodes, edges } = graph({ excludeSourceIds: ["camB"] })
    const rows = speakerFramesSourcesOf("sf", nodes, edges)
    expect(rows.map((r) => [r.sourceId, r.label, r.ticked])).toEqual([["camA", "Host cam", true], ["camB", "camB", false]])
    expect(rows[0]!.frames).toBe(64)
  })
  it("reads a clip pack as one run's cameras", () => {
    const clip2 = { ...edl, segments: [{ id: "c", inMs: 60_000, outMs: 70_000, video: "camA" }] }
    const { nodes, edges } = graph({}, [edl, clip2])
    expect(speakerFramesSourcesOf("sf", nodes, edges)[0]!.frames).toBe(64 + 28)
  })
  it("is empty with nothing wired", () => {
    expect(speakerFramesSourcesOf("sf", graph().nodes, [])).toEqual([])
  })
})

describe("toggleSpeakerFramesSource", () => {
  it("adds and removes an id without mutating", () => {
    const before = ["x"]
    expect(toggleSpeakerFramesSource(before, "camA", false)).toEqual(["x", "camA"])
    expect(toggleSpeakerFramesSource(["camA", "x"], "camA", true)).toEqual(["x"])
    expect(before).toEqual(["x"])
  })
})

describe("speakerFramesResultSummary", () => {
  const descriptor = {
    version: 1, sampleFps: 2, detector: { id: "yunet" }, url: "https://r/x.json", sha256: "a".repeat(64), bytes: 9,
    sources: [{ sourceId: "camA", clock: "source", frame: { w: 960, h: 540 }, sampledSpans: [{ startMs: 0, endMs: 1000 }], tracks: [
      { id: "camA/t1", speaker: "Host", attribution: { method: "source-map", confidence: 1 }, boxCount: 2 },
      { id: "camA/t2", boxCount: 2 },
    ] }],
  }
  it("summarizes per camera after the node's corrections, listing stale ones", () => {
    const s = speakerFramesResultSummary(descriptor, [{ trackId: "camA/t2", speaker: "Guest" }, { trackId: "gone", speaker: "X" }])
    expect(s).toEqual({ sources: [{ sourceId: "camA", tracks: 2, speakers: ["Host", "Guest"], unattributed: 0 }], unmatched: [{ trackId: "gone", speaker: "X" }] })
    expect(speakerFramesResultSummary(descriptor, undefined)!.sources[0]!.unattributed).toBe(1)
    expect(speakerFramesResultSummary(undefined, undefined)).toBeNull()
  })

  // Decided 2026-10-10: the panel shows the corrections (and the auto labels)
  // through the speaker-rename map of the transcript wired into Speaker Frames.
  const renamed = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "SPEAKER_00" }], speakerNames: { SPEAKER_00: "Alice", SPEAKER_01: "Bob" } }
  const raw = {
    ...descriptor,
    sources: [{ ...descriptor.sources[0]!, tracks: [
      { id: "camA/t1", speaker: "SPEAKER_00", attribution: { method: "mouth-motion", confidence: 0.9, rawSpeaker: "SPEAKER_00" }, boxCount: 2 },
      { id: "camA/t2", boxCount: 2 },
    ] }],
  }

  it("reads a correction through the rename map: saved as Host (SPEAKER_01), shown under today's name", () => {
    const s = speakerFramesResultSummary(raw, [{ trackId: "camA/t2", speaker: "Host", rawSpeaker: "SPEAKER_01" }], renamed)
    expect(s!.sources[0]!.speakers).toEqual(["Alice", "Bob"])
    expect(s!.sources[0]!.unattributed).toBe(0)
  })

  it("lists a stale correction under the name it resolves to today", () => {
    const s = speakerFramesResultSummary(raw, [{ trackId: "gone", speaker: "Host", rawSpeaker: "SPEAKER_01" }], renamed)
    expect(s!.unmatched).toEqual([{ trackId: "gone", speaker: "Bob", rawSpeaker: "SPEAKER_01" }])
  })

  it("keeps the file's names with no transcript wired, as before", () => {
    const s = speakerFramesResultSummary(raw, [{ trackId: "camA/t2", speaker: "Host", rawSpeaker: "SPEAKER_01" }])
    expect(s!.sources[0]!.speakers).toEqual(["SPEAKER_00", "Host"])
  })

  it("reads the transcript wired into Speaker Frames (a Camera Switch's renamed transcript)", () => {
    const nodes = [
      { id: "cs", type: "camera-switch", position: { x: 0, y: 0 }, data: { generatedJson: { edl, transcript: renamed } } },
      { id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: { generatedJson: raw, trackAssignments: [{ trackId: "camA/t2", speaker: "Host", rawSpeaker: "SPEAKER_01" }] } },
    ] as unknown as WorkflowNode[]
    const edges = [{ id: "t", source: "cs", target: "sf", sourceHandle: "transcript", targetHandle: "transcript" }] as unknown as WorkflowEdge[]
    // What the node face reads: its saved output and corrections, with the transcript wired into it.
    const sf = nodes[1]!.data as { generatedJson: unknown; trackAssignments: never }
    const shown = (e: WorkflowEdge[]) => speakerFramesResultSummary(sf.generatedJson, sf.trackAssignments, speakerViewTranscript("sf", nodes, e))
    expect(shown(edges)!.sources[0]!.speakers).toEqual(["Alice", "Bob"])
    expect(shown([])!.sources[0]!.speakers).toEqual(["SPEAKER_00", "Host"])
  })
})
