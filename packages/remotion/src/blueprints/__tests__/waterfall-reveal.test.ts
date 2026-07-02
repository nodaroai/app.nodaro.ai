import { describe, it, expect } from "vitest"
import { waterfallWordProgress, splitWords } from "../waterfall-reveal"

describe("waterfallWordProgress (per-word stagger, beat=4, slide=6)", () => {
  it("word 0 has not started before frame 0", () => {
    expect(waterfallWordProgress(-1, 0)).toBe(0)
  })
  it("word 0 is fully in after its slide window (frame >= 6)", () => {
    expect(waterfallWordProgress(6, 0)).toBe(1)
  })
  it("word 2 starts at frame 8 (2 * beat) and is 0 there", () => {
    expect(waterfallWordProgress(8, 2)).toBe(0)
  })
  it("word 2 is fully in at frame 14 (8 + 6)", () => {
    expect(waterfallWordProgress(14, 2)).toBe(1)
  })
  it("clamps to [0,1]", () => {
    expect(waterfallWordProgress(100, 0)).toBe(1)
    expect(waterfallWordProgress(-100, 5)).toBe(0)
  })
})

describe("splitWords (cascade word list, degenerate cases)", () => {
  it("splits on whitespace", () => {
    expect(splitWords("the quick brown fox")).toEqual(["the", "quick", "brown", "fox"])
  })
  it("collapses whitespace runs and trims edges", () => {
    expect(splitWords("  a   b\tc\n")).toEqual(["a", "b", "c"])
  })
  it("single word → one-element cascade", () => {
    expect(splitWords("nodaro")).toEqual(["nodaro"])
  })
  it("empty / whitespace-only → no words (renders nothing)", () => {
    expect(splitWords("")).toEqual([])
    expect(splitWords("   ")).toEqual([])
  })
  it("splits an RTL (Hebrew) line into its words", () => {
    expect(splitWords("מהפכת הווידאו של נודארו")).toEqual(["מהפכת", "הווידאו", "של", "נודארו"])
  })
})
