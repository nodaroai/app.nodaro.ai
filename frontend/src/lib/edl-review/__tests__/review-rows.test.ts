import { describe, it, expect } from "vitest"
import { normalizeEdl, normalizeTranscript, type Edl } from "@nodaro/shared"
import { buildParagraphs } from "../paragraphs"
import { buildWordIndex } from "../word-index"
import {
  buildCutsOnlyRows,
  buildReviewRows,
  collapsedRunOfWord,
  COLLAPSE_MIN_CUT_MS,
  expandedRuns,
  runSpan,
  rowOfMasterMs,
  rowOfWord,
  type ReviewRow,
  type WordSpan,
} from "../review-rows"

const SOURCES = [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }]
const S = 1000

/** Speaker turns of `n` words each, one word a second, turns 2 s apart. */
function transcriptOf(turns: ReadonlyArray<{ speaker: string; words: number; at: number }>) {
  const words = turns.flatMap((turn) =>
    Array.from({ length: turn.words }, (_, i) => ({ text: `${turn.speaker}${i}`, startMs: turn.at + i * S, endMs: turn.at + i * S + 600, speaker: turn.speaker })),
  )
  return normalizeTranscript({ version: 1, words })
}

function rowsOf(edl: Edl, transcript: ReturnType<typeof transcriptOf>, expanded?: readonly WordSpan[]): ReviewRow[] {
  return buildReviewRows({
    paragraphs: buildParagraphs(transcript),
    wordIndex: buildWordIndex(edl, transcript),
    words: transcript.words,
    offsetMs: 0,
    edited: edl,
    expanded,
  })
}

// Four turns: A (0–10 s), B (12–22 s), A (24–34 s), B (36–46 s).
const turns = [
  { speaker: "A", words: 10, at: 0 },
  { speaker: "B", words: 10, at: 12 * S },
  { speaker: "A", words: 10, at: 24 * S },
  { speaker: "B", words: 10, at: 36 * S },
]
const transcript = transcriptOf(turns)

