import { describe, it, expect } from "vitest"
import { resolvePrompt, computeNodePrompt, composeNegative } from "../resolve-prompt.js"

// `appendWired` (generate-image / generate-video only): the connected (wired)
// prompt is APPENDED to the typed prompt instead of being a fallback. Every
// other node type keeps the legacy precedence (override > typed > wired).
const NO_REFS = new Map<string, string>()

describe("composeNegative", () => {
  it("joins typed + wired with '. '", () => {
    expect(composeNegative("blurry", "low-res")).toBe("blurry. low-res")
  })
  it("typed alone when no wired; wired alone when no typed", () => {
    expect(composeNegative("blurry", undefined)).toBe("blurry")
    expect(composeNegative(undefined, "low-res")).toBe("low-res")
  })
  it("drops empty / whitespace parts → ''", () => {
    expect(composeNegative("  ", "")).toBe("")
    expect(composeNegative(undefined, undefined)).toBe("")
  })
})

describe("resolvePrompt — appendWired", () => {
  it("appends wired to the typed base, joined '. '", () => {
    expect(resolvePrompt({ typed: ["a cat"], wired: "shot on film", refMap: NO_REFS, appendWired: true }))
      .toBe("a cat. shot on film")
  })

  it("typed only when wired is absent/blank", () => {
    expect(resolvePrompt({ typed: ["a cat"], wired: "  ", refMap: NO_REFS, appendWired: true })).toBe("a cat")
    expect(resolvePrompt({ typed: ["a cat"], refMap: NO_REFS, appendWired: true })).toBe("a cat")
  })

  it("wired only when typed is empty", () => {
    expect(resolvePrompt({ typed: [], wired: "shot on film", refMap: NO_REFS, appendWired: true })).toBe("shot on film")
  })

  it("an override (list fan-out item) fully replaces — wired does NOT append onto it", () => {
    expect(resolvePrompt({ override: "OVR", typed: ["a cat"], wired: "film", refMap: NO_REFS, appendWired: true }))
      .toBe("OVR")
  })

  it("WITHOUT appendWired: legacy precedence is byte-unchanged (typed wins, wired = fallback)", () => {
    expect(resolvePrompt({ typed: ["a cat"], wired: "film", refMap: NO_REFS })).toBe("a cat")
    expect(resolvePrompt({ typed: [], wired: "film", refMap: NO_REFS })).toBe("film")
    expect(resolvePrompt({ override: "OVR", typed: ["a cat"], wired: "film", refMap: NO_REFS })).toBe("OVR")
  })

  it("computeNodePrompt threads appendWired for generate-image; other types unchanged", () => {
    expect(
      computeNodePrompt("generate-image", { prompt: "a cat" }, { wired: "film", refMap: NO_REFS, appendWired: true }),
    ).toBe("a cat. film")
    // video-to-video does NOT pass appendWired → wired stays a fallback
    expect(
      computeNodePrompt("video-to-video", { prompt: "a cat" }, { wired: "film", refMap: NO_REFS }),
    ).toBe("a cat")
  })
})
