import { describe, it, expect } from "vitest"
import {
  CAMERA_SWITCH_BOUNDS, CAMERA_SWITCH_DEFAULTS, CAMERA_SWITCH_NAME_MAX, cameraSwitchCameras, cameraSwitchEdlProblem,
  cameraSwitchSettingsPayload, clampCameraSwitchSetting, cleanSpeakerNames, defaultSpeakerMap, transcriptSpeakerLabels,
} from "../camera-switch-contract.js"

// camera-switch (B5, decided 2026-10-03): the shared reads every caller makes.

describe("transcriptSpeakerLabels", () => {
  const t = { version: 1, words: [{ text: "a", startMs: 0, endMs: 1, speaker: "speaker_1" }, { text: "b", startMs: 1, endMs: 2 }, { text: "c", startMs: 2, endMs: 3, speaker: "speaker_0" }, { text: "d", startMs: 3, endMs: 4, speaker: "speaker_1" }] }
  it("distinct labels in order of first appearance, from an object or its JSON string", () => {
    expect(transcriptSpeakerLabels(t)).toEqual(["speaker_1", "speaker_0"])
    expect(transcriptSpeakerLabels(JSON.stringify(t))).toEqual(["speaker_1", "speaker_0"])
  })
  it("none for an undiarized transcript or anything that is not one", () => {
    expect(transcriptSpeakerLabels({ words: [{ text: "a", startMs: 0, endMs: 1 }] })).toEqual([])
    for (const bad of [undefined, null, "nope", 4, { words: "x" }]) expect(transcriptSpeakerLabels(bad)).toEqual([])
  })
  it("reads through normalizeTranscript (decided 2026-10-08), as the Cloud plugin reads it: an untimed word names no speaker, a point word does, and first appearance is in time order", () => {
    const raw = { words: [
      { text: "late", start: 5_000, end: 5_400, speaker: "speaker_2" },
      { text: "point", startMs: 100, endMs: 100, speaker: "speaker_3" },
      { text: "untimed", speaker: "ghost" },
      { text: "inverted", startMs: 700, endMs: 300, speaker: "ghost_2" },
      { text: "early", startMs: 200, endMs: 600, speaker: "speaker_0" },
    ] }
    expect(transcriptSpeakerLabels(raw)).toEqual(["speaker_3", "speaker_0", "speaker_2"])
  })
})

describe("cameraSwitchCameras", () => {
  it("an EDL's video sources in order — never the mic, the wide or the screen", () => {
    const edl = { sources: [
      { id: "mic", kind: "audio", role: "master-audio" }, { id: "camA", kind: "video" }, { id: "wide", kind: "video", role: "wide" },
      { id: "camB", kind: "video", role: "camera" }, { id: "screen", kind: "video", role: "screen" },
    ] }
    expect(cameraSwitchCameras(edl).map((c) => c.id)).toEqual(["camA", "camB"])
    expect(cameraSwitchCameras(JSON.stringify(edl)).map((c) => c.id)).toEqual(["camA", "camB"])
    expect(cameraSwitchCameras(undefined)).toEqual([])
  })
})

describe("defaultSpeakerMap — the table pre-filled by order (decided 2026-10-03)", () => {
  it("speaker 1 → camera 1, speaker 2 → camera 2; past the last camera a speaker stays unmapped", () => {
    expect(defaultSpeakerMap(["s0", "s1", "s2"], ["camA", "camB"])).toEqual({ s0: "camA", s1: "camB" })
  })
  it("keeps what the person set — and an explicit \"\" (no camera of their own) is SENT, so it beats sources[].speakers", () => {
    expect(defaultSpeakerMap(["s0", "s1"], ["camA", "camB"], { s0: "camB" })).toEqual({ s0: "camB", s1: "camB" })
    expect(defaultSpeakerMap(["s0", "s1"], ["camA", "camB"], { s0: "" })).toStrictEqual({ s0: "", s1: "camB" })
  })
})

