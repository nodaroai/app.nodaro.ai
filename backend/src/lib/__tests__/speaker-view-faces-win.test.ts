/**
 * "Split the camera by speaker" (`autoRegions`) with Speaker Frames' face
 * tracks wired: FACES WIN (decided 2026-10-13). A speaker a track names is
 * followed by it, and no automatic box is sent for them (on the wire, a
 * (camera, speaker) row is the plugin's static fallback and its zoom floor);
 * the automatic boxes frame only the speakers no track names. The "Which face
 * is …?" question is unchanged by the boxes, and the framing note says both.
 */
import { describe, it, expect } from "vitest"
import {
  speakerViewAutoFraming,
  speakerViewAutoRegions,
  speakerViewContext,
  speakerViewFramingNote,
  speakerViewIdleEdit,
  speakerViewRenderBasis,
  speakerViewTracksAtRest,
  speakerViewUnnamedSpeakers,
  speakerViewWireSettings,
} from "@nodaro/render-rules"
import { buildSpeakerViewPayload } from "../../services/workflow-engine/speaker-view-payload.js"

const AUTO = { layout: "single", targetAspect: "9:16", autoRegions: true }
const words = (labels: string[]) => ({ version: 1, words: labels.map((speaker, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 500, speaker })) })
const TWO = words(["speaker_0", "speaker_0", "speaker_1"])

const descriptor = (tracks: unknown[], sourceId: string) => ({
  version: 1,
  sampleFps: 2,
  detector: { id: "yunet" },
  url: "https://cdn/speaker-tracks/11111111-2222-4333-8444-555555555555.json",
  sha256: "a".repeat(64),
  bytes: 10,
  sources: [{ sourceId, clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: 0, endMs: 14_000 }], tracks }],
})
const named = (id: string, speaker: string) => ({ id, boxCount: 3, speaker, attribution: { method: "mouth-motion", confidence: 0.9, rawSpeaker: speaker } })
const loose = (id: string) => ({ id, boxCount: 3 })

/** The tracks as every caller hands them to the context: Speaker Frames' result with the app's labels. */
const labelled = (tracks: unknown, transcript: unknown, data: Record<string, unknown> = AUTO) =>
  speakerViewTracksAtRest({ tracks, wired: true, transcript, data })!

