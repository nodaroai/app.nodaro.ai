import { describe, it, expect } from "vitest"
import { HopPower, SPEAKER_MAP_HOP_MS, decideSpeakerMap, speakerLevelDb, speakerTurnsOf, unheardCameraNotes } from "../speaker-map-levels.js"

describe("speakerTurnsOf", () => {
  const t = { words: [
    { text: "a", startMs: 0, endMs: 200, speaker: "s0" }, { text: "b", startMs: 250, endMs: 400, speaker: "s0" },
    { text: "c", startMs: 500, endMs: 900, speaker: "s1" }, { text: "d", startMs: 950, endMs: 1000, speaker: "s0" },
  ] }
  it("joins one speaker's consecutive words into turns; a different speaker starts a new one", () => {
    expect(speakerTurnsOf(t)).toEqual([
      { speaker: "s0", startMs: 0, endMs: 400 }, { speaker: "s1", startMs: 500, endMs: 900 }, { speaker: "s0", startMs: 950, endMs: 1000 },
    ])
  })
  it("words with no speaker are skipped", () => {
    expect(speakerTurnsOf({ words: [{ text: "a", startMs: 0, endMs: 10 }] })).toEqual([])
  })
  it("a transcript as its JSON string (what a wire carries) reads the same as the object", () => {
    expect(speakerTurnsOf(JSON.stringify(t))).toEqual(speakerTurnsOf(t))
    expect(speakerTurnsOf("not json")).toEqual([])
  })
  it("a zero-length word is a point turn; one speaker's overlapping words stay one turn ending at the latest end", () => {
    expect(speakerTurnsOf({ words: [{ text: "um", startMs: 100, endMs: 100, speaker: "s0" }] })).toEqual([{ speaker: "s0", startMs: 100, endMs: 100 }])
    expect(speakerTurnsOf({ words: [
      { text: "a", startMs: 0, endMs: 1000, speaker: "s0" }, { text: "b", startMs: 200, endMs: 500, speaker: "s0" },
    ] })).toEqual([{ speaker: "s0", startMs: 0, endMs: 1000 }])
  })
  it("crosstalk: overlapping words of two speakers make a turn each, overlapping", () => {
    expect(speakerTurnsOf({ words: [
      { text: "a", startMs: 0, endMs: 1000, speaker: "s0" }, { text: "b", startMs: 500, endMs: 1500, speaker: "s1" },
    ] })).toEqual([{ speaker: "s0", startMs: 0, endMs: 1000 }, { speaker: "s1", startMs: 500, endMs: 1500 }])
  })
})

describe("HopPower + speakerLevelDb", () => {
  const sr = 8000, hop = (sr * SPEAKER_MAP_HOP_MS) / 1000
  const tone = (amp: number, ms: number) => Float32Array.from({ length: (sr * ms) / 1000 }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / sr))
  it("a source twice as loud reads ~6 dB higher over the same turns", () => {
    const quiet = new HopPower(hop); quiet.push(tone(0.1, 2000))
    const loud = new HopPower(hop); loud.push(tone(0.2, 2000))
    const turns = [{ speaker: "s0", startMs: 0, endMs: 2000 }]
    const d = speakerLevelDb(loud.finish(), turns, 0)! - speakerLevelDb(quiet.finish(), turns, 0)!
    expect(d).toBeCloseTo(6.02, 1)
  })
  it("a turn is moved onto the source's own clock (sourceMs = masterMs − offsetMs) and clipped to what it covers", () => {
    const p = new HopPower(hop); p.push(new Float32Array((sr * 1000) / 1000)); p.push(tone(0.5, 1000)) // silent first second, loud second
    const masterTurn = [{ speaker: "s0", startMs: 1500, endMs: 2500 }]
    // offset +500: master 1500..2500 is source 1000..2000 — all loud
    expect(speakerLevelDb(p.finish(), masterTurn, 500)!).toBeGreaterThan(-10)
    const q = new HopPower(hop); q.push(tone(0.5, 1000))
    expect(speakerLevelDb(q.finish(), [{ speaker: "s0", startMs: 5000, endMs: 6000 }], 0)).toBeNull() // outside the source
  })
  /** Power hops straight from values (one per 10 ms). */
  const hops = (...runs: Array<[value: number, count: number]>) => Float32Array.from(runs.flatMap(([v, n]) => Array.from({ length: n }, () => v)))
  const turn = (startMs: number, endMs: number) => ({ speaker: "s0", startMs, endMs })
  it("a turn partly before the source starts reads only the part the source covers (never diluted by the uncovered part)", () => {
    // The source starts at master 1000 ms (offset +1000); the turn is master 500..1500 → source 0..500.
    const p = hops([0.25, 50], [1, 100])
    expect(speakerLevelDb(p, [turn(500, 1500)], 1000)).toBeCloseTo(10 * Math.log10(0.25), 6)
  })
  it("a zero-length turn on a hop boundary reads nothing; a sub-hop turn across a boundary reads both hops", () => {
    const p = hops([1, 9], [1, 1], [3, 1], [1, 9]) // hop 9 = 1, hop 10 = 3
    expect(speakerLevelDb(p, [turn(100, 100)], 0)).toBeNull()
    expect(speakerLevelDb(p, [turn(95, 105)], 0)).toBeCloseTo(10 * Math.log10(2), 6)
  })
  it("one speaker's overlapping turns count each hop once", () => {
    const p = hops([1, 100], [4, 100])
    // Union 0..2000 ms = hops 0..199: (100·1 + 100·4) / 200 = 2.5 — double-counting 500..1000 would read 2.2.
    expect(speakerLevelDb(p, [turn(0, 1000), turn(500, 2000)], 0)).toBeCloseTo(10 * Math.log10(2.5), 6)
  })
  it("an all-silent source is null, never -Infinity", () => {
    expect(speakerLevelDb(hops([0, 200]), [turn(0, 2000)], 0)).toBeNull()
  })
})

