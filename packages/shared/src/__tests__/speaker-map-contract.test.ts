import { describe, it, expect } from "vitest"
import { SPEAKER_MAP_DEFAULT_MARGIN_DB, speakerMapByOrdinal, speakerMapResultOf } from "../speaker-map-contract.js"
import { transcriptSpeakerLabels } from "../camera-switch-contract.js"

const transcript = { words: [
  { text: "hi", startMs: 0, endMs: 300, speaker: "speaker_1" },
  { text: "yo", startMs: 400, endMs: 700, speaker: "speaker_0" },
] }

describe("speakerMapResultOf", () => {
  it("reads a result object or its JSON string; anything else is null", () => {
    const r = { version: 1, speakerMap: { speaker_0: "cam-a", speaker_1: "" }, confidence: { speaker_0: { camera: "cam-a", marginDb: 6.2 }, speaker_1: { camera: "", marginDb: 0.8 } }, notes: [] }
    expect(speakerMapResultOf(r)).toEqual(r)
    expect(speakerMapResultOf(JSON.stringify(r))).toEqual(r)
    expect(speakerMapResultOf({ speakerMap: "x" })).toBeNull()
    expect(speakerMapResultOf("not json")).toBeNull()
    expect(speakerMapResultOf({ version: 1, speakerMap: { a: 3 }, confidence: {}, notes: [] })).toBeNull()
  })
  it("every confidence entry and note must be well-typed, so a reader can trust them", () => {
    const base = { version: 1, speakerMap: { s0: "a" }, confidence: { s0: { camera: "a", marginDb: 6.2 } }, notes: ["a note"] }
    expect(speakerMapResultOf(base)).toEqual(base)
    expect(speakerMapResultOf({ ...base, confidence: { s0: { camera: "", marginDb: null } } })).not.toBeNull()
    for (const confidence of [{ s0: 3 }, { s0: null }, { s0: { camera: 1, marginDb: 2 } }, { s0: { marginDb: 2 } }, { s0: { camera: "a", marginDb: "6" } }, { s0: { camera: "a", marginDb: Number.NaN } }, { s0: { camera: "a", marginDb: Number.POSITIVE_INFINITY } }, { s0: { camera: "a" } }]) {
      expect(speakerMapResultOf({ ...base, confidence })).toBeNull()
    }
    for (const notes of [[1], [null], ["ok", { text: "x" }]]) expect(speakerMapResultOf({ ...base, notes })).toBeNull()
  })
  it("the default margin is the spec's 3 dB", () => expect(SPEAKER_MAP_DEFAULT_MARGIN_DB).toBe(3))
})

describe("speakerMapByOrdinal (the override's keys, decided 2026-10-17)", () => {
  it("ordinal 1 is the first voice heard, whatever its label", () => {
    expect(speakerMapByOrdinal(transcriptSpeakerLabels(transcript), { "1": "cam-b", "2": "" })).toEqual({ speaker_1: "cam-b", speaker_0: "" })
  })
  it("an ordinal past the transcript's speakers maps nobody", () => {
    expect(speakerMapByOrdinal(transcriptSpeakerLabels(transcript), { "3": "cam-a" })).toEqual({})
    expect(speakerMapByOrdinal(transcriptSpeakerLabels(transcript), undefined)).toEqual({})
  })
  it("only a plainly written whole number from 1 is an ordinal", () => {
    const labels = transcriptSpeakerLabels(transcript)
    for (const key of [" 1", "1 ", "01", "1.0", "1e0", "0", "-1", "+1", "0x1", "", "one"]) expect(speakerMapByOrdinal(labels, { [key]: "cam-a" })).toEqual({})
    expect(speakerMapByOrdinal(labels, { "2": "cam-a" })).toEqual({ speaker_0: "cam-a" })
  })
  it("an override that is not an object maps nobody (a hand-written workflow)", () => {
    const labels = transcriptSpeakerLabels(transcript)
    for (const bad of ["cam-b", ["cam-a", "cam-b"], null, 3]) expect(speakerMapByOrdinal(labels, bad as never)).toEqual({})
  })
})