describe("a video fed in place of an edit (the bare video's camera)", () => {
  const idle = speakerViewIdleEdit({ url: "https://r2/rec.mp4", transcript: TWO, targetAspect: "9:16" })!
  const ONE_UNNAMED = descriptor([named("video/t1", "speaker_1"), loose("video/t2")], "video")
  const ALL_NAMED = descriptor([named("video/t1", "speaker_1"), named("video/t2", "speaker_0")], "video")

  it("without tracks: every speaker on the camera gets their third (unchanged)", () => {
    const rows = speakerViewAutoRegions(AUTO, speakerViewContext(idle, TWO))
    expect(rows.map((r) => [r.speaker, r.region.x])).toEqual([["speaker_0", 0.0918], ["speaker_1", 0.5918]])
    expect(speakerViewFramingNote({ speakers: ["speaker_0", "speaker_1"], tracksWired: false, speakerRegions: [], defaultRegionKeys: [], autoRegions: rows })).toBeNull()
  })

  it("one speaker no track names: only they get a box — the very third the panel deals them — and the tracked one is followed", () => {
    const tracked = labelled(ONE_UNNAMED, TWO)
    const rows = speakerViewAutoRegions(AUTO, speakerViewContext(idle, TWO, { tracks: tracked.tracks }))
    expect(rows.map((r) => [r.speaker, r.region.x])).toEqual([["speaker_0", 0.0918]])
    expect(speakerViewWireSettings(AUTO, speakerViewContext(idle, TWO, { tracks: tracked.tracks })).speakerRegions?.map((r) => r.speaker)).toEqual(["speaker_0"])
  })

  it("the question asks about exactly the speakers the boxes are left for — the automatic boxes never answer it", () => {
    const tracked = labelled(ONE_UNNAMED, TWO)
    const unnamed = speakerViewUnnamedSpeakers({ tracks: ONE_UNNAMED, transcript: TWO })
    expect(unnamed).toEqual([{ speaker: "speaker_0", name: "speaker_0" }])
    const rows = speakerViewAutoRegions(AUTO, speakerViewContext(idle, TWO, { tracks: tracked.tracks }))
    // One definition of "tracked": nobody is both followed and boxed, nor neither.
    expect(rows.map((r) => r.speaker)).toEqual(unnamed.map((u) => u.speaker))
  })

  it("the note says both: who no face is tied to, and that they get the default framing until then", () => {
    const tracked = labelled(ONE_UNNAMED, TWO)
    const autoRegions = speakerViewAutoRegions(AUTO, speakerViewContext(idle, TWO, { tracks: tracked.tracks }))
    const unnamed = speakerViewUnnamedSpeakers({ tracks: ONE_UNNAMED, transcript: TWO })
    expect(speakerViewFramingNote({ speakers: ["speaker_0", "speaker_1"], tracksWired: true, speakerRegions: [], defaultRegionKeys: [], autoRegions, unnamed })).toBe(
      "Speaker Frames could not tell which face is speaker_0. Pick their faces in Edit framing…, then Update preview; until then Speaker View does not follow them." +
        ' Until then, speaker_0 gets the default framing of "Split the camera by speaker".',
    )
    // Without the switch, the note is the tap-first one alone.
    expect(speakerViewFramingNote({ speakers: ["speaker_0", "speaker_1"], tracksWired: true, speakerRegions: [], defaultRegionKeys: [], unnamed })).toBe(
      "Speaker Frames could not tell which face is speaker_0. Pick their faces in Edit framing…, then Update preview; until then Speaker View does not follow them.",
    )
  })

  it("every speaker named: nothing is asked, no box is sent, the note is silent", () => {
    const tracked = labelled(ALL_NAMED, TWO)
    expect(speakerViewUnnamedSpeakers({ tracks: ALL_NAMED, transcript: TWO })).toEqual([])
    const ctx = speakerViewContext(idle, TWO, { tracks: tracked.tracks })
    expect(speakerViewAutoRegions(AUTO, ctx)).toEqual([])
    expect(speakerViewWireSettings(AUTO, ctx)).not.toHaveProperty("speakerRegions")
    expect(speakerViewFramingNote({ speakers: ["speaker_0", "speaker_1"], tracksWired: true, speakerRegions: [], defaultRegionKeys: [], autoRegions: [], unnamed: [] })).toBeNull()
  })

  it("a correction counts as a name, and a renamed speaker is matched through the rename map", () => {
    const corrected = speakerViewTracksAtRest({ tracks: ONE_UNNAMED, wired: true, transcript: TWO, trackAssignments: [{ trackId: "video/t2", speaker: "speaker_0", rawSpeaker: "speaker_0" }], data: AUTO })!
    expect(speakerViewAutoRegions(AUTO, speakerViewContext(idle, TWO, { tracks: corrected.tracks }))).toEqual([])

    const renamed = { ...TWO, speakerNames: { speaker_0: "Alex", speaker_1: "Sam" } }
    const tracks = descriptor([named("video/t1", "speaker_1"), loose("video/t2")], "video")
    const tracked = labelled(tracks, renamed)
    // The track now reads "Sam"; the box for the transcript's speaker_1 is still left out.
    expect(speakerViewAutoRegions(AUTO, speakerViewContext(idle, renamed, { tracks: tracked.tracks })).map((r) => r.speaker)).toEqual(["speaker_0"])
  })
})