describe("decideSpeakerMap", () => {
  const lv = (rows: Record<string, Record<string, number | null>>) => new Map(Object.entries(rows).map(([s, c]) => [s, new Map(Object.entries(c))]))
  it("the loudest camera wins when it leads the next by the margin", () => {
    const r = decideSpeakerMap({ speakers: ["s0", "s1"], levels: lv({ s0: { a: -20, b: -30 }, s1: { a: -31, b: -19 } }), marginDb: 3 })
    expect(r.speakerMap).toEqual({ s0: "a", s1: "b" })
    expect(r.confidence.s0).toEqual({ camera: "a", marginDb: 10 })
    expect(r.notes).toEqual([])
  })
  it("equal levels (one shared mic): no clear camera, a note per speaker", () => {
    const r = decideSpeakerMap({ speakers: ["s0", "s1"], levels: lv({ s0: { a: -20, b: -20.5 }, s1: { a: -20, b: -20.2 } }), marginDb: 3 })
    expect(r.speakerMap).toEqual({ s0: "", s1: "" })
    expect(r.confidence.s0).toEqual({ camera: "", marginDb: 0.5 })
    expect(r.notes).toHaveLength(2)
    expect(r.notes[0]).toMatch(/s0.*no clear camera.*wide shot/)
  })
  it("a camera with no sound is no candidate; one candidate left is no comparison (decided 2026-10-17)", () => {
    const r = decideSpeakerMap({ speakers: ["s0"], levels: lv({ s0: { a: -20, b: null } }), marginDb: 3 })
    expect(r.speakerMap).toEqual({ s0: "" })
    expect(r.confidence.s0).toEqual({ camera: "", marginDb: null })
  })
  it("a lead exactly at the margin wins; the lead is compared after rounding to 0.1 dB", () => {
    const one = (a: number, b: number) => decideSpeakerMap({ speakers: ["s0"], levels: lv({ s0: { a, b } }), marginDb: 3 })
    expect(one(-20, -23).speakerMap.s0).toBe("a")
    expect(one(-20.1, -23.1).confidence.s0).toEqual({ camera: "a", marginDb: 3 }) // 3.0000000000000018 before rounding
    expect(one(-20, -22.96).confidence.s0).toEqual({ camera: "a", marginDb: 3 }) // 2.96 rounds up to the margin
    expect(one(-20, -22.94).confidence.s0).toEqual({ camera: "", marginDb: 2.9 }) // 2.94 rounds down below it
  })
  it("an exact tie is no camera even at marginDb 0 — never the camera listed first", () => {
    const r = decideSpeakerMap({ speakers: ["s0"], levels: lv({ s0: { a: -20, b: -20 } }), marginDb: 0 })
    expect(r.speakerMap).toEqual({ s0: "" })
    expect(r.confidence.s0).toEqual({ camera: "", marginDb: 0 })
    expect(decideSpeakerMap({ speakers: ["s0"], levels: lv({ s0: { b: -20, a: -20 } }), marginDb: 0 }).speakerMap).toEqual({ s0: "" })
    expect(decideSpeakerMap({ speakers: ["s0"], levels: lv({ s0: { a: -20, b: -20.1 } }), marginDb: 0 }).speakerMap).toEqual({ s0: "a" })
  })
  it("one camera may win several speakers (a two-shot)", () => {
    expect(decideSpeakerMap({ speakers: ["s0", "s1"], levels: lv({ s0: { a: -10, b: -30 }, s1: { a: -12, b: -30 } }), marginDb: 3 }).speakerMap).toEqual({ s0: "a", s1: "a" })
  })
})

describe("unheardCameraNotes", () => {
  const lv = (rows: Record<string, Record<string, number | null>>) => new Map(Object.entries(rows).map(([s, c]) => [s, new Map(Object.entries(c))]))
  const hops = (...p: number[]) => Float32Array.from(p)
  it("a camera that heard no speaker is named: silent throughout, or through every turn", () => {
    const notes = unheardCameraNotes(
      new Map([["a", hops(0.1, 0.2)], ["quiet", hops(0, 0, 0)], ["late", hops(0.3, 0.3)]]),
      lv({ s0: { a: -20, quiet: null, late: null }, s1: { a: -25, quiet: null, late: null } }),
    )
    expect(notes).toEqual([
      '"quiet": its sound is silent, so it cannot be matched to a speaker by sound.',
      '"late": heard none of the speakers\' turns (silent through them, or its offset misses them), so it cannot be matched to a speaker by sound.',
    ])
  })
  it("a camera that heard at least one speaker is not named; nor is one never read (no hops)", () => {
    expect(unheardCameraNotes(new Map([["a", hops(0.1)], ["b", hops(0.1)]]), lv({ s0: { a: -20, b: null }, s1: { a: null, b: -22 } }))).toEqual([])
    expect(unheardCameraNotes(new Map(), lv({ s0: { a: null } }))).toEqual([])
  })
})
