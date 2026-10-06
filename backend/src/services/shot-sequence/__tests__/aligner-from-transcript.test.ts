import { describe, it, expect } from "vitest"
import { alignmentWordsFromTranscript, alignCues } from "../aligner.js"

describe("alignmentWordsFromTranscript", () => {
  it("maps Transcript words (ms) to AlignmentWord (seconds), the shape alignCues already takes", () => {
    const words = alignmentWordsFromTranscript({ version: 1, words: [{ text: "Ship", startMs: 100, endMs: 400 }, { text: " faster.", startMs: 500, endMs: 1200 }] })
    expect(words).toEqual([{ word: "Ship", start: 0.1, end: 0.4 }, { word: "faster.", start: 0.5, end: 1.2 }])
    // And the cue matcher finds them exactly as it finds forced-alignment words.
    const { spans, warnings } = alignCues([{ id: "c1", text: "Ship faster" }] as never, words)
    expect(warnings).toEqual([])
    expect(spans.c1).toEqual({ startMs: 100, endMs: 1200 })
  })

  it("is empty for a missing transcript, a non-object, or one with no words", () => {
    for (const t of [undefined, null, "x", 3, {}, { words: [] }, { words: "nope" }]) expect(alignmentWordsFromTranscript(t), JSON.stringify(t)).toEqual([])
  })

  it("skips a word without finite timings instead of producing NaN frames", () => {
    expect(alignmentWordsFromTranscript({ words: [{ text: "a", startMs: 0, endMs: 100 }, { text: "b" }, { text: "c", startMs: "x", endMs: 300 }] })).toEqual([{ word: "a", start: 0, end: 0.1 }])
  })
})
