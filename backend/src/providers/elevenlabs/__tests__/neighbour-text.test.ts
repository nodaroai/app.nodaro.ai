import { describe, it, expect } from "vitest"
import { TTS_NEIGHBOUR_TEXT_MAX_CHARS, normalizeTtsNeighbourText } from "../neighbour-text.js"

describe("normalizeTtsNeighbourText", () => {
  it("keeps a usable pair, trimmed of surrounding whitespace", () => {
    expect(normalizeTtsNeighbourText({ previousText: " Before. ", nextText: "After.\n" })).toEqual({ previousText: "Before.", nextText: "After." })
  })

  it("a missing, non-string, empty or blank value is not a key", () => {
    expect(normalizeTtsNeighbourText(undefined)).toEqual({})
    expect(normalizeTtsNeighbourText({})).toEqual({})
    for (const bad of [["x"], 3, null, true, {}, "", " \t\n", NaN] as unknown[]) {
      expect(normalizeTtsNeighbourText({ previousText: bad, nextText: bad }), JSON.stringify(bad)).toEqual({})
    }
  })

  it("one side usable, the other not", () => {
    expect(normalizeTtsNeighbourText({ previousText: "Before.", nextText: 4 })).toEqual({ previousText: "Before." })
    expect(normalizeTtsNeighbourText({ previousText: "", nextText: "After." })).toEqual({ nextText: "After." })
  })

  it("the cap is 1,000 characters; previous text keeps its LAST 1,000 (what leads into this clip), next text its FIRST 1,000", () => {
    expect(TTS_NEIGHBOUR_TEXT_MAX_CHARS).toBe(1000)
    const prev = "a".repeat(10) + "b".repeat(1000)
    const next = "c".repeat(1000) + "d".repeat(10)
    expect(normalizeTtsNeighbourText({ previousText: prev, nextText: next })).toEqual({ previousText: "b".repeat(1000), nextText: "c".repeat(1000) })
  })

  it("exactly at the cap passes through unchanged", () => {
    const exact = "x".repeat(1000)
    expect(normalizeTtsNeighbourText({ previousText: exact, nextText: exact })).toEqual({ previousText: exact, nextText: exact })
  })

  it("trims before measuring, so padding never counts against the cap", () => {
    const padded = " ".repeat(50) + "y".repeat(1000) + " ".repeat(50)
    expect(normalizeTtsNeighbourText({ previousText: padded })).toEqual({ previousText: "y".repeat(1000) })
  })

  it("never mutates its input and carries no other key", () => {
    const input = { previousText: "P", nextText: "N", stability: 0.4 }
    const frozen = Object.freeze({ ...input })
    expect(normalizeTtsNeighbourText(frozen)).toEqual({ previousText: "P", nextText: "N" })
    expect(frozen).toEqual(input)
  })
})
