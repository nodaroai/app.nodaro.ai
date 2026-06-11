import { describe, it, expect } from "vitest"
import { matchSnippetRanges, type MatchableSnippet } from "../snippet-matching"

const S = (id: string, text: string): MatchableSnippet => ({ id, name: id, text })

describe("matchSnippetRanges", () => {
  it("finds exact substring occurrences with positions", () => {
    const line = "a knight, golden hour light, golden hour light"
    const out = matchSnippetRanges(line, [S("gh", "golden hour light")], [])
    expect(out).toEqual([
      { start: 10, end: 27, snippet: S("gh", "golden hour light") },
      { start: 29, end: 46, snippet: S("gh", "golden hour light") },
    ])
  })
  it("longest text wins on overlap; no overlapping results", () => {
    const long = S("long", "soft window light, gentle shadows")
    const short = S("short", "window light")
    const out = matchSnippetRanges("x soft window light, gentle shadows y", [short, long], [])
    expect(out.map((r) => r.snippet.id)).toEqual(["long"])
  })
  it("skips occupied ranges (mention pills own their spans)", () => {
    const line = "abc identity lock xyz"
    const out = matchSnippetRanges(line, [S("il", "identity lock")], [{ start: 0, end: 21 }])
    expect(out).toEqual([])
  })
  it("first snippet in pool wins when two share identical text (user-over-factory)", () => {
    const a = S("user-one", "same text")
    const b = S("factory-one", "same text")
    expect(matchSnippetRanges("same text", [a, b], [])[0].snippet.id).toBe("user-one")
  })
  it("empty inputs → empty output; case-sensitive exact match only", () => {
    expect(matchSnippetRanges("", [S("a", "x")], [])).toEqual([])
    expect(matchSnippetRanges("Golden Hour", [S("g", "golden hour")], [])).toEqual([])
  })
})
