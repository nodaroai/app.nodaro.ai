/**
 * Speaker Frames' shared rules (P3.6): what an edit samples (P3-5, P3-24), the
 * "not priced yet" flag (P3.7), the run refusal, and the manual corrections
 * resolver (P3-18). One module both engines and the relay read.
 */
import { describe, expect, it } from "vitest"
import {
  SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID,
  SPEAKER_FRAMES_NOT_PRICED_MESSAGE,
  SPEAKER_FRAMES_PRICED,
  applySpeakerTrackAssignments,
  coerceSpeakerFramesEdits,
  speakerFramesRunRefusal,
  speakerFramesScope,
  speakerFramesLiveExclusions,
  speakerFramesSourceRows,
} from "@nodaro/render-rules"
import type { Edl, SpeakerTrackSetDescriptor } from "@nodaro/shared"

const edl = (over: Partial<Edl> = {}): Edl =>
  ({
    version: 1,
    clock: "master",
    sources: [
      { id: "mic", url: "https://media.example/mic.wav", kind: "audio", role: "master-audio" },
      { id: "camA", url: "https://media.example/cam-a.mp4", kind: "video" },
      { id: "camB", url: "https://media.example/cam-b.mp4", kind: "video", offsetMs: 4_000 },
    ],
    segments: [
      { id: "s0", inMs: 0, outMs: 30_000, video: "camA" },
      { id: "s1", inMs: 45_000, outMs: 75_000, video: "camB" },
    ],
    ...over,
  }) as Edl

describe("the price flag", () => {
  it("is off until P3.7, with the plugin route's own words", () => {
    expect(SPEAKER_FRAMES_PRICED).toBe(false)
    expect(SPEAKER_FRAMES_NOT_PRICED_MESSAGE).toBe("Speaker Frames is not priced yet")
  })

  it("refuses a run holding a Speaker Frames node, naming it; a skipped one never runs", () => {
    const r = speakerFramesRunRefusal([{ id: "a", type: "speaker-frames", data: {} }, { id: "b", type: "speaker-frames", data: { skipped: true } }, { id: "c", type: "text" }], false)
    expect(r?.nodeIds).toEqual(["a"])
    expect(r?.message).toContain(SPEAKER_FRAMES_NOT_PRICED_MESSAGE)
    expect(r?.message).toContain("nothing was charged")
    expect(speakerFramesRunRefusal([{ id: "a", type: "speaker-frames" }], true)).toBeNull()
    expect(speakerFramesRunRefusal([{ id: "c", type: "text" }], false)).toBeNull()
  })
})

describe("coerceSpeakerFramesEdits", () => {
  it("reads one edit, a pack, a clip set and their JSON strings", () => {
    const one = edl()
    expect(coerceSpeakerFramesEdits(one)).toEqual({ ok: true, edits: [one] })
    expect(coerceSpeakerFramesEdits(JSON.stringify(one))).toEqual({ ok: true, edits: [one] })
    expect(coerceSpeakerFramesEdits([one, one])).toEqual({ ok: true, edits: [one, one] })
    expect(coerceSpeakerFramesEdits({ clips: [one] })).toEqual({ ok: true, edits: [one] })
    // A fan-in delivers the pack as a list of JSON strings.
    expect(coerceSpeakerFramesEdits([JSON.stringify(one), JSON.stringify(one)])).toEqual({ ok: true, edits: [one, one] })
  })

  it("refuses an empty pack, an output-clock edit and a non-edit", () => {
    expect(coerceSpeakerFramesEdits([])).toMatchObject({ ok: false, code: "invalid_edl" })
    expect(coerceSpeakerFramesEdits({ ...edl(), clock: "output" })).toMatchObject({ ok: false, code: "invalid_edl" })
    expect(coerceSpeakerFramesEdits("not json")).toMatchObject({ ok: false, code: "invalid_edl" })
    expect(coerceSpeakerFramesEdits({ hello: 1 })).toMatchObject({ ok: false, code: "invalid_edl" })
  })
})

