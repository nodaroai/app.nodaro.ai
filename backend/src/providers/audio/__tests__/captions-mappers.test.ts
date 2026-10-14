import { describe, it, expect } from "vitest"
import {
  fastWhisperWordsToCaptions,
  whisperWordsToCaptions,
  syntheticCaptionsFromText,
  transcribeSegmentsToCaptions,
  transcriptToCaptions,
  CAPTION_LINE_MAX_WORDS,
  CAPTION_LINE_GAP_MS,
} from "../captions-mappers.js"
import { remapTranscriptThroughEdl, type Edl, type Transcript } from "@nodaro/shared/edl"

/** Build a Transcript word tersely. */
const w = (text: string, startMs: number, endMs: number, speaker?: string): Transcript["words"][number] =>
  speaker ? { text, startMs, endMs, speaker } : { text, startMs, endMs }
const transcript = (words: Transcript["words"][number][]): Transcript => ({ version: 1, words })

describe("fastWhisperWordsToCaptions", () => {
  it("maps incredibly-fast-whisper word chunks to Caption[]", () => {
    const out = fastWhisperWordsToCaptions({
      text: "hello world",
      chunks: [
        { text: "hello", timestamp: [0.0, 0.5] },
        { text: " world", timestamp: [0.5, 1.0] },
      ],
    })
    expect(out).toEqual([
      { text: "hello", startMs: 0, endMs: 500, timestampMs: 0, confidence: null },
      { text: " world", startMs: 500, endMs: 1000, timestampMs: 500, confidence: null },
    ])
  })

  it("returns [] when chunks missing", () => {
    expect(fastWhisperWordsToCaptions({ text: "hi", chunks: undefined })).toEqual([])
  })
})

describe("whisperWordsToCaptions", () => {
  it("flattens whisper segments[].words[] into Caption[]", () => {
    const out = whisperWordsToCaptions({
      transcription: "hi there",
      detected_language: "en",
      segments: [
        {
          id: 0,
          start: 0,
          end: 1,
          text: "hi there",
          words: [
            { word: "hi", start: 0.0, end: 0.4, probability: 0.99 },
            { word: " there", start: 0.4, end: 1.0, probability: 0.95 },
          ],
        },
      ],
    })
    expect(out).toEqual([
      { text: "hi", startMs: 0, endMs: 400, timestampMs: 0, confidence: 0.99 },
      { text: " there", startMs: 400, endMs: 1000, timestampMs: 400, confidence: 0.95 },
    ])
  })
})

describe("syntheticCaptionsFromText", () => {
  it("evenly slices a sentence's duration across whitespace-split words", () => {
    const out = syntheticCaptionsFromText("one two three", { startMs: 0, endMs: 3000 })
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ text: "one", startMs: 0, endMs: 1000, confidence: null })
    expect(out[2]).toMatchObject({ text: " three", startMs: 2000, endMs: 3000, confidence: null })
  })
})

describe("transcriptToCaptions — wordLevel:true (one caption per word)", () => {
  it("maps each word to a caption, leading-space per @remotion/captions spec, timestampMs=startMs", () => {
    const out = transcriptToCaptions(
      transcript([w("Hello", 0, 300), w("world", 300, 700)]),
      { wordLevel: true },
    )
    expect(out).toEqual([
      { text: "Hello", startMs: 0, endMs: 300, timestampMs: 0, confidence: null },
      { text: " world", startMs: 300, endMs: 700, timestampMs: 300, confidence: null },
    ])
  })

  it("defaults to word-level when no opts are given, and carries confidence", () => {
    const out = transcriptToCaptions(transcript([{ text: "hi", startMs: 0, endMs: 200, confidence: 0.9 }]))
    expect(out).toEqual([{ text: "hi", startMs: 0, endMs: 200, timestampMs: 0, confidence: 0.9 }])
  })

  it("treats { wordLevel: undefined } (the exact object the worker passes) as word-level", () => {
    // The worker calls transcriptToCaptions(t, { wordLevel: data.wordLevel }),
    // and data.wordLevel is undefined for a node that never set the toggle.
    const words = [w("a", 0, 200), w("b", 200, 400), w("c", 400, 600)]
    const out = transcriptToCaptions(transcript(words), { wordLevel: undefined })
    expect(out).toHaveLength(3) // one caption per word, not a grouped line
  })

  it("preserves a token's own leading space (scribe words already carry one)", () => {
    const out = transcriptToCaptions(transcript([w("hi", 0, 200), w(" there", 200, 400)]), { wordLevel: true })
    expect(out.map((c) => c.text)).toEqual(["hi", " there"])
  })

  it("returns [] for a wordless transcript", () => {
    expect(transcriptToCaptions(transcript([]), { wordLevel: true })).toEqual([])
    expect(transcriptToCaptions(transcript([]), { wordLevel: false })).toEqual([])
  })
})

