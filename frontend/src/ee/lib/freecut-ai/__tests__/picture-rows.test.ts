import { describe, expect, it } from "vitest"
import { pictureCounts, pictureFileBase, pictureRows, pictureSeconds, type PictureRecord } from "../picture-rows"
import { failureWords, motionOf } from "../run/broll"
import { JobFailed } from "../run/jobs"

const FPS = 30
const video = { id: "v1", type: "video", trackId: "t1", from: 0, durationInFrames: 3000, mediaId: "m-video", sourceStart: 0, sourceEnd: 3000, sourceFps: FPS }
const record = (id: string, start: number, extra: Partial<PictureRecord> = {}): PictureRecord => ({ id, label: id, said: "said", prompt: "shows", start, end: start + 2, mediaId: "m-video", ...extra })

describe("the pictures on the words", () => {
  it("lists the clips the panel laid, in order, each with what the run knows about it", () => {
    const made = pictureFileBase(false, "abc", 1)
    const own = pictureFileBase(true, "abd", 1)
    const view = {
      fps: FPS,
      media: [{ id: "m-video", fileName: "talk.mp4" }, { id: "m-a", fileName: `${made}.png` }, { id: "m-b", fileName: `${own}.jpg` }, { id: "m-c", fileName: "ai-music.mp3" }],
      items: [video, { id: "p2", type: "image", trackId: "t2", from: 900, durationInFrames: 90, mediaId: "m-b" }, { id: "p1", type: "image", trackId: "t2", from: 300, durationInFrames: 72, mediaId: "m-a" }, { id: "a1", type: "audio", trackId: "t3", from: 0, durationInFrames: 3000, mediaId: "m-c" }],
    }
    const rows = pictureRows(view, [record(made, 10.3)])
    expect(rows.map((r) => [r.key, r.source, r.from, r.to, r.record?.id])).toEqual([
      ["p1", "made", 300, 372, made],
      ["p2", "mine", 900, 990, undefined],
    ])
    expect(pictureCounts(rows)).toEqual({ made: 1, mine: 1, none: 0 })
  })

  it("keeps a picture that was not made in the list, where its words are now", () => {
    const view = { fps: FPS, media: [{ id: "m-video", fileName: "talk.mp4" }], items: [video] }
    const rows = pictureRows(view, [record("ai-broll-x-2", 40, { failed: true, reason: "The provider declined this generation." })])
    expect(rows).toHaveLength(1)
    // A moment before its words, for as long as a picture stays on them.
    expect(rows[0]).toMatchObject({ key: "none:ai-broll-x-2", source: "none", from: Math.round(39.7 * FPS), to: Math.round(39.7 * FPS) + Math.round(pictureSeconds(40, 42) * FPS) })
    expect(rows[0]!.itemId).toBeUndefined()
  })

  it("drops a picture that was not made once its words are cut away, and a record whose clip is gone", () => {
    const cut = { ...video, durationInFrames: 600, sourceEnd: 600 }
    const view = { fps: FPS, media: [{ id: "m-video", fileName: "talk.mp4" }], items: [cut] }
    expect(pictureRows(view, [record("ai-broll-x-1", 40, { failed: true }), record("ai-broll-x-2", 5)])).toEqual([])
  })

  it("keeps a picture on its words between 1.6 and 3.2 seconds", () => {
    expect(pictureSeconds(0, 0.4)).toBe(1.6)
    expect(pictureSeconds(0, 2.5)).toBe(2.5)
    expect(pictureSeconds(0, 9)).toBe(3.2)
  })

  it("reads why a picture failed only when the platform said so in a sentence", () => {
    expect(failureWords(new JobFailed("The provider declined this generation because it may depict a real person's likeness."))).toMatch(/real person/)
    expect(failureWords(new JobFailed("404"))).toBeUndefined()
    expect(failureWords(new Error("network down"))).toBeUndefined()
  })

  it("gives every picture a move, whatever its number", () => {
    expect([0, 1, 2, 3, 4, -1].map(motionOf)).toEqual(["push", "pull", "panLeft", "panRight", "push", "panRight"])
  })
})

describe("a picture belongs on its own words", () => {
  const said = "So last year we moved out of the city and I started building the house myself with my brother"
  const words = said.split(" ").map((text, i) => ({ text, start: 30 + i * 0.4, end: 30 + i * 0.4 + 0.3 }))
  const sentence = { index: 3, start: words[0]!.start, end: words.at(-1)!.end, text: said }

  it("finds the quoted words inside a long sentence, not the sentence's first word", async () => {
    const { wordsSpan } = await import("../run/creative")
    const span = wordsSpan(words, sentence, "building the house")
    expect(span.start).toBeCloseTo(30 + 12 * 0.4)
    expect(span.end).toBeCloseTo(30 + 14 * 0.4 + 0.3)
  })

  it("still finds them when the quote is not word for word, and falls back to the sentence", async () => {
    const { wordsSpan } = await import("../run/creative")
    expect(wordsSpan(words, sentence, "Building, a house!").start).toBeCloseTo(30 + 12 * 0.4)
    expect(wordsSpan(words, sentence, "something never said")).toEqual({ start: sentence.start, end: sentence.end })
    expect(wordsSpan(words, sentence, "")).toEqual({ start: sentence.start, end: sentence.end })
  })
})
