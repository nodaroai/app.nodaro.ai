import { describe, it, expect } from "vitest"
import { TTS_NEIGHBOUR_TEXT_MAX_CHARS, normalizeTtsNeighbourText } from "../tts-neighbour-text.js"

describe("the neighbour-text rule (shared by the editor and the provider exits)", () => {
  it("the cap is 1,000 characters", () => {
    expect(TTS_NEIGHBOUR_TEXT_MAX_CHARS).toBe(1000)
  })

  it("trims; blank and non-string values are absent", () => {
    expect(normalizeTtsNeighbourText({ previousText: " Before. ", nextText: null })).toEqual({ previousText: "Before." })
    expect(normalizeTtsNeighbourText(undefined)).toEqual({})
  })

  it("over the cap: previous keeps its end, next its start", () => {
    const out = normalizeTtsNeighbourText({ previousText: `${"a".repeat(5)}${"b".repeat(1000)}`, nextText: `${"c".repeat(1000)}${"d".repeat(5)}` })
    expect(out.previousText).toBe("b".repeat(1000))
    expect(out.nextText).toBe("c".repeat(1000))
  })
})
