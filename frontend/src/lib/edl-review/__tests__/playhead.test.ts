import { describe, expect, it } from "vitest"
import { normalizeEdl } from "@nodaro/shared"
import { masterOfPlayback, wordAt, wordClock } from "../playhead"

const WORDS = [
  { startMs: 100, endMs: 400 },
  { startMs: 500, endMs: 800 },
  { startMs: 900, endMs: 1300 },
  { startMs: 4200, endMs: 4600 },
  { startMs: 5100, endMs: 5400 },
]

describe("the word playing at a master instant (follow playback)", () => {
  const clock = wordClock(WORDS, 0)

  it("is the word whose time holds the instant", () => {
    expect(wordAt(clock, 100)).toBe(0)
    expect(wordAt(clock, 650)).toBe(1)
    expect(wordAt(clock, 5399)).toBe(4)
  })

  it("is none between words, before the first and after the last", () => {
    expect(wordAt(clock, 450)).toBe(-1)
    expect(wordAt(clock, 50)).toBe(-1)
    expect(wordAt(clock, 9000)).toBe(-1)
    expect(wordAt(clock, null)).toBe(-1)
  })

  it("puts the transcript on the master clock with its offset", () => {
    expect(wordAt(wordClock(WORDS, 1000), 1650)).toBe(1)
  })

  it("finds words a transcript lists out of time order", () => {
    const shuffled = [WORDS[3]!, WORDS[0]!, WORDS[4]!, WORDS[1]!]
    const c = wordClock(shuffled, 0)
    expect(wordAt(c, 5200)).toBe(2)
    expect(wordAt(c, 600)).toBe(3)
  })
})

describe("the master instant the player is at", () => {
  const map = normalizeEdl({
    version: 1,
    clock: "master",
    sources: [{ id: "cam", url: "u", kind: "video" }],
    segments: [{ id: "a", inMs: 0, outMs: 1000, video: "cam" }, { id: "b", inMs: 2000, outMs: 3000, video: "cam" }],
  })

  it("on a take with a clock map, through the map", () => {
    expect(masterOfPlayback({ kind: "take", map }, 1500)).toBe(2500)
  })

  it("on a take with no map (stale, or behind a switch), unknown", () => {
    expect(masterOfPlayback({ kind: "take", map: null }, 1500)).toBeNull()
  })

  it("on the original, the file's time plus its offset", () => {
    expect(masterOfPlayback({ kind: "original", sourceOffsetMs: 30_000 }, 1500)).toBe(31_500)
  })
})
