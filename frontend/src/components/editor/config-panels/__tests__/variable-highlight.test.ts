import { describe, it, expect } from "vitest"
import { collectVariableRanges } from "../prompt-editor/variable-highlight-extension"

describe("collectVariableRanges", () => {
  const labels = new Set(["Setting"])
  it("returns brace-inclusive offsets with kinds, in document order", () => {
    //        0123456789012345678901234567890123
    const s = "a {Setting} and {Style Guide} end"
    expect(collectVariableRanges(s, labels)).toEqual([
      { from: 2, to: 11, kind: "wired" },
      { from: 16, to: 29, kind: "missing" },
    ])
  })
  it("covers the whole fallback token", () => {
    const s = "{person || man}"
    expect(collectVariableRanges(s, labels)).toEqual([
      { from: 0, to: 15, kind: "missing" },
    ])
  })
  it("skips image-ref tokens and empty braces", () => {
    expect(collectVariableRanges("x {image:1} y {} z", labels)).toEqual([])
  })
  it("classifies reserved vars as reserved", () => {
    expect(collectVariableRanges("{userPrompt}", labels)).toEqual([
      { from: 0, to: 12, kind: "reserved" },
    ])
  })
  it("null labels → suppression: everything non-skip is unknown (rendered cyan)", () => {
    expect(collectVariableRanges("{Nope}", null)).toEqual([
      { from: 0, to: 6, kind: "unknown" },
    ])
  })
  it("trims inner whitespace when classifying but highlights the literal span", () => {
    expect(collectVariableRanges("{ Setting }", labels)).toEqual([
      { from: 0, to: 11, kind: "wired" },
    ])
  })
})
