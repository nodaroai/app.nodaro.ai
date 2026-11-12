import { describe, expect, it } from "vitest"
import { mapNemotronResult, nemotronProviderCostUsd, nemotronWordsToCaptions } from "../nemotron-output.js"

// Shapes from four real KIE tasks (2026-11-12): `resultJson.resultObject` and
// the result FILE at its `url`, trimmed to what the mapper reads.
const TWO_SPEAKERS_OBJECT = {
  code: 200,
  usage: 14.72,
  url: "https://tempfile.aiquickdraw.com/js/y1/ce538dba1bdafa2617e6a577.json",
  duration: 14.72,
  expires_at: "2026-11-26T12:35:19Z",
  text: "Thanks for joining, everyone. Sure, the captions are done.",
  status: "succeeded",
}
const TWO_SPEAKERS_FILE = {
  duration: 14.72,
  task: "transcribe",
  text: "Thanks for joining, everyone. Sure, the captions are done.",
  text_with_speakers: "<spk:0> Thanks for joining, everyone. <spk:1> Sure, the captions are done.",
  words: [
    { word: "Thanks", start: 0.0, end: 0.4, speaker: "0" },
    { word: "for", start: 0.4, end: 0.64, speaker: "0" },
    { word: "joining,", start: 0.64, end: 1.28, speaker: "0" },
    { word: "everyone.", start: 1.28, end: 2.0, speaker: "0" },
    { word: "Sure,", start: 4.67, end: 5.1, speaker: "1" },
    { word: "the", start: 5.1, end: 5.2, speaker: "1" },
    { word: "captions", start: 5.2, end: 5.8, speaker: "1" },
    { word: "are", start: 5.8, end: 5.95, speaker: "1" },
    { word: "done.", start: 5.95, end: 6.4, speaker: "1" },
  ],
  diarization: [{ speaker: 0, start: 0.0, end: 2.0 }, { speaker: 1, start: 4.67, end: 6.4 }],
}
const TRANSLATION_OBJECT = {
  code: 200,
  target_language: "en",
  url: "https://tempfile.aiquickdraw.com/js/y1/81df8bd1c00c3994bf42fc46.json",
  duration: 6.43,
  text: "Hello everyone, today we're going to test a new voice for our videos.",
}
const TRANSLATION_FILE = { duration: 6.43, task: "translate", text: "Hello everyone, today we're going to test a new voice for our videos." }

describe("mapNemotronResult", () => {
  it("maps word timings to caption-shaped ms words, each with Scribe's speaker label", () => {
    const out = mapNemotronResult(TWO_SPEAKERS_OBJECT, TWO_SPEAKERS_FILE, { wordTimestamps: true })
    expect(out.text).toBe(TWO_SPEAKERS_FILE.text)
    expect(out.language).toBe("unknown")
    expect(out.words?.[0]).toEqual({ text: "Thanks", startMs: 0, endMs: 400, timestampMs: null, confidence: null, speaker: "speaker_0" })
    // Every word after the first carries the leading-space delimiter the caption overlays rely on.
    expect(out.words?.[1]?.text).toBe(" for")
    expect(out.words?.[4]).toMatchObject({ text: " Sure,", startMs: 4670, endMs: 5100, speaker: "speaker_1" })
    expect(out.json.words).toHaveLength(9)
    expect(out.json.words[8]).toMatchObject({ startMs: 5950, endMs: 6400, speaker: "speaker_1" })
    expect(out.json.language).toBeUndefined()
    expect(out.durationSec).toBe(14.72)
    expect(out.truncated).toBeUndefined()
  })

  it("a plain transcript carries no words, even when the file has them", () => {
    const out = mapNemotronResult(TWO_SPEAKERS_OBJECT, TWO_SPEAKERS_FILE, {})
    expect(out.words).toBeUndefined()
    expect(out.json.words).toEqual([])
    expect(out.text).toBe(TWO_SPEAKERS_FILE.text)
  })

  it("a transcript with no word timings is ONE segment over the whole audio, in the json too (as Whisper's plain lane hands back segments)", () => {
    const out = mapNemotronResult(TWO_SPEAKERS_OBJECT, TWO_SPEAKERS_FILE, {})
    expect(out.segments).toEqual([{ start: 0, end: 14.72, text: TWO_SPEAKERS_FILE.text }])
    expect(out.json.segments).toEqual([{ startMs: 0, endMs: 14720, text: TWO_SPEAKERS_FILE.text }])
    // A word-timed transcript keeps its words and no segment.
    expect(mapNemotronResult(TWO_SPEAKERS_OBJECT, TWO_SPEAKERS_FILE, { wordTimestamps: true }).segments).toBeUndefined()
    // KIE gave no duration: the measured length ends the segment, never 0.
    expect(mapNemotronResult({ text: "Hi." }, { text: "Hi." }, { measuredSec: 42 }).segments).toEqual([{ start: 0, end: 42, text: "Hi." }])
    // Silence: no text, no segment.
    expect(mapNemotronResult({ text: "", duration: 3 }, { text: "", silent: true }, {}).segments).toBeUndefined()
  })

  it("a translation is its text in the target language, with no words", () => {
    const out = mapNemotronResult(TRANSLATION_OBJECT, TRANSLATION_FILE, { targetLanguage: "en" })
    expect(out.text).toBe(TRANSLATION_FILE.text)
    expect(out.language).toBe("en")
    expect(out.json.language).toBe("en")
    expect(out.json.words).toEqual([])
    expect(out.json.segments).toEqual([{ startMs: 0, endMs: 6430, text: TRANSLATION_FILE.text }])
    // Read off the resultObject when the caller did not pass it (the reconcile path never does without input_data).
    expect(mapNemotronResult(TRANSLATION_OBJECT, TRANSLATION_FILE, {}).language).toBe("en")
  })

  it("falls back to the resultObject's text when the file could not be read (plain transcript)", () => {
    const out = mapNemotronResult(TWO_SPEAKERS_OBJECT, undefined, {})
    expect(out.text).toBe(TWO_SPEAKERS_OBJECT.text)
    expect(out.durationSec).toBe(14.72)
  })

  it("fails (to refund) when word timings were asked and speech came back without them", () => {
    expect(() => mapNemotronResult(TWO_SPEAKERS_OBJECT, undefined, { wordTimestamps: true })).toThrow(/word timestamps/)
    expect(() => mapNemotronResult(TWO_SPEAKERS_OBJECT, { ...TWO_SPEAKERS_FILE, words: [] }, { wordTimestamps: true })).toThrow(/no word entries/)
  })

  it("a silent file is no contract break: empty text, no words", () => {
    const out = mapNemotronResult({ text: "", duration: 3 }, { text: "", silent: true }, { wordTimestamps: true })
    expect(out.text).toBe("")
    expect(out.json.words).toEqual([])
  })

  it("keeps KIE's truncated flag on the result, from the file or the resultObject", () => {
    expect(mapNemotronResult(TWO_SPEAKERS_OBJECT, { ...TWO_SPEAKERS_FILE, truncated: true }, {}).truncated).toBe(true)
    expect(mapNemotronResult({ ...TWO_SPEAKERS_OBJECT, truncated: true }, undefined, {}).truncated).toBe(true)
    expect(mapNemotronResult(TWO_SPEAKERS_OBJECT, TWO_SPEAKERS_FILE, {}).truncated).toBeUndefined()
  })

  it("drops a malformed word rather than the transcript", () => {
    const out = mapNemotronResult(TWO_SPEAKERS_OBJECT, { text: "a b", words: [{ word: "a", start: 0, end: 0.2, speaker: "0" }, { word: "b" }, null] }, { wordTimestamps: true })
    expect(out.words).toHaveLength(1)
  })
})

