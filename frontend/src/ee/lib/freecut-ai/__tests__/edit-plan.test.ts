// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  captionCues,
  fillerRanges,
  keptRanges,
  mergeRanges,
  pauseRanges,
  primaryVideo,
  readTimelineView,
  timelineFrameOf,
  transcriptLanguage,
  wordsFromTranscript,
  wordsIn,
  type TimedWord,
} from "../edit-plan"

const w = (text: string, start: number, end: number): TimedWord => ({ text, start, end })

describe("wordsFromTranscript", () => {
  it("reads the job's timed words in seconds, in order, without blanks", () => {
    const words = wordsFromTranscript({
      version: 1,
      words: [
        { text: "world", startMs: 600, endMs: 1000 },
        { text: "  ", startMs: 500, endMs: 600 },
        { text: "hello", startMs: 100, endMs: 500 },
      ],
    })
    expect(words).toEqual([w("hello", 0.1, 0.5), w("world", 0.6, 1)])
  })

  it("keeps who said each word, when the transcriber says", () => {
    const words = wordsFromTranscript({ version: 1, words: [{ text: "Hi", startMs: 0, endMs: 300, speaker: "speaker_0" }, { text: "there", startMs: 400, endMs: 700 }] })
    expect(words).toEqual([{ text: "Hi", start: 0, end: 0.3, speaker: "speaker_0" }, w("there", 0.4, 0.7)])
  })

  it("answers no words for anything else", () => {
    expect(wordsFromTranscript(null)).toEqual([])
    expect(wordsFromTranscript({ text: "hi" })).toEqual([])
  })

  it("keeps a word timed with no length, and trims the space the transcriber puts before words", () => {
    // As ElevenLabs answered for the staging test video: " I" said fast, at 9640 ms to 9640 ms.
    const words = wordsFromTranscript({
      version: 1,
      words: [
        { text: " moment", startMs: 9180, endMs: 9480 },
        { text: " I", startMs: 9640, endMs: 9640 },
        { text: " have", startMs: 9680, endMs: 9820 },
      ],
    })
    expect(words).toEqual([w("moment", 9.18, 9.48), w("I", 9.64, 9.64), w("have", 9.68, 9.82)])
  })
})

describe("pauseRanges", () => {
  const words = [w("one", 1.5, 2), w("two", 2.1, 2.5), w("three", 4, 4.4)]

  const rounded = (ranges: ReadonlyArray<{ start: number; end: number }>) =>
    ranges.map((r) => ({ start: Math.round(r.start * 100) / 100, end: Math.round(r.end * 100) / 100 }))

  it("cuts the silence before, between and after the words, keeping a breath", () => {
    expect(rounded(pauseRanges(words, 6))).toEqual([
      { start: 0, end: 1.38 },
      { start: 2.62, end: 3.88 },
      { start: 4.52, end: 6 },
    ])
  })

  it("leaves a short gap alone", () => {
    expect(pauseRanges([w("a", 0, 1), w("b", 1.3, 2)], 2)).toEqual([])
  })

  it("cuts nothing when nobody speaks", () => {
    expect(pauseRanges([], 10)).toEqual([])
  })
})

describe("mergeRanges", () => {
  it("joins overlapping and touching ranges and drops slivers", () => {
    expect(mergeRanges([{ start: 2, end: 3 }, { start: 0, end: 1 }, { start: 2.9, end: 4 }, { start: 5, end: 5.01 }])).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 4 },
    ])
  })
})

describe("fillerRanges", () => {
  const found = (words: TimedWord[], language: string | null) => fillerRanges(words, language).map((r) => r.word)

  it("finds the hesitation sounds of the video's language, whatever their punctuation", () => {
    expect(found([w("So,", 0, 0.3), w("um,", 0.4, 0.7), w("plan", 1, 1.3)], "en")).toEqual(["um,"])
    expect(found([w("אממ", 1, 1.4), w("תוכנית", 2, 2.4)], "he")).toEqual(["אממ"])
    expect(found([w("えーと", 2, 2.5), w("計画", 3, 3.4)], "ja")).toEqual(["えーと"])
    expect(found([w("음", 3, 3.2), w("계획", 4, 4.3)], "ko")).toEqual(["음"])
    expect(found([w("hã,", 3, 3.2), w("plano", 4, 4.3)], "pt")).toEqual(["hã,"])
  })

  it("never cuts a word that is a filler only in another language", () => {
    // Portuguese "um" is the article, German "um" means "at", English "hum" is a sound a fan makes.
    expect(found([w("Um", 0, 0.2), w("dia", 0.25, 0.5), w("comprei", 0.55, 0.9), w("um", 0.95, 1.1), w("carro.", 1.15, 1.6)], "pt")).toEqual([])
    expect(found([w("um", 0, 0.2), w("8", 0.3, 0.5), w("Uhr", 0.6, 0.9)], "de")).toEqual([])
    expect(found([w("the", 0, 0.1), w("hum", 0.2, 0.5)], "en")).toEqual([])
  })

  it("cuts only sounds that are a word in no language when the language is not known", () => {
    expect(found([w("um", 0, 0.2), w("umm", 0.5, 0.8), w("hmm,", 1, 1.3)], null)).toEqual(["umm", "hmm,"])
  })

  it("leaves alone a sound that can be a word of its own", () => {
    const words = [w("Ah,", 0, 0.3), w("あの", 1, 1.3), w("그", 2, 2.2), w("er", 3, 3.2)]
    for (const language of ["en", "he", "ja", "ko", "pt", null]) expect(fillerRanges(words, language)).toEqual([])
  })
})