describe("speakerFramesScope (P3-5 (c), P3-24 (a)) — the plugin's scope, verbatim", () => {
  it("samples each video source's kept spans on its own clock, padded 2 s, the audio source never", () => {
    const r = speakerFramesScope({ edits: [edl()] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sources.map((s) => s.sourceId)).toEqual(["camA", "camB"])
    // camA: [0, 30 s] kept on every video source — sampledIds = every video source.
    expect(r.sources[0]).toMatchObject({ url: "https://media.example/cam-a.mp4", keptMs: 60_000 })
    expect(r.sources[0]!.spans).toEqual([{ startMs: 0, endMs: 32_000 }, { startMs: 43_000, endMs: 77_000 }])
    // camB is 4 s behind the master: master [0,30] → source [-4,26] clamped to [0,26]; [45,75] → [41,71].
    expect(r.sources[1]!.spans).toEqual([{ startMs: 0, endMs: 28_000 }, { startMs: 39_000, endMs: 73_000 }])
    expect(r.sources[1]!.keptMs).toBe(56_000)
    // Frames at 2 fps over the padded spans.
    expect(r.sources[0]!.frames).toBe(Math.ceil((32_000 + 34_000) / 500))
  })

  it("runs a pack once over the union of its clips' spans, one entry per source", () => {
    const a = edl({ segments: [{ id: "a", inMs: 0, outMs: 10_000, video: "camA" }] } as Partial<Edl>)
    const b = edl({ segments: [{ id: "b", inMs: 8_000, outMs: 20_000, video: "camA" }] } as Partial<Edl>)
    const r = speakerFramesScope({ edits: [a, b] })
    expect(r.ok && r.sources.find((s) => s.sourceId === "camA")!.spans).toEqual([{ startMs: 0, endMs: 22_000 }])
  })

  it("leaves unticked sources out, and refuses an untick of a source the edit does not sample", () => {
    const r = speakerFramesScope({ edits: [edl()], excludeSourceIds: ["camB"] })
    expect(r.ok && r.sources.map((s) => s.sourceId)).toEqual(["camA"])
    expect(speakerFramesScope({ edits: [edl()], excludeSourceIds: ["nope"] })).toMatchObject({ ok: false, code: "invalid_input" })
    expect(speakerFramesScope({ edits: [edl()], excludeSourceIds: ["camA", "camB"] })).toMatchObject({ ok: false, code: "invalid_input" })
  })

  it("refuses two files under one source id in a pack, and footage over 180 minutes", () => {
    const other = edl({ sources: [{ id: "camA", url: "https://media.example/other.mp4", kind: "video" }], segments: [{ id: "x", inMs: 0, outMs: 1_000, video: "camA" }] } as Partial<Edl>)
    expect(speakerFramesScope({ edits: [edl(), other] })).toMatchObject({ ok: false, code: "invalid_edl" })
    const long = edl({ segments: [{ id: "l", inMs: 0, outMs: 181 * 60_000, video: "camA" }] } as Partial<Edl>)
    expect(speakerFramesScope({ edits: [long] })).toMatchObject({ ok: false, code: "too_long" })
  })

  it("samples a bare video whole, under its own source id", () => {
    const r = speakerFramesScope({ videoUrl: "https://media.example/v.mp4" })
    expect(r).toEqual({ ok: true, sources: [{ sourceId: SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID, url: "https://media.example/v.mp4", spans: null, keptMs: null, frames: null }] })
    expect(speakerFramesScope({})).toMatchObject({ ok: false, code: "invalid_input" })
    expect(speakerFramesScope({ edits: [edl()], videoUrl: "https://media.example/v.mp4" })).toMatchObject({ ok: false, code: "invalid_input" })
  })
})

describe("speakerFramesSourceRows — the panel's tick list", () => {
  it("lists every sampled video source with its frame count and whether it is ticked", () => {
    const rows = speakerFramesSourceRows([edl()], ["camB"])
    expect(rows.map((r) => [r.sourceId, r.ticked])).toEqual([["camA", true], ["camB", false]])
    expect(rows[0]!.frames).toBe(Math.ceil(66_000 / 500))
    expect(rows[1]!.frames).toBeGreaterThan(0)
  })
  it("is empty for no edit", () => {
    expect(speakerFramesSourceRows([], [])).toEqual([])
  })
})

// A camera unticked under one wiring stays in the node's untick list after the
// edit is rewired without it; the panel lists only the current edit's cameras,
// so it can neither show nor re-tick it. Both engines send only the ids the
// current edit samples; the API route stays strict for a caller's own list.
describe("speakerFramesLiveExclusions — a stale untick never blocks a run", () => {
  it("keeps only the ids the current edits sample, in order", () => {
    const rewired = edl({ sources: edl().sources.filter((s) => s.id !== "camB"), segments: [{ id: "s0", inMs: 0, outMs: 30_000, video: "camA" }] })
    expect(speakerFramesLiveExclusions([rewired], ["camB"])).toEqual([])
    expect(speakerFramesLiveExclusions([edl()], ["camB", "gone", "camA"])).toEqual(["camB", "camA"])
    // Not a video source of the edit either: the master audio is never sampled.
    expect(speakerFramesLiveExclusions([edl()], ["mic"])).toEqual([])
    expect(speakerFramesLiveExclusions([edl()], undefined)).toEqual([])
  })

  it("the narrowed list passes the scope the raw list fails", () => {
    const rewired = edl({ sources: edl().sources.filter((s) => s.id !== "camB"), segments: [{ id: "s0", inMs: 0, outMs: 30_000, video: "camA" }] })
    expect(speakerFramesScope({ edits: [rewired], excludeSourceIds: ["camB"] }).ok).toBe(false)
    expect(speakerFramesScope({ edits: [rewired], excludeSourceIds: speakerFramesLiveExclusions([rewired], ["camB"]) }).ok).toBe(true)
  })
})

describe("applySpeakerTrackAssignments (P3-18 (a))", () => {
  const descriptor: SpeakerTrackSetDescriptor = {
    version: 1,
    sampleFps: 2,
    detector: { id: "yunet" },
    sources: [
      {
        sourceId: "camA",
        clock: "source",
        frame: { w: 960, h: 540 },
        sampledSpans: [{ startMs: 0, endMs: 1_000 }],
        tracks: [
          { id: "camA/t1", speaker: "Host", attribution: { method: "source-map", confidence: 0.9 }, boxCount: 2 },
          { id: "camA/t2", boxCount: 2 },
        ],
      },
    ],
    url: "https://media.example/speaker-tracks/j.json",
    sha256: "a".repeat(64),
    bytes: 100,
  }

  it("relabels by track id as manual, clears a null, and never mutates the input", () => {
    const before = JSON.stringify(descriptor)
    const r = applySpeakerTrackAssignments(descriptor, [
      { trackId: "camA/t2", speaker: "Guest" },
      { trackId: "camA/t1", speaker: null },
    ])
    expect(JSON.stringify(descriptor)).toBe(before)
    expect(r.unmatched).toEqual([])
    const tracks = r.descriptor.sources[0]!.tracks
    expect(tracks[0]).toEqual({ id: "camA/t1", boxCount: 2 })
    expect(tracks[1]).toEqual({ id: "camA/t2", speaker: "Guest", attribution: { method: "manual", confidence: 1 }, boxCount: 2 })
  })

  it("lists the assignments whose track a re-run no longer has, rather than dropping them", () => {
    const r = applySpeakerTrackAssignments(descriptor, [{ trackId: "camA/t9", speaker: "Guest" }])
    expect(r.unmatched).toEqual([{ trackId: "camA/t9", speaker: "Guest" }])
    expect(r.descriptor.sources[0]!.tracks).toEqual(descriptor.sources[0]!.tracks)
  })

  it("passes through with no assignments", () => {
    expect(applySpeakerTrackAssignments(descriptor, undefined)).toEqual({ descriptor, unmatched: [] })
  })
})