describe("nemotronProviderCostUsd", () => {
  it("is $0.0015 a minute of the decoded audio, billed by the second", () => {
    expect(nemotronProviderCostUsd(60)).toBe(0.0015)
    expect(nemotronProviderCostUsd(3600)).toBe(0.09)
    // 47 s: KIE billed 0.24 KIE credits ($0.0012); 47/60 × 0.0015 = 0.001175.
    expect(nemotronProviderCostUsd(47)).toBe(0.001175)
  })
})

describe("nemotronWordsToCaptions — the join between words", () => {
  const w = (text: string, start: number, end: number) => ({ text, start, end })

  it("Chinese and Japanese (one 'word' per character) join with no space", () => {
    const zh = nemotronWordsToCaptions([w("我", 0, 0.2), w("们", 0.2, 0.4), w("今", 0.4, 0.6), w("天", 0.6, 0.8), w("。", 0.8, 0.9)])
    expect(zh.map((c) => c.text).join("")).toBe("我们今天。")
    const ja = nemotronWordsToCaptions([w("こ", 0, 0.1), w("ん", 0.1, 0.2), w("に", 0.2, 0.3), w("ち", 0.3, 0.4), w("は", 0.4, 0.5)])
    expect(ja.map((c) => c.text).join("")).toBe("こんにちは")
  })

  it("Thai (written without spaces between words) joins with no space", () => {
    const th = nemotronWordsToCaptions([w("สวัสดี", 0, 0.5), w("ครับ", 0.5, 0.8), w("ทุกคน", 0.8, 1.2)])
    expect(th.map((c) => c.text).join("")).toBe("สวัสดีครับทุกคน")
  })

  it("Latin words keep the leading-space delimiter, and a Latin word beside a CJK one joins without it", () => {
    const en = nemotronWordsToCaptions([w("Hello", 0, 0.3), w("there.", 0.3, 0.6)])
    expect(en.map((c) => c.text)).toEqual(["Hello", " there."])
    const mixed = nemotronWordsToCaptions([w("我", 0, 0.2), w("用", 0.2, 0.4), w("iPhone", 0.4, 0.9), w("拍", 0.9, 1.1)])
    expect(mixed.map((c) => c.text).join("")).toBe("我用iPhone拍")
  })

  it("keeps the ms timings and the speaker", () => {
    expect(nemotronWordsToCaptions([{ text: "我", start: 1.25, end: 1.5, speaker: "speaker_1" }])[0]).toEqual({
      text: "我", startMs: 1250, endMs: 1500, timestampMs: null, confidence: null, speaker: "speaker_1",
    })
  })
})