it("the defaults are the decided ones", () => {
  expect(CAMERA_SWITCH_DEFAULTS).toEqual({ minShotMs: 2_500, leadMs: 200, maxShotMs: 20_000, wideEvery: 0, layoutHints: false })
})

// The Cloud route answers 400 outside these ranges — every caller clamps first
// (review of #1749: the panel accepted a 0 s shortest shot).
describe("settings bounds", () => {
  it("are the route's ranges", () => {
    expect(CAMERA_SWITCH_BOUNDS).toEqual({
      minShotMs: { min: 500, max: 60_000 }, leadMs: { min: 0, max: 5_000 }, maxShotMs: { min: 0, max: 600_000 }, wideEvery: { min: 0, max: 20 },
    })
    expect(CAMERA_SWITCH_NAME_MAX).toBe(80)
  })
  it("clamp into range as whole numbers; unset stays unset", () => {
    expect(clampCameraSwitchSetting("minShotMs", 0)).toBe(500)
    expect(clampCameraSwitchSetting("minShotMs", 2_499.6)).toBe(2_500)
    expect(clampCameraSwitchSetting("leadMs", 9_000)).toBe(5_000)
    expect(clampCameraSwitchSetting("wideEvery", -3)).toBe(0)
    for (const v of [undefined, null, "300", Number.NaN]) expect(clampCameraSwitchSetting("leadMs", v)).toBeUndefined()
  })
  it("names are trimmed, cut to the limit, and empty ones dropped", () => {
    expect(cleanSpeakerNames({ s0: " Dana ", s1: "  ", s2: "x".repeat(100), s3: 4 })).toEqual({ s0: "Dana", s2: "x".repeat(80) })
    expect(cleanSpeakerNames(undefined)).toEqual({})
  })
})

describe("cameraSwitchEdlProblem — the route's 400 invalid_edl, before anything is reserved", () => {
  const edl = { version: 1, clock: "master", sources: [{ id: "camA", kind: "video" }], segments: [{ id: "s", inMs: 0, outMs: 1_000 }] }
  it("accepts one master-clock edit, as an object or its JSON string", () => {
    expect(cameraSwitchEdlProblem(edl)).toBeNull()
    expect(cameraSwitchEdlProblem(JSON.stringify(edl))).toBeNull()
  })
  it("refuses a clip set, a chapters plan, an output-clock edit, no segments, a bad segment", () => {
    expect(cameraSwitchEdlProblem({ clips: [edl] })).toMatch(/clip set/)
    expect(cameraSwitchEdlProblem([edl])).toMatch(/one edit/)
    expect(cameraSwitchEdlProblem({ version: 1, chapters: [] })).toMatch(/needs `sources` and `segments`/)
    expect(cameraSwitchEdlProblem({ ...edl, clock: "output" })).toMatch(/master clock/)
    expect(cameraSwitchEdlProblem({ ...edl, segments: [] })).toMatch(/no segments/)
    expect(cameraSwitchEdlProblem({ ...edl, segments: [{ inMs: 5, outMs: 5 }] })).toMatch(/segment 0/)
    expect(cameraSwitchEdlProblem("{nope")).toMatch(/one edit/)
  })
})

describe("cameraSwitchSettingsPayload — one funnel for both engines", () => {
  const edl = { sources: [{ id: "mic", kind: "audio", role: "master-audio" }, { id: "camA", kind: "video" }, { id: "camB", kind: "video" }], segments: [] }
  const transcript = { words: [{ text: "a", startMs: 0, endMs: 1, speaker: "s0" }, { text: "b", startMs: 1, endMs: 2, speaker: "s1" }] }
  it("pre-fills the table, keeps \"\", cleans names, clamps settings, leaves unset settings out", () => {
    expect(cameraSwitchSettingsPayload({ speakerMap: { s1: "" }, speakerNames: { s0: " Dana " }, minShotMs: 100, leadMs: 300 }, edl, transcript)).toStrictEqual({
      speakerMap: { s0: "camA", s1: "" },
      speakerNames: { s0: "Dana" },
      layoutHints: false,
      minShotMs: 500,
      leadMs: 300,
    })
  })
})
