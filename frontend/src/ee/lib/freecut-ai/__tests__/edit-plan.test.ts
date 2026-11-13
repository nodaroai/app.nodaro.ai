// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  DEFAULT_MUSIC_STYLE,
  captionCues,
  fillerRanges,
  mergeRanges,
  parseModelPlan,
  pauseRanges,
  planFromRequest,
  primaryVideo,
  readTimelineView,
  timelineFrameOf,
  wordsFromTranscript,
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

  it("answers no words for anything else", () => {
    expect(wordsFromTranscript(null)).toEqual([])
    expect(wordsFromTranscript({ text: "hi" })).toEqual([])
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
  it("finds hesitation sounds in several languages, whatever their punctuation", () => {
    const words = [w("So,", 0, 0.3), w("um,", 0.4, 0.7), w("אממ", 1, 1.4), w("えーと", 2, 2.5), w("음", 3, 3.2), w("plan", 4, 4.3)]
    expect(fillerRanges(words).map((r) => r.word)).toEqual(["um,", "אממ", "えーと", "음"])
  })

  it("leaves alone a sound that can be a word of its own", () => {
    const words = [w("Ah,", 0, 0.3), w("あの", 1, 1.3), w("그", 2, 2.2), w("er", 3, 3.2)]
    expect(fillerRanges(words)).toEqual([])
  })
})

describe("planFromRequest with accented words", () => {
  it("finds a filler word written with an accent, and only as a word", () => {
    expect(planFromRequest("tire o hã da fala").steps).toContain("fillers")
    expect(planFromRequest("hãx").steps).not.toContain("fillers")
  })
})

describe("captionCues", () => {
  it("groups a few words per caption, breaking at sentence ends and pauses", () => {
    const words = [w("Here's", 0, 0.3), w("how", 0.3, 0.5), w("I", 0.5, 0.6), w("plan.", 0.6, 1), w("First,", 2, 2.4), w("ideas", 2.4, 2.8)]
    expect(captionCues(words).map((c) => c.text)).toEqual(["Here's how I", "plan.", "First, ideas"])
  })

  it("holds a caption a little past its last word, never into the next", () => {
    const cues = captionCues([w("a", 0, 0.5), w("b.", 0.5, 1), w("c", 1.1, 1.5)])
    expect(cues[0]).toEqual({ text: "a b.", start: 0, end: 1.1 })
    expect(cues[1]).toEqual({ text: "c", start: 1.1, end: 1.75 })
  })

  it("writes Japanese words without spaces between them", () => {
    expect(captionCues([w("今日", 0, 0.3), w("は", 0.3, 0.4)])[0]!.text).toBe("今日は")
  })
})

describe("planFromRequest", () => {
  it("reads the steps a request names, in run order", () => {
    expect(planFromRequest("Add captions and cut the pauses").steps).toEqual(["pauses", "captions"])
    expect(planFromRequest("תחתכו את השתיקות ותוסיפו כתוביות ומוזיקה").steps).toEqual(["pauses", "captions", "music"])
    expect(planFromRequest("無音を詰めて字幕をつけてください").steps).toEqual(["pauses", "captions"])
    expect(planFromRequest("자막과 배경음악을 넣어 주세요").steps).toEqual(["captions", "music"])
    expect(planFromRequest("Corte as pausas e coloque legendas").steps).toEqual(["pauses", "captions"])
  })

  it("takes the standard edit, and says so, when the request names nothing it can do", () => {
    expect(planFromRequest("make it great")).toEqual({
      steps: ["pauses", "captions", "music"],
      musicStyle: DEFAULT_MUSIC_STYLE,
      reply: null,
      understood: false,
    })
  })
})

describe("parseModelPlan", () => {
  it("reads the planner's JSON, even in a code fence, in run order", () => {
    const text = '```json\n{"steps":["music","pauses","teleport"],"musicStyle":"calm piano","reply":"On it."}\n```'
    expect(parseModelPlan(text)).toEqual({ steps: ["pauses", "music"], musicStyle: "calm piano", reply: "On it.", understood: true })
  })

  it("is null for an answer that is not a plan", () => {
    expect(parseModelPlan("Sure! I will cut the pauses.")).toBeNull()
    expect(parseModelPlan('{"steps":["teleport"]}')).toBeNull()
    expect(parseModelPlan("{not json}")).toBeNull()
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

  it("is null for a report that is not a timeline", () => {
    expect(readTimelineView({ fps: 0 })).toBeNull()
  })
})
