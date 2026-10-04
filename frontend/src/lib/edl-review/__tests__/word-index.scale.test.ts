import { describe, it, expect } from "vitest"
import type { Edl, Transcript } from "@nodaro/shared"
import { buildWordIndex } from "../word-index"

// The word index must stay linear, O(W+S+D): a 3-hour episode is about 30k
// words and 2–3k dropped spans, and the inspector rebuilds the index on every
// edit. These inputs are sized so that a W×D implementation (5·10⁹ steps)
// would blow far past the test timeout, while the sweep takes milliseconds.

const BLOCKS = 25_000
const WORDS_PER_BLOCK = 8
const BLOCK_MS = 2400

describe("buildWordIndex at scale", () => {
  it("indexes 200k words against 25k segments and 25k dropped spans in one sweep", () => {
    const words: Array<{ text: string; startMs: number; endMs: number }> = []
    const segments: Edl["segments"][number][] = []
    const dropped: NonNullable<Edl["dropped"]>[number][] = []
    for (let b = 0; b < BLOCKS; b++) {
      const t0 = b * BLOCK_MS
      for (let j = 0; j < WORDS_PER_BLOCK; j++) words.push({ text: "w", startMs: t0 + j * 300, endMs: t0 + j * 300 + 200 })
      // Words 0–6 are kept; word 7 sits in a filler cut.
      segments.push({ id: `seg-${b}`, inMs: t0, outMs: t0 + 2100, video: "cam" })
      dropped.push({ inMs: t0 + 2100, outMs: t0 + BLOCK_MS, reason: "filler" })
    }
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
      segments,
      dropped,
    }
    const transcript: Transcript = { version: 1, words }

    const { marks, gaps } = buildWordIndex(edl, transcript)
    expect(marks).toHaveLength(BLOCKS * WORDS_PER_BLOCK)
    expect(marks.filter((m) => m.state === "kept")).toHaveLength(BLOCKS * 7)
    expect(marks[7]).toEqual({ state: "cut", reason: "filler", drop: 0 })
    expect(marks[marks.length - 1]).toEqual({ state: "cut", reason: "filler", drop: BLOCKS - 1 })
    expect(gaps).toEqual([])
  })
})
