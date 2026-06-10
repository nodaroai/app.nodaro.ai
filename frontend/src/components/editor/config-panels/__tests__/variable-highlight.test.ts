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

describe("collectVariableRanges — fallback sub-ranges", () => {
  const labels = new Set(["Setting"])
  const values = new Set(["Setting"])

  it("emits sep + trimmed fallback spans, dormant when the label has a value", () => {
    const s = "{Setting || a misty forest}"
    expect(collectVariableRanges(s, labels, values)).toEqual([
      {
        from: 0, to: 27, kind: "wired",
        sep: { from: 9, to: 11 },
        fallback: { from: 12, to: 26, active: false },
      },
    ])
  })

  it("active when the label is unwired (amber token)", () => {
    const s = "{Mood || serene}"
    expect(collectVariableRanges(s, labels, values)).toEqual([
      {
        from: 0, to: 16, kind: "missing",
        sep: { from: 6, to: 8 },
        fallback: { from: 9, to: 15, active: true },
      },
    ])
  })

  it("active when wired but the value is empty (label in resolvable, not in values)", () => {
    const s = "{Style || cinematic}"
    expect(collectVariableRanges(s, new Set(["Style"]), new Set())).toEqual([
      {
        from: 0, to: 20, kind: "wired",
        sep: { from: 7, to: 9 },
        fallback: { from: 10, to: 19, active: true },
      },
    ])
  })

  it("splits on the FIRST || — later || belongs to the default text", () => {
    const s = "{a || b || c}"
    expect(collectVariableRanges(s, labels, values)).toEqual([
      {
        from: 0, to: 13, kind: "missing",
        sep: { from: 3, to: 5 },
        fallback: { from: 6, to: 12, active: true },
      },
    ])
  })

  it("no sub-ranges for an empty default", () => {
    expect(collectVariableRanges("{x || }", labels, values)).toEqual([
      { from: 0, to: 7, kind: "missing" },
    ])
  })

  it("no sub-ranges for reserved tokens (their fallback is never applied)", () => {
    expect(collectVariableRanges("{userPrompt || hi}", labels, values)).toEqual([
      { from: 0, to: 18, kind: "reserved" },
    ])
  })

  it("no sub-ranges when valueLabels is omitted/null (suppression)", () => {
    expect(collectVariableRanges("{Setting || x}", labels)).toEqual([
      { from: 0, to: 14, kind: "wired" },
    ])
  })
})