describe("review rows: paragraphs, gaps and collapsed runs (R11)", () => {
  it("a plan that cuts little lists every paragraph, with its gaps", () => {
    const edl = normalizeEdl({
      version: 1, clock: "master", sources: SOURCES,
      segments: [{ id: "s0", inMs: 0, outMs: 10_500, video: "cam" }, { id: "s1", inMs: 12 * S, outMs: 47 * S, video: "cam" }],
      dropped: [{ inMs: 10_500, outMs: 12 * S, reason: "silence" }],
    })
    const rows = rowsOf(edl, transcript)
    expect(rows.map((r) => r.kind)).toEqual(["paragraph", "paragraph", "paragraph", "paragraph"])
    // The silence holds no word: a gap before the first word of B's turn.
    expect(rows[1]!.kind === "paragraph" && rows[1]!.gaps).toEqual([{ drop: 0, beforeWord: 10 }])
    expect(rows[0]).toMatchObject({ first: 0, end: 10, inMs: 0, speaker: "A" })
  })

  it("two or more consecutive paragraphs whose words are all cut collapse into one row, with the dominant reason", () => {
    const edl = normalizeEdl({
      version: 1, clock: "master", sources: SOURCES,
      segments: [{ id: "s0", inMs: 0, outMs: 11 * S, video: "cam" }, { id: "s1", inMs: 35 * S, outMs: 47 * S, video: "cam" }],
      dropped: [{ inMs: 11 * S, outMs: 35 * S, reason: "tangent" }, { inMs: 22 * S, outMs: 24 * S, reason: "silence" }],
    })
    const rows = rowsOf(edl, transcript)
    expect(rows.map((r) => r.kind)).toEqual(["paragraph", "collapsed", "paragraph"])
    const run = rows[1]!
    expect(run).toMatchObject({ kind: "collapsed", first: 10, end: 30, words: 20, reason: "tangent", inMs: 11 * S, outMs: 35 * S })
    expect(run.kind === "collapsed" && run.cutMs).toBe(24 * S)
  })

  it("expands in place: the run's paragraphs come back, marked as the run's", () => {
    const edl = normalizeEdl({
      version: 1, clock: "master", sources: SOURCES,
      segments: [{ id: "s0", inMs: 0, outMs: 11 * S, video: "cam" }, { id: "s1", inMs: 35 * S, outMs: 47 * S, video: "cam" }],
      dropped: [{ inMs: 11 * S, outMs: 35 * S, reason: "tangent" }],
    })
    const collapsed = rowsOf(edl, transcript)
    const id = collapsed[1]!.kind === "collapsed" ? collapsed[1]!.run : ""
    const span = runSpan(collapsed, id)!
    expect(span).toEqual({ first: 10, end: 30 })
    const rows = rowsOf(edl, transcript, [span])
    expect(rows.map((r) => [r.kind, r.kind === "paragraph" ? r.run : r.run])).toEqual([
      ["paragraph", undefined],
      ["paragraph", id],
      ["paragraph", id],
      ["paragraph", undefined],
    ])
    expect(expandedRuns(rows)).toEqual([{ run: id, first: 10, end: 30 }])
    expect(runSpan(rows, id)).toEqual(span)
  })

  it("a run stays open when its first paragraph is restored and its id moves to the next one", () => {
    // Turns 2–4 cut (A, B, A from 12 s): a run of three paragraphs, words 10–40.
    const four = transcriptOf([...turns, { speaker: "A", words: 10, at: 48 * S }])
    const cut = normalizeEdl({
      version: 1, clock: "master", sources: SOURCES,
      segments: [{ id: "s0", inMs: 0, outMs: 11 * S, video: "cam" }, { id: "s1", inMs: 47 * S, outMs: 59 * S, video: "cam" }],
      dropped: [{ inMs: 11 * S, outMs: 47 * S, reason: "tangent" }],
    })
    const open = rowsOf(cut, four, [{ first: 10, end: 40 }])
    expect(expandedRuns(open)).toEqual([{ run: "run-10", first: 10, end: 40 }])
    // B's turn (12–22 s) restored: the run is now words 20–40, "run-20".
    const restored = normalizeEdl({
      version: 1, clock: "master", sources: SOURCES,
      segments: [{ id: "s0", inMs: 0, outMs: 11 * S, video: "cam" }, { id: "s1", inMs: 12 * S, outMs: 23 * S, video: "cam" }, { id: "s2", inMs: 47 * S, outMs: 59 * S, video: "cam" }],
      dropped: [{ inMs: 11 * S, outMs: 12 * S, reason: "tangent" }, { inMs: 23 * S, outMs: 47 * S, reason: "tangent" }],
    })
    const rows = rowsOf(restored, four, [{ first: 10, end: 40 }])
    expect(rows.some((r) => r.kind === "collapsed")).toBe(false)
    expect(expandedRuns(rows)).toEqual([{ run: "run-20", first: 20, end: 40 }])
  })

  it("one cut paragraph collapses only when its cut span runs a minute or more", () => {
    const short = normalizeEdl({
      version: 1, clock: "master", sources: SOURCES,
      segments: [{ id: "s0", inMs: 0, outMs: 11 * S, video: "cam" }, { id: "s1", inMs: 23 * S, outMs: 47 * S, video: "cam" }],
      dropped: [{ inMs: 11 * S, outMs: 23 * S, reason: "tangent" }],
    })
    expect(rowsOf(short, transcript).map((r) => r.kind)).toEqual(["paragraph", "paragraph", "paragraph", "paragraph"])

    // B's turn, then a long silence: one cut paragraph in a cut span of 70 s.
    const long = transcriptOf([{ speaker: "A", words: 5, at: 0 }, { speaker: "B", words: 5, at: 10 * S }, { speaker: "A", words: 5, at: 90 * S }])
    const edl = normalizeEdl({
      version: 1, clock: "master", sources: SOURCES,
      segments: [{ id: "s0", inMs: 0, outMs: 6 * S, video: "cam" }, { id: "s1", inMs: 76 * S, outMs: 96 * S, video: "cam" }],
      dropped: [{ inMs: 6 * S, outMs: 16 * S, reason: "tangent" }, { inMs: 16 * S, outMs: 76 * S, reason: "silence" }],
    })
    const rows = rowsOf(edl, long)
    expect(rows.map((r) => r.kind)).toEqual(["paragraph", "collapsed", "paragraph"])
    expect(rows[1]).toMatchObject({ words: 5, reason: "silence", cutMs: 70 * S })
    expect(70 * S).toBeGreaterThanOrEqual(COLLAPSE_MIN_CUT_MS)
  })

  it("finds the row of a word and of a master time, and the collapsed run that hides a word", () => {
    const edl = normalizeEdl({
      version: 1, clock: "master", sources: SOURCES,
      segments: [{ id: "s0", inMs: 0, outMs: 11 * S, video: "cam" }, { id: "s1", inMs: 35 * S, outMs: 47 * S, video: "cam" }],
      dropped: [{ inMs: 11 * S, outMs: 35 * S, reason: "tangent" }],
    })
    const rows = rowsOf(edl, transcript)
    expect(rowOfWord(rows, 0)).toBe(0)
    expect(rowOfWord(rows, 25)).toBe(1)
    expect(rowOfWord(rows, 39)).toBe(2)
    expect(rowOfMasterMs(rows, 5 * S)).toBe(0)
    expect(rowOfMasterMs(rows, 20 * S)).toBe(1)
    expect(rowOfMasterMs(rows, 40 * S)).toBe(2)
    expect(collapsedRunOfWord(rows, 25)).toBe(rows[1]!.kind === "collapsed" ? rows[1]!.run : "")
    expect(collapsedRunOfWord(rows, 3)).toBeUndefined()
  })
})

describe("Cuts-only rows (R5 a: no transcript)", () => {
  it("lists the edit's kept segments and dropped spans by time, each cut with its reason and index", () => {
    const edl = normalizeEdl({
      version: 1, clock: "master", sources: SOURCES,
      segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "cam" }, { id: "s1", inMs: 3000, outMs: 4000, video: "cam" }],
      dropped: [{ inMs: 2000, outMs: 3000, reason: "tangent" }, { inMs: 1000, outMs: 2000, reason: "filler" }],
    })
    expect(buildCutsOnlyRows(edl)).toEqual([
      { kind: "kept", inMs: 0, outMs: 1000 },
      { kind: "cut", inMs: 1000, outMs: 2000, reason: "filler", drop: 1 },
      { kind: "cut", inMs: 2000, outMs: 3000, reason: "tangent", drop: 0 },
      { kind: "kept", inMs: 3000, outMs: 4000 },
    ])
  })
})
