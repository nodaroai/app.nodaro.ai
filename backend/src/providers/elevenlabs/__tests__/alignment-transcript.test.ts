/**
 * The ElevenLabs `/with-timestamps` alignment → our `Transcript`. Everything the
 * spec marks [unverified] about the vendor shape is handled by returning
 * `undefined` (the audio is still delivered; only the timings are absent) —
 * never by throwing.
 */
import { describe, it, expect } from "vitest"
import { wordsFromAlignment, transcriptFromSpeechTimestamps, transcriptFromDialogueTimestamps } from "../alignment-transcript.js"

/** Build a character alignment from a string: each character takes 100 ms, starting at `offsetSec`. */
function align(text: string, offsetSec = 0) {
  const characters = [...text]
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => offsetSec + i * 0.1),
    character_end_times_seconds: characters.map((_, i) => offsetSec + (i + 1) * 0.1),
  }
}

describe("wordsFromAlignment", () => {
  it("groups characters into words on whitespace, in ms, with the character span of each word", () => {
    const words = wordsFromAlignment(align("Hi there."))!
    expect(words).toEqual([
      { text: "Hi", startMs: 0, endMs: 200, charStart: 0, charEnd: 2 },
      { text: "there.", startMs: 300, endMs: 900, charStart: 3, charEnd: 9 },
    ])
  })

  it("drops a bracketed [audio tag] token and strips one glued to a word, never emitting it as a word", () => {
    expect(wordsFromAlignment(align("[laughs] Hello [sighs]world"))!.map((w) => w.text)).toEqual(["Hello", "world"])
  })

  it("drops a MULTI-word audio tag whole — its halves never become timed words", () => {
    const words = wordsFromAlignment(align("Well [clears throat] hello [speaking softly]there"))!
    expect(words.map((w) => w.text)).toEqual(["Well", "hello", "there"])
    expect(wordsFromAlignment(align("[excited shout] We did it!"))!.map((w) => w.text)).toEqual(["We", "did", "it!"])
    // The word's span is its own characters, never the tag's.
    const hello = wordsFromAlignment(align("[a b] hi"))![0]!
    expect(hello).toMatchObject({ text: "hi", charStart: 6, charEnd: 8 })
  })

  it("a bracket with no closing partner is ordinary text (nothing is swallowed)", () => {
    expect(wordsFromAlignment(align("a [b c d"))!.map((w) => w.text)).toEqual(["a", "[b", "c", "d"])
  })

  it("treats a newline like a space and skips runs of whitespace", () => {
    expect(wordsFromAlignment(align("one\n\n two"))!.map((w) => w.text)).toEqual(["one", "two"])
  })

  it("is undefined for a shape that is not the documented one", () => {
    expect(wordsFromAlignment(undefined)).toBeUndefined()
    expect(wordsFromAlignment(null)).toBeUndefined()
    expect(wordsFromAlignment({ characters: ["a"] })).toBeUndefined()
    expect(wordsFromAlignment({ characters: ["a", "b"], character_start_times_seconds: [0], character_end_times_seconds: [0.1, 0.2] })).toBeUndefined()
    expect(wordsFromAlignment({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] })).toEqual([])
  })
})

describe("transcriptFromSpeechTimestamps (one voice)", () => {
  it("is a normalized Transcript of words, no segments, with the request's language when given", () => {
    const t = transcriptFromSpeechTimestamps(align("Ship faster."), { language: "en" })!
    expect(t.version).toBe(1)
    expect(t.language).toBe("en")
    expect(t.words).toEqual([
      { text: "Ship", startMs: 0, endMs: 400 },
      { text: "faster.", startMs: 500, endMs: 1200 },
    ])
    expect(t.segments).toBeUndefined()
  })

  it("is undefined when the alignment is unusable", () => {
    expect(transcriptFromSpeechTimestamps({ nope: true })).toBeUndefined()
  })

  it("is undefined — no timings — when the alignment holds no words (empty, or only tags)", () => {
    expect(transcriptFromSpeechTimestamps({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] })).toBeUndefined()
    expect(transcriptFromSpeechTimestamps(align("[laughs] [long pause]"))).toBeUndefined()
  })
})

describe("transcriptFromDialogueTimestamps (lines)", () => {
  const lines = [{ text: "Hi there.", voice: "Rachel" }, { text: "Hello.", voice: "George" }]
  // The two lines as ElevenLabs lays them out: line 1 (9 chars) then line 2 (6 chars), 100 ms per character.
  const alignment = align("Hi there.Hello.")
  const segments = [
    // voice_id deliberately NOT the voice sent (the probe saw this) — mapping is by dialogue_input_index.
    { voice_id: "zzz", start_time_seconds: 0, end_time_seconds: 0.9, character_start_index: 0, character_end_index: 9, dialogue_input_index: 0 },
    { voice_id: "yyy", start_time_seconds: 0.9, end_time_seconds: 1.5, character_start_index: 9, character_end_index: 15, dialogue_input_index: 1 },
  ]

  it("segments are the lines, by dialogue_input_index, speaker = the line's voice as sent; words carry the speaker of their segment", () => {
    const t = transcriptFromDialogueTimestamps(alignment, segments, lines)!
    expect(t.segments).toEqual([
      { startMs: 0, endMs: 900, text: "Hi there.", speaker: "Rachel" },
      { startMs: 900, endMs: 1500, text: "Hello.", speaker: "George" },
    ])
    // A word that straddles two lines (no separator between them) takes the
    // speaker of the segment covering its FIRST character.
    expect(t.words.map((w) => [w.text, w.speaker])).toEqual([["Hi", "Rachel"], ["there.Hello.", "Rachel"]])
  })

  it("segments arrive out of order and are emitted in line order", () => {
    const t = transcriptFromDialogueTimestamps(alignment, [segments[1], segments[0]], lines)!
    expect(t.segments!.map((s) => s.speaker)).toEqual(["Rachel", "George"])
  })

  it("a segment naming a line that does not exist is dropped; the words stay", () => {
    const t = transcriptFromDialogueTimestamps(alignment, [{ ...segments[0], dialogue_input_index: 7 }], lines)!
    expect(t.segments).toBeUndefined()
    expect(t.words.length).toBeGreaterThan(0)
  })

  it("no usable voice_segments → words only (never undefined while the alignment is good)", () => {
    expect(transcriptFromDialogueTimestamps(alignment, undefined, lines)!.segments).toBeUndefined()
    expect(transcriptFromDialogueTimestamps(alignment, "garbage", lines)!.words.length).toBe(2)
  })

  it("an unusable alignment → undefined, whatever the segments say", () => {
    expect(transcriptFromDialogueTimestamps(undefined, segments, lines)).toBeUndefined()
  })
})

describe("transcriptFromDialogueTimestamps (wordless)", () => {
  it("is undefined — no timings — when the alignment holds no words", () => {
    const lines = [{ text: "[laughs]", voice: "Rachel" }]
    expect(transcriptFromDialogueTimestamps(align("[laughs]"), [], lines)).toBeUndefined()
    expect(transcriptFromDialogueTimestamps({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] }, [], lines)).toBeUndefined()
  })
})