describe("transcriptToCaptions — wordLevel:false (grouped lines), one break rule at a time", () => {
  it("closes a line on a sentence-ending word", () => {
    const out = transcriptToCaptions(
      transcript([w("Hello", 0, 300), w("world.", 300, 700), w("Next", 750, 1000), w("one", 1000, 1300)]),
      { wordLevel: false },
    )
    expect(out).toEqual([
      { text: "Hello world.", startMs: 0, endMs: 700, timestampMs: 0, confidence: null },
      { text: " Next one", startMs: 750, endMs: 1300, timestampMs: 750, confidence: null },
    ])
  })

  it(`breaks on a gap > ${CAPTION_LINE_GAP_MS}ms`, () => {
    // b→c gap = 1200 - 400 = 800 > 700.
    const out = transcriptToCaptions(
      transcript([w("a", 0, 200), w("b", 200, 400), w("c", 1200, 1400)]),
      { wordLevel: false },
    )
    expect(out.map((c) => c.text)).toEqual(["a b", " c"])
    expect(out[0]).toMatchObject({ startMs: 0, endMs: 400 })
    expect(out[1]).toMatchObject({ startMs: 1200, endMs: 1400 })
  })

  it(`caps a line at ${CAPTION_LINE_MAX_WORDS} words`, () => {
    // 9 contiguous, punctuation-free words → 8 in line one, 1 in line two.
    const words = Array.from({ length: 9 }, (_, i) => w(`w${i}`, i * 100, i * 100 + 100))
    const out = transcriptToCaptions(transcript(words), { wordLevel: false })
    expect(out).toHaveLength(2)
    expect(out[0].text.trim().split(" ")).toHaveLength(CAPTION_LINE_MAX_WORDS)
    expect(out[1].text.trim()).toBe("w8")
  })

  it("breaks on a speaker change", () => {
    const out = transcriptToCaptions(
      transcript([w("a", 0, 200, "S1"), w("b", 200, 400, "S1"), w("c", 400, 600, "S2")]),
      { wordLevel: false },
    )
    expect(out.map((c) => c.text)).toEqual(["a b", " c"])
  })
})

describe("transcriptToCaptions — stable ordering (out-of-order remap input)", () => {
  it("sorts word-level output by startMs so it stays monotonic", () => {
    const out = transcriptToCaptions(
      transcript([w("second", 1000, 1400), w("first", 0, 400), w("third", 1500, 1900)]),
      { wordLevel: true },
    )
    expect(out.map((c) => c.text.trim())).toEqual(["first", "second", "third"])
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startMs).toBeGreaterThanOrEqual(out[i - 1].startMs)
    }
  })

  it("grouped-line spans never invert (endMs >= startMs) when words arrive out of order", () => {
    const out = transcriptToCaptions(transcript([w("b", 500, 700), w("a", 0, 200)]), { wordLevel: false })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe("a b")
    expect(out[0].endMs).toBeGreaterThanOrEqual(out[0].startMs)
    expect(out[0]).toMatchObject({ startMs: 0, endMs: 700 })
  })
})

