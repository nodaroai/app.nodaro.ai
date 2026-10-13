/**
 * Tap-first face-to-speaker (decided 2026-10-13): which of a video-fed Speaker
 * View's speakers no face track names, read from Speaker Frames' result after
 * the renames and the node's corrections — the trigger of "Which face is …?".
 */
import { describe, it, expect } from "vitest"
import { renderFinalRunSet, speakerViewFramingNote, speakerViewUnnamedSpeakers } from "@nodaro/render-rules"

const words = (labels: string[]) => ({ version: 1, words: labels.map((speaker, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 500, speaker })) })
const TWO = words(["speaker_0", "speaker_0", "speaker_1"])

const track = (id: string, extra: Record<string, unknown> = {}) => ({ id, boxCount: 3, ...extra })
const descriptor = (tracks: unknown[], sourceId = "video") => ({
  version: 1,
  sampleFps: 2,
  detector: { id: "yunet" },
  url: "https://cdn/speaker-tracks/11111111-2222-4333-8444-555555555555.json",
  sha256: "a".repeat(64),
  bytes: 10,
  sources: [{ sourceId, clock: "source", frame: { w: 640, h: 360 }, sampledSpans: [{ startMs: 0, endMs: 14_000 }], tracks }],
})

describe("speakerViewUnnamedSpeakers", () => {
  it("names every transcript speaker when the matcher abstained on every track", () => {
    const tracks = descriptor([track("video/t1"), track("video/t2")])
    expect(speakerViewUnnamedSpeakers({ tracks, transcript: TWO })).toEqual([
      { speaker: "speaker_0", name: "speaker_0" },
      { speaker: "speaker_1", name: "speaker_1" },
    ])
  })

  it("leaves out a speaker a track is attributed to", () => {
    const tracks = descriptor([track("video/t1", { speaker: "speaker_1", attribution: { method: "mouth-motion", confidence: 0.9, rawSpeaker: "speaker_1" } }), track("video/t2")])
    expect(speakerViewUnnamedSpeakers({ tracks, transcript: TWO }).map((s) => s.speaker)).toEqual(["speaker_0"])
  })

  it("is empty once every speaker is named, by the matcher or a correction", () => {
    const tracks = descriptor([track("video/t1", { speaker: "speaker_1" }), track("video/t2")])
    const trackAssignments = [{ trackId: "video/t2", speaker: "speaker_0", rawSpeaker: "speaker_0" }]
    expect(speakerViewUnnamedSpeakers({ tracks, transcript: TWO, trackAssignments })).toEqual([])
  })

  it("a correction to Nobody names no one", () => {
    const tracks = descriptor([track("video/t1", { speaker: "speaker_1" }), track("video/t2")])
    const trackAssignments = [{ trackId: "video/t1", speaker: null }]
    expect(speakerViewUnnamedSpeakers({ tracks, transcript: TWO, trackAssignments }).map((s) => s.speaker)).toEqual(["speaker_0", "speaker_1"])
  })

  it("reads names through the transcript's rename map, and matches a renamed track by its raw label", () => {
    const transcript = { ...TWO, speakerNames: { speaker_0: "Alex", speaker_1: "Sam" } }
    const tracks = descriptor([track("video/t1", { speaker: "speaker_1", attribution: { method: "mouth-motion", confidence: 0.9, rawSpeaker: "speaker_1" } })])
    expect(speakerViewUnnamedSpeakers({ tracks, transcript })).toEqual([{ speaker: "speaker_0", name: "Alex" }])
  })

  it("a speaker with a drawn box is framed by it, so it is not asked about; a default box does not count", () => {
    const tracks = descriptor([track("video/t1"), track("video/t2")])
    const region = { x: 0, y: 0, w: 0.3, h: 1 }
    const speakerRegions = [{ source: "video", speaker: "speaker_0", region }, { source: "video", speaker: "speaker_1", region: { ...region, x: 0.6 } }]
    const defaultRegionKeys = [JSON.stringify(["video", "speaker_1"])]
    expect(speakerViewUnnamedSpeakers({ tracks, transcript: TWO, speakerRegions, defaultRegionKeys }).map((s) => s.speaker)).toEqual(["speaker_1"])
  })

  it("asks nothing with fewer than two speakers (a single speaker is followed without a name)", () => {
    expect(speakerViewUnnamedSpeakers({ tracks: descriptor([track("video/t1")]), transcript: words(["speaker_0"]) })).toEqual([])
  })

  it("asks nothing without a result, a transcript, or a bare-video source", () => {
    expect(speakerViewUnnamedSpeakers({ tracks: undefined, transcript: TWO })).toEqual([])
    expect(speakerViewUnnamedSpeakers({ tracks: "", transcript: TWO })).toEqual([])
    expect(speakerViewUnnamedSpeakers({ tracks: descriptor([track("video/t1")]), transcript: undefined })).toEqual([])
    expect(speakerViewUnnamedSpeakers({ tracks: descriptor([track("wide/t1")], "wide"), transcript: TWO })).toEqual([])
  })

  it("reads the descriptor from its JSON string as well", () => {
    const tracks = JSON.stringify(descriptor([track("video/t1")]))
    expect(speakerViewUnnamedSpeakers({ tracks, transcript: TWO })).toHaveLength(2)
  })
})

describe("speakerViewFramingNote with face tracks wired (tap-first)", () => {
  it("names the speakers no face is tied to, and says how to fix it", () => {
    const note = speakerViewFramingNote({ speakers: ["speaker_0", "speaker_1"], tracksWired: true, speakerRegions: [], defaultRegionKeys: [], unnamed: ["Alex", "Sam"] })
    expect(note).toBe("Speaker Frames could not tell which face is Alex, Sam. Pick their faces in Edit framing…, then Update preview; until then Speaker View does not follow them.")
  })

  it("is silent when every speaker has a face, or nothing is known yet", () => {
    expect(speakerViewFramingNote({ speakers: ["speaker_0"], tracksWired: true, speakerRegions: [], defaultRegionKeys: [], unnamed: [] })).toBeNull()
    expect(speakerViewFramingNote({ speakers: ["speaker_0"], tracksWired: true, speakerRegions: [], defaultRegionKeys: [] })).toBeNull()
  })
})

describe("Update preview after the faces are picked: the Reframe chain with no Edit Plan", () => {
  it("re-renders Speaker View (and what follows it) only — Transcribe and Speaker Frames keep their saved results", () => {
    const nodes = [{ id: "up", type: "upload-video" }, { id: "tx", type: "transcribe" }, { id: "sf", type: "speaker-frames" }, { id: "sv", type: "speaker-view" }, { id: "cap", type: "add-captions" }]
    const edges = [
      { source: "up", target: "tx", targetHandle: "audio" },
      { source: "up", target: "sf", targetHandle: "video" },
      { source: "up", target: "sv", targetHandle: "video" },
      { source: "tx", target: "sf", targetHandle: "transcript" },
      { source: "tx", target: "sv", targetHandle: "transcript" },
      { source: "sf", target: "sv", sourceHandle: "tracks", targetHandle: "tracks" },
      { source: "sv", target: "cap", targetHandle: "video" },
    ]
    expect([...renderFinalRunSet("sv", nodes, edges)].sort()).toEqual(["cap", "sv"])
  })
})
