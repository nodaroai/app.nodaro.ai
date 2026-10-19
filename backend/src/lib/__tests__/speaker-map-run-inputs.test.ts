// The run rules both engines apply to a Speaker Map node before anything is
// reserved (@nodaro/render-rules): the server's payload.ts calls them, and the
// editor's run calls the same function, so a run is refused, ordered and
// normalized alike wherever it starts.
import { describe, it, expect } from "vitest"
import { SPEAKER_MAP_MAX_MARGIN_DB, isAudioSyncResult, speakerMapMarginDb, speakerMapRunInputs, speakerMapRunProblemText, type SpeakerMapRunProblem } from "@nodaro/render-rules"

const row = (id: string, kind: "video" | "audio" = "video") => ({ id, url: `https://media.test/${id}`, kind })
const TRANSCRIPT = { words: [{ text: "hi", startMs: 0, endMs: 500, speaker: "A" }, { text: "yo", startMs: 600, endMs: 900, speaker: "B" }] }
const SYNC = { version: 1, reference: "a", offsets: [{ sourceId: "a", offsetMs: 0 }] }
const lanes = (over: Record<string, unknown> = {}) => ({ sources: [row("a"), row("b")], transcript: JSON.stringify(TRANSCRIPT), ...over }) as Parameters<typeof speakerMapRunInputs>[0]
const problemOf = (r: ReturnType<typeof speakerMapRunInputs>) => ("problem" in r ? r.problem : undefined)

describe("speakerMapRunInputs", () => {
  it("the body: ordered sources, the parsed transcript and offsets, the wired master and wide, the lead", () => {
    const r = speakerMapRunInputs(lanes({ sources: [row("a"), row("b"), row("m", "audio")], offsets: JSON.stringify(SYNC) }), { sourceOrder: ["m", "b"], masterSourceId: "m", wideSourceId: "a", marginDb: 5 })
    expect(r).toEqual({ body: { sources: [row("m", "audio"), row("b"), row("a")], transcript: TRANSCRIPT, offsets: SYNC, masterSourceId: "m", wideSourceId: "a", marginDb: 5 } })
  })

  it("no offsets wired: no offsets key; a master / wide no longer wired is dropped; the lead defaults to 3", () => {
    const r = speakerMapRunInputs(lanes(), { masterSourceId: "gone", wideSourceId: "gone" })
    expect(r).toEqual({ body: { sources: [row("a"), row("b")], transcript: TRANSCRIPT, marginDb: 3 } })
  })

  it.each<[string, Parameters<typeof speakerMapRunInputs>[0], Record<string, unknown>, SpeakerMapRunProblem]>([
    ["a List wired as a whole", lanes({ sources: [{ id: "list", url: "https://m.test/a, https://m.test/b", kind: "video" }] }), {}, { code: "joined-sources", sourceId: "list" }],
    ["one recording", lanes({ sources: [row("a")] }), {}, { code: "too-few-sources", count: 1 }],
    ["nothing wired", undefined, {}, { code: "too-few-sources", count: 0 }],
    ["wires that carried nothing", lanes({ sources: [] }), {}, { code: "too-few-sources", count: 0 }],
    ["seven recordings", lanes({ sources: ["a", "b", "c", "d", "e", "f", "g"].map((id) => row(id)) }), {}, { code: "too-many-sources", count: 7 }],
    ["no transcript wired", { sources: [row("a"), row("b")] }, {}, { code: "no-transcript" }],
    ["a transcript wire that produced nothing", lanes({ transcript: "" }), {}, { code: "empty-transcript" }],
    ["a transcript with no speaker labels", lanes({ transcript: JSON.stringify({ text: "hi" }) }), {}, { code: "no-speakers" }],
    ["an offsets wire that produced nothing", lanes({ offsets: "" }), {}, { code: "empty-offsets" }],
    ["offsets that are not an Audio Sync result", lanes({ offsets: JSON.stringify({ text: "x" }) }), {}, { code: "not-audio-sync" }],
    ["a sound-only wide shot", lanes({ sources: [row("a"), row("m", "audio")] }), { wideSourceId: "m" }, { code: "wide-sound-only", sourceId: "m" }],
    ["master and wide on one recording", lanes(), { masterSourceId: "a", wideSourceId: "a" }, { code: "wide-is-master", sourceId: "a" }],
  ])("%s → refused", (_name, unitInputs, data, problem) => {
    expect(problemOf(speakerMapRunInputs(unitInputs, data))).toEqual(problem)
  })

  it("each source is checked by the caller's own fetch rule, after the count; with none, every URL passes", () => {
    const inputs = lanes({ sources: [row("a"), { id: "lan", url: "http://127.0.0.1/x", kind: "video" }] })
    expect(problemOf(speakerMapRunInputs(inputs, {}, { fetchable: (u) => u.startsWith("https://") }))).toEqual({ code: "unfetchable-source", sourceId: "lan" })
    expect(problemOf(speakerMapRunInputs(inputs, {}))).toBeUndefined()
  })

  it("never mutates its inputs", () => {
    const inputs = lanes()
    const data = { sourceOrder: ["b"] }
    const before = JSON.stringify([inputs, data])
    speakerMapRunInputs(inputs, data)
    expect(JSON.stringify([inputs, data])).toBe(before)
  })
})

describe("the lead and the offsets shape (the route's bounds too)", () => {
  it("speakerMapMarginDb: a finite number clamped to 0–30, else 3", () => {
    expect(SPEAKER_MAP_MAX_MARGIN_DB).toBe(30)
    expect([6, -2, 99, Number.NaN, Number.POSITIVE_INFINITY, "6", undefined].map(speakerMapMarginDb)).toEqual([6, 0, 30, 3, 3, 3, 3])
  })
  it("isAudioSyncResult: an object (or its JSON) with an offsets list", () => {
    expect([SYNC, JSON.stringify(SYNC), { offsets: [] }].map(isAudioSyncResult)).toEqual([true, true, true])
    expect([{ text: "x" }, [], "not json", null, { offsets: "a" }].map(isAudioSyncResult)).toEqual([false, false, false, false, false])
  })
})

describe("speakerMapRunProblemText", () => {
  it("words a problem for the node type and label the caller passes", () => {
    const who = { type: "unit-x", label: "My Map" }
    expect(speakerMapRunProblemText({ code: "too-few-sources", count: 1 }, who)).toBe('unit-x: node "My Map" needs at least 2 recordings — connect them to the Cameras input')
    expect(speakerMapRunProblemText({ code: "no-speakers" }, who)).toBe("unit-x: the transcript has no speaker labels — turn on speaker detection in Transcribe.")
  })
})