describe("transcriptToCaptions — alignment through an apply-edl remap (±80ms, D17 crossfade)", () => {
  // A 2-segment cut with a 500ms crossfade INTO segment 1. Output-clock starts
  // (hand-computed, not via remapMsThroughEdl): seg0 → 0, seg1 → 2000 - 500 = 1500.
  const edl: Edl = {
    version: 1,
    clock: "master",
    sources: [{ id: "s1", url: "https://example.com/a.mp4", kind: "video" }],
    segments: [
      { id: "seg0", inMs: 0, outMs: 2000, video: "s1" },
      { id: "seg1", inMs: 5000, outMs: 7000, video: "s1", transition: { type: "crossfade", durationMs: 500 } },
    ],
  }
  // Master-clock words; "gone" lies in the removed [2000,5000) gap.
  const source = transcript([
    w("Hello", 200, 700),
    w("world", 1000, 1500),
    w("gone", 3000, 3500),
    w("again", 5200, 5800),
    w("final", 6500, 6900),
  ])
  // Expected OUTPUT-clock windows, computed by hand:
  //   Hello  seg0: 0 + (200..700)          = [200,700]
  //   world  seg0: 0 + (1000..1500)        = [1000,1500]
  //   gone   removed gap                   → dropped
  //   again  seg1: 1500 + (200..800)       = [1700,2300]
  //   final  seg1: 1500 + (1500..1900)     = [3000,3400]
  const expected = [
    { text: "Hello", startMs: 200, endMs: 700 },
    { text: "world", startMs: 1000, endMs: 1500 },
    { text: "again", startMs: 1700, endMs: 2300 },
    { text: "final", startMs: 3000, endMs: 3400 },
  ]

  it("burns word-level captions aligned to the cut within ±80ms", () => {
    const remapped = remapTranscriptThroughEdl(edl, source)
    const caps = transcriptToCaptions(remapped, { wordLevel: true })
    expect(caps).toHaveLength(expected.length) // "gone" dropped
    caps.forEach((c, i) => {
      expect(c.text.trim()).toBe(expected[i].text)
      expect(Math.abs(c.startMs - expected[i].startMs)).toBeLessThanOrEqual(80)
      expect(Math.abs(c.endMs - expected[i].endMs)).toBeLessThanOrEqual(80)
    })
  })
})

/**
 * PHRASE-level captions — the source for a render that does NOT need word
 * timings (a subtitle). Every transcription lane returns segments, including
 * the ones that can return no words at all, so this is what lets `whisper`
 * caption a subtitle instead of failing the job after it was paid for.
 */
describe("transcribeSegmentsToCaptions", () => {
  it("makes one caption per segment, timed by the segment (seconds → ms)", () => {
    expect(
      transcribeSegmentsToCaptions([
        { start: 0, end: 1.5, text: "one two." },
        { start: 1.5, end: 3.25, text: "three four." },
      ]),
    ).toEqual([
      { text: "one two.", startMs: 0, endMs: 1500, timestampMs: 0, confidence: null },
      { text: " three four.", startMs: 1500, endMs: 3250, timestampMs: 1500, confidence: null },
    ])
  })

  it("applies the @remotion/captions leading-space delimiter from the second line on", () => {
    const caps = transcribeSegmentsToCaptions([
      { start: 0, end: 1, text: "  first  " },
      { start: 1, end: 2, text: "second" },
    ])
    expect(caps.map((c) => c.text)).toEqual(["first", " second"])
  })

  it("sorts by start so a line's span can never invert", () => {
    const caps = transcribeSegmentsToCaptions([
      { start: 2, end: 3, text: "later" },
      { start: 0, end: 1, text: "earlier" },
    ])
    expect(caps.map((c) => c.text)).toEqual(["earlier", " later"])
    expect(caps.every((c) => c.endMs >= c.startMs)).toBe(true)
  })

  it("drops blank and unusable segments", () => {
    expect(
      transcribeSegmentsToCaptions([
        { start: 0, end: 1, text: "   " },
        { start: Number.NaN, end: 1, text: "bad" },
        { start: 0, end: 1, text: "kept" },
      ]),
    ).toEqual([{ text: "kept", startMs: 0, endMs: 1000, timestampMs: 0, confidence: null }])
  })

  it("clamps an end that precedes its start (a line that would never be on screen)", () => {
    const [cap] = transcribeSegmentsToCaptions([{ start: 2, end: 1, text: "backwards" }])
    expect(cap).toMatchObject({ startMs: 2000, endMs: 2000 })
  })

  it("returns nothing for an empty list", () => {
    expect(transcribeSegmentsToCaptions([])).toEqual([])
  })
})