describe("transcriptLanguage", () => {
  it("reads the transcriber's language as a two-letter code", () => {
    expect(transcriptLanguage({ language: "eng", words: [] })).toBe("en")
    expect(transcriptLanguage({ language: "por" })).toBe("pt")
    expect(transcriptLanguage({ language: "pt-BR" })).toBe("pt")
    expect(transcriptLanguage({ language: "he" })).toBe("he")
  })

  it("is null when the transcript does not say", () => {
    expect(transcriptLanguage({ words: [] })).toBeNull()
    expect(transcriptLanguage({ language: "klingon" })).toBeNull()
    expect(transcriptLanguage(null)).toBeNull()
  })
})

describe("captionCues", () => {
  it("groups a few words per caption, breaking at sentence ends and pauses", () => {
    const words = [w("Here's", 0, 0.3), w("how", 0.3, 0.5), w("I", 0.5, 0.6), w("plan.", 0.6, 1), w("First,", 2, 2.4), w("ideas", 2.4, 2.8)]
    expect(captionCues(words).map((c) => c.text)).toEqual(["Here's how I", "plan.", "First, ideas"])
  })

  it("holds a caption a little past its last word, never into the next", () => {
    const cues = captionCues([w("a", 0, 0.5), w("b.", 0.5, 1), w("c", 1.1, 1.5)])
    expect(cues[0]).toMatchObject({ text: "a b.", start: 0, end: 1.1 })
    expect(cues[1]).toMatchObject({ text: "c", start: 1.1, end: 1.75 })
  })

  it("gives a word timed with no length a caption that still lasts a moment", () => {
    // The editor refuses a caption that ends where it starts, and with it the whole step.
    const cues = captionCues([w("Yes.", 1.7, 1.7), w("Then", 1.7, 2)])
    expect(cues[0]!.text).toBe("Yes.")
    expect(cues[0]!.end).toBeGreaterThan(cues[0]!.start)
  })

  it("writes Japanese words without spaces between them", () => {
    expect(captionCues([w("今日", 0, 0.3), w("は", 0.3, 0.4)])[0]!.text).toBe("今日は")
  })

  it("keeps each caption's own timed words, for the word-by-word highlight", () => {
    const cues = captionCues([w("one", 0, 0.3), w("two", 0.3, 0.6), w("three.", 0.6, 1), w("four", 1.5, 2)])
    expect(cues.map((c) => (c.words ?? []).map((x) => x.text))).toEqual([["one", "two", "three."], ["four"]])
  })
})

describe("wordsIn and keptRanges", () => {
  const words = [w("a", 0.5, 1), w("b", 1.2, 1.6), w("c", 3, 3.4)]

  it("finds the words spoken inside a range of the media", () => {
    expect(wordsIn(words, { start: 1, end: 2 }).map((x) => x.text)).toEqual(["b"])
    expect(wordsIn(words, { start: 0, end: 10 })).toHaveLength(3)
  })

  it("answers what still plays once the cuts are made", () => {
    expect(keptRanges({ start: 0, end: 10 }, [{ start: 2, end: 3 }, { start: 5, end: 6 }])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 10 },
    ])
    expect(keptRanges({ start: 2, end: 4 }, [{ start: 0, end: 3 }, { start: 3.5, end: 9 }])).toEqual([{ start: 3, end: 3.5 }])
    expect(keptRanges({ start: 0, end: 4 }, [])).toEqual([{ start: 0, end: 4 }])
    expect(keptRanges({ start: 0, end: 4 }, [{ start: 0, end: 4 }])).toEqual([])
  })
})

describe("the timeline", () => {
  const timeline = readTimelineView({
    fps: 30,
    durationInFrames: 240,
    items: [
      { id: "a", type: "video", trackId: "v1", from: 0, durationInFrames: 60, mediaId: "m", sourceStart: 0, sourceEnd: 60, sourceFps: 30 },
      { id: "b", type: "video", trackId: "v1", from: 60, durationInFrames: 180, mediaId: "m", sourceStart: 120, sourceEnd: 300, sourceFps: 30 },
      { id: "t", type: "text", trackId: "v2", from: 0, durationInFrames: 30 },
    ],
  })!

  it("finds the opened video", () => {
    expect(primaryVideo(timeline)?.id).toBe("a")
  })

  it("maps a moment of the media to its frame after the cuts", () => {
    expect(timelineFrameOf(timeline, "m", 1)).toEqual({ frame: 30, itemId: "a", trackId: "v1" })
    expect(timelineFrameOf(timeline, "m", 5)).toEqual({ frame: 90, itemId: "b", trackId: "v1" })
    expect(timelineFrameOf(timeline, "m", 3)).toBeNull()
  })

  it("reads the canvas, the tracks, the media and where each picture sits, when the editor says them", () => {
    const view = readTimelineView({
      fps: 30,
      durationInFrames: 30,
      width: 1920,
      height: 1080,
      tracks: [{ id: "music", kind: "audio", order: 2, syncLock: false }],
      media: [{ id: "m", fileName: "take.mp4", duration: 182, width: 1920, height: 1080 }],
      items: [{ id: "a", type: "video", trackId: "v1", from: 0, durationInFrames: 30, label: "take.mp4", transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 } }],
    })!
    expect(view).toMatchObject({ width: 1920, height: 1080, tracks: [{ id: "music", syncLock: false }], media: [{ id: "m", duration: 182 }] })
    expect(view.items[0]).toMatchObject({ label: "take.mp4", transform: { x: 0, width: 1920 } })
  })

  it("is null for a report that is not a timeline", () => {
    expect(readTimelineView({ fps: 0 })).toBeNull()
  })
})