describe("the run's body (one camera of an edit): automatic rows never shadow a tracked speaker", () => {
  const src = { id: "cam", url: "https://r2/cam.mp4", kind: "video" as const }
  const seg = (id: string, inS: number, speaker: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video: "cam", speaker })
  const EDL = { version: 1, clock: "master", sources: [src], segments: [seg("s0", 0, "Host"), seg("s1", 5, "Guest")] }
  const TRACKS = descriptor([named("cam/t1", "Host"), loose("cam/t2")], "cam")
  const build = (tracked?: ReturnType<typeof labelled>) =>
    buildSpeakerViewPayload({ nodeId: "sv", jobId: "job-1", data: AUTO, edl: EDL, ...(tracked ? { tracked } : {}) }).payload as Record<string, unknown>

  it("without tracks both speakers get their third; with Host tracked only Guest's box is sent, and the basis says so", () => {
    const plain = build()
    expect((plain.speakerRegions as Array<{ speaker: string }>).map((r) => r.speaker)).toEqual(["Host", "Guest"])
    const tracked = labelled(TRACKS, undefined)
    const withTracks = build(tracked)
    expect(withTracks.speakerRegions).toEqual([{ source: "cam", speaker: "Guest", region: { x: 0.5918, y: 0, w: 0.3164, h: 1 } }])
    expect(withTracks.tracks).toBeDefined()
    // The basis is stamped over the rows the run sends, exactly as the editor's review computes it.
    const wire = speakerViewWireSettings(AUTO, speakerViewContext(EDL, undefined, { tracks: tracked.tracks }))
    expect(withTracks.renderBasis).toBe(speakerViewRenderBasis(wire, EDL, tracked.basis))
    expect(withTracks.renderBasis).not.toBe(speakerViewRenderBasis(speakerViewWireSettings(AUTO, speakerViewContext(EDL)), EDL, tracked.basis))
  })

  it("every speaker tracked: no automatic row at all", () => {
    const all = labelled(descriptor([named("cam/t1", "Host"), named("cam/t2", "Guest")], "cam"), undefined)
    expect(build(all)).not.toHaveProperty("speakerRegions")
  })

  it("drawn regions still win over everything (unchanged)", () => {
    const drawn = [{ source: "cam", speaker: "Host", region: { x: 0.1, y: 0, w: 0.3, h: 1 } }]
    const payload = buildSpeakerViewPayload({ nodeId: "sv", jobId: "job-1", data: { ...AUTO, speakerRegions: drawn }, edl: EDL, tracked: labelled(TRACKS, undefined, { ...AUTO, speakerRegions: drawn }) }).payload
    expect(payload.speakerRegions).toEqual(drawn)
  })
})

describe("speakerViewAutoFraming: the panel's line, read off the rows the run sends", () => {
  const src = { id: "cam", url: "https://r2/cam.mp4", kind: "video" as const }
  const seg = (id: string, inS: number, speaker: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video: "cam", speaker })
  const EDL = { version: 1, clock: "master", sources: [src], segments: [seg("s0", 0, "Host"), seg("s1", 5, "Guest")] }
  const ctxWith = (tracks?: unknown[]) => speakerViewContext(EDL, undefined, tracks ? { tracks: labelled(descriptor(tracks, "cam"), undefined).tracks } : {})

  it("boxes, some tracked, all tracked, off", () => {
    expect(speakerViewAutoFraming(AUTO, ctxWith())).toBe("boxes")
    expect(speakerViewAutoFraming(AUTO, ctxWith([named("cam/t1", "Host"), loose("cam/t2")]))).toBe("some-tracked")
    expect(speakerViewAutoFraming(AUTO, ctxWith([named("cam/t1", "Host"), named("cam/t2", "Guest")]))).toBe("all-tracked")
    expect(speakerViewAutoFraming(AUTO, ctxWith([loose("cam/t1")]))).toBe("boxes")
    expect(speakerViewAutoFraming({ ...AUTO, autoRegions: false }, ctxWith([named("cam/t1", "Host")]))).toBe("off")
    expect(speakerViewAutoFraming({ ...AUTO, targetAspect: "16:9" }, ctxWith([named("cam/t1", "Host")]))).toBe("off")
    expect(speakerViewAutoFraming(AUTO, undefined)).toBe("off")
  })
})
