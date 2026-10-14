// @vitest-environment node
import { describe, it, expect } from "vitest"
import type { SpeakerTrackSet, SpeakerTrackSetDescriptor } from "@nodaro/shared/edl"
import { faceGuideSteps, faceGuideStepKey } from "../face-guide"

const box = (ms: number, x: number) => ({ ms, x, y: 0.2, w: 0.1, h: 0.2 })
const BODY: SpeakerTrackSet = {
  version: 1,
  sampleFps: 2,
  detector: { id: "yunet" },
  sources: [{
    sourceId: "video",
    clock: "source",
    frame: { w: 640, h: 360 },
    sampledSpans: [{ startMs: 0, endMs: 14_000 }],
    tracks: [
      // The man, on screen from the start; the woman, tracked in two fragments (lost at 6 s).
      { id: "video/t1", boxes: [box(0, 0.2), box(500, 0.2), box(12_000, 0.2)] },
      { id: "video/t2", boxes: [box(0, 0.7), box(5500, 0.7)] },
      { id: "video/t3", boxes: [box(9000, 0.7), box(12_500, 0.7)] },
    ],
  }],
} as unknown as SpeakerTrackSet

const labelled = (speakers: Record<string, string> = {}): SpeakerTrackSetDescriptor =>
  ({
    sources: [{ sourceId: "video", tracks: BODY.sources[0]!.tracks.map((t) => ({ id: t.id, boxCount: t.boxes.length, ...(speakers[t.id] ? { speaker: speakers[t.id] } : {}) })) }],
  }) as unknown as SpeakerTrackSetDescriptor

const TURNS = [
  { speaker: "speaker_0", startMs: 200, endMs: 3600 },
  { speaker: "speaker_1", startMs: 12_000, endMs: 13_000 },
]

const base = {
  turns: TURNS,
  body: BODY,
  nobody: () => false,
  skipped: new Set<string>(),
  sourceId: "video",
}

describe("faceGuideSteps", () => {
  it("asks about each unnamed speaker first, at a moment they talk with an unnamed face on screen", () => {
    const steps = faceGuideSteps({ ...base, unnamed: ["speaker_0", "speaker_1"], labelled: labelled() })
    expect(steps.slice(0, 2)).toEqual([
      { kind: "speaker", speaker: "speaker_0", seekMs: 500 },
      { kind: "speaker", speaker: "speaker_1", seekMs: 12_000 },
    ])
  })

  it("then asks about each fragment no one is tied to, in time order: one tap per fragment", () => {
    const steps = faceGuideSteps({ ...base, unnamed: [], labelled: labelled({ "video/t1": "speaker_0", "video/t2": "speaker_1" }) })
    expect(steps).toEqual([{ kind: "fragment", trackId: "video/t3", seekMs: 9000 }])
  })

  it("falls back to the speaker's first turn when no unnamed face is on screen while they talk", () => {
    const steps = faceGuideSteps({ ...base, turns: [{ speaker: "speaker_1", startMs: 7000, endMs: 8000 }], unnamed: ["speaker_1"], labelled: labelled() })
    expect(steps[0]).toEqual({ kind: "speaker", speaker: "speaker_1", seekMs: 7000 })
  })

  it("leaves out what was skipped, and a fragment marked Nobody", () => {
    const skipped = new Set([faceGuideStepKey({ kind: "speaker", speaker: "speaker_0" })])
    const steps = faceGuideSteps({ ...base, unnamed: ["speaker_0"], labelled: labelled({ "video/t1": "speaker_1" }), skipped, nobody: (id) => id === "video/t2" })
    expect(steps).toEqual([{ kind: "fragment", trackId: "video/t3", seekMs: 9000 }])
  })

  it("is empty once every speaker and fragment is named", () => {
    expect(faceGuideSteps({ ...base, unnamed: [], labelled: labelled({ "video/t1": "speaker_0", "video/t2": "speaker_1", "video/t3": "speaker_1" }) })).toEqual([])
  })

  it("asks nothing about a fragment until the track file is read", () => {
    expect(faceGuideSteps({ ...base, body: undefined, unnamed: ["speaker_1"], labelled: labelled({ "video/t1": "speaker_0" }) })).toEqual([
      { kind: "speaker", speaker: "speaker_1", seekMs: 12_000 },
    ])
  })
})
