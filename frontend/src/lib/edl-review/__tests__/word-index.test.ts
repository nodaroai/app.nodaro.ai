import { describe, it, expect } from "vitest"
import { normalizeEdl, normalizeTranscript, type Edl, type Transcript } from "@nodaro/shared"
import { buildEdited } from "../build-edited"
import { cutRange, keptSetOf } from "../kept-set"
import { buildWordIndex, transcriptOffsetMs } from "../word-index"

const edlOf = (segments: Array<[number, number]>, dropped: Array<[number, number, string]> = [], extra: Record<string, unknown> = {}): Edl =>
  normalizeEdl({
    version: 1,
    clock: "master",
    sources: [
      { id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" },
      { id: "late", url: "https://cdn.test/late.mp4", kind: "video", offsetMs: 1000 },
    ],
    segments: segments.map(([inMs, outMs], i) => ({ id: `seg-${i}`, inMs, outMs, video: "cam" })),
    dropped: dropped.map(([inMs, outMs, reason]) => ({ inMs, outMs, reason })),
    ...extra,
  })

const transcriptOf = (words: Array<[string, number, number]>, sourceId?: string) =>
  normalizeTranscript({ version: 1, ...(sourceId ? { sourceId } : {}), words: words.map(([text, startMs, endMs]) => ({ text, startMs, endMs })) })

describe("buildWordIndex: each word kept or cut, and why", () => {
  // kept 0–1000 | filler 1000–1300 | kept 1300–2000 | tangent 2000–5000 (a silence 3000–3400 inside) | kept 5000–6000
  const edl = edlOf(
    [[0, 1000], [1300, 2000], [5000, 6000]],
    [[1000, 1300, "filler"], [2000, 5000, "tangent"], [3000, 3400, "silence"]],
  )

  it("a word inside kept time is kept; a word inside a dropped span is cut with that span's reason", () => {
    const { marks } = buildWordIndex(edl, transcriptOf([["So", 100, 300], ["um", 1050, 1250], ["right", 1400, 1600]]))
    expect(marks).toEqual([{ state: "kept" }, { state: "cut", reason: "filler", drop: 0 }, { state: "kept" }])
  })

  it("a word that straddles a cut is partial, named by the span that removes most of it", () => {
    const { marks } = buildWordIndex(edl, transcriptOf([["killed", 900, 1100], ["us", 1250, 1450]]))
    expect(marks).toEqual([{ state: "partial", reason: "filler", drop: 0 }, { state: "partial", reason: "filler", drop: 0 }])
  })

  it("inside two overlapping spans, the word takes the longer (outer) one: restoring it restores the word", () => {
    const { marks } = buildWordIndex(edl, transcriptOf([["uh", 3100, 3300], ["story", 2500, 2900]]))
    expect(marks).toEqual([{ state: "cut", reason: "tangent", drop: 1 }, { state: "cut", reason: "tangent", drop: 1 }])
  })

  it("across two abutting reasons, the one covering more of the word names it", () => {
    const abut = edlOf([[0, 1000]], [[1000, 1200, "silence"], [1200, 2000, "filler"]])
    const { marks } = buildWordIndex(abut, transcriptOf([["uhh", 1150, 1600]]))
    expect(marks).toEqual([{ state: "cut", reason: "filler", drop: 1 }])
  })

  it("a word in time the plan neither keeps nor drops is cut with no reason", () => {
    const { marks } = buildWordIndex(edl, transcriptOf([["outro", 6100, 6400]]))
    expect(marks).toEqual([{ state: "cut" }])
  })

  it("a word with no length is kept when its instant is kept", () => {
    const { marks } = buildWordIndex(edl, transcriptOf([["[laugh]", 999, 999], ["[cough]", 1000, 1000]]))
    expect(marks).toEqual([{ state: "kept" }, { state: "cut", reason: "filler", drop: 0 }])
  })

  it("applies the transcript source's offset (master = source + offset)", () => {
    expect(transcriptOffsetMs(edl, transcriptOf([], "late"))).toBe(1000)
    expect(transcriptOffsetMs(edl, transcriptOf([]))).toBe(0)
    const { marks } = buildWordIndex(edl, transcriptOf([["um", 50, 250]], "late"))
    expect(marks).toEqual([{ state: "cut", reason: "filler", drop: 0 }])
  })

  it("a manual cut listed after a later plan span, as buildEdited lists it, still names the word it cut", () => {
    // kept 0–1000 | filler 1000–1300 | kept 1300–3000 | tangent 3000–6000 | kept 6000–7000; the reviewer cuts "the"
    const plan = edlOf([[0, 1000], [1300, 3000], [6000, 7000]], [[1000, 1300, "filler"], [3000, 6000, "tangent"]])
    const transcript = transcriptOf([["um", 1050, 1250], ["the", 1400, 1600], ["story", 4000, 4400]])
    const edited = buildEdited(plan, cutRange(keptSetOf(plan), { inMs: 1400, outMs: 1600 }, transcript.words))
    // The reviewer's cut comes after the plan's spans, so the list is out of time order.
    expect(edited.dropped?.map((d) => [d.inMs, d.outMs, d.reason])).toEqual([
      [1000, 1300, "filler"],
      [3000, 6000, "tangent"],
      [1400, 1600, "manual"],
    ])
    expect(buildWordIndex(edited, transcript)).toEqual({
      marks: [
        { state: "cut", reason: "filler", drop: 0 },
        { state: "cut", reason: "manual", drop: 2 },
        { state: "cut", reason: "tangent", drop: 1 },
      ],
      gaps: [],
    })
  })

  it("words out of time order get the same marks as in order", () => {
    const words: Array<[string, number, number]> = [["a", 100, 300], ["b", 1050, 1250], ["c", 2500, 2900], ["d", 900, 1100]]
    // Built as a literal: normalizeTranscript sorts words by time (decided
    // 2026-10-08), so only a hand-built Transcript can hand buildWordIndex
    // words out of order.
    const unsorted: Transcript = { version: 1, words: words.map(([text, startMs, endMs]) => ({ text, startMs, endMs })) }
    const shuffled = buildWordIndex(edl, unsorted).marks
    expect(shuffled).toEqual(words.map((w) => buildWordIndex(edl, transcriptOf([w])).marks[0]))
  })

  it("never mutates its inputs", () => {
    // A literal, not transcriptOf: normalizeTranscript sorts words by time,
    // and this transcript must reach buildWordIndex out of order so an
    // in-place sort of its words would show up here.
    const t: Transcript = { version: 1, words: [{ text: "b", startMs: 1050, endMs: 1250 }, { text: "a", startMs: 100, endMs: 300 }] }
    const frozen = JSON.stringify([edl, t])
    buildWordIndex(edl, t)
    expect(JSON.stringify([edl, t])).toBe(frozen)
  })
})

describe("buildWordIndex: dropped spans that hold no whole word", () => {
  it("a silence between words becomes a gap placed before the next word, by time", () => {
    const edl = edlOf([[0, 1000], [3400, 5000]], [[1000, 3400, "silence"]])
    const { marks, gaps } = buildWordIndex(edl, transcriptOf([["to", 600, 1000], ["pick", 3400, 3700]]))
    expect(marks).toEqual([{ state: "kept" }, { state: "kept" }])
    expect(gaps).toEqual([{ drop: 0, beforeWord: 1 }])
  })

  it("a silence that only clips the edge of a word is still a gap (it holds no whole word)", () => {
    const edl = edlOf([[0, 1000], [3300, 5000]], [[1000, 3300, "silence"]])
    const { marks, gaps } = buildWordIndex(edl, transcriptOf([["to", 600, 1000], ["pick", 3200, 3700]]))
    expect(marks[1]).toEqual({ state: "partial", reason: "silence", drop: 0 })
    expect(gaps).toEqual([{ drop: 0, beforeWord: 1 }])
  })

  it("a span that holds a word is shown by the word, not as a gap; a gap after the last word sits at the end", () => {
    const edl = edlOf([[0, 1000]], [[1000, 1300, "filler"], [2000, 2600, "silence"]])
    const { gaps } = buildWordIndex(edl, transcriptOf([["So", 100, 300], ["um", 1050, 1250]]))
    expect(gaps).toEqual([{ drop: 1, beforeWord: 2 }])
  })

  it("on a transcript with a source offset, a gap is placed by master time", () => {
    // "late" starts 1000 ms into the master clock: "so" is at 1500–1900 there and "then" at 2600–2900,
    // so the silence (2000–2500) sits before "then", though both words start before 2000 on their own clock.
    const edl = edlOf([[0, 2000], [2500, 5000]], [[2000, 2500, "silence"]])
    const { marks, gaps } = buildWordIndex(edl, transcriptOf([["so", 500, 900], ["then", 1600, 1900]], "late"))
    expect(marks).toEqual([{ state: "kept" }, { state: "kept" }])
    expect(gaps).toEqual([{ drop: 0, beforeWord: 1 }])
  })

  it("with no words at all, every dropped span is a gap", () => {
    const edl = edlOf([[0, 1000]], [[1000, 1300, "filler"]])
    expect(buildWordIndex(edl, transcriptOf([]))).toEqual({ marks: [], gaps: [{ drop: 0, beforeWord: 0 }] })
  })
})
