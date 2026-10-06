import { describe, it, expect } from "vitest"
import { buildFindIndex, findMatches, foldForFind, matchAtOrAfter, stepMatch } from "../find"

const words = (...texts: string[]) => texts.map((text, i) => ({ text, startMs: i * 100, endMs: i * 100 + 80 }))

/** ⌘F in the inspector (§2.3): case- and diacritic-insensitive, over the words. */
describe("find in the transcript", () => {
  it("folds case and diacritics", () => {
    expect(foldForFind("Café  NAÏVE")).toBe("cafe naive")
    expect(foldForFind("Ürün")).toBe("urun")
  })

  it("finds a word whatever its case and accents", () => {
    const index = buildFindIndex(words("We", "opened", "a", "café", "in", "Paris", "and", "the", "CAFE", "failed"))
    expect(findMatches(index, "cafe")).toEqual([
      { first: 3, last: 3 },
      { first: 8, last: 8 },
    ])
  })

  it("finds a phrase across words, and part of a word", () => {
    const index = buildFindIndex(words("pick", "one", "market", "first.", "Markets", "matter"))
    expect(findMatches(index, "one  market")).toEqual([{ first: 1, last: 2 }])
    expect(findMatches(index, "market")).toEqual([
      { first: 2, last: 2 },
      { first: 4, last: 4 },
    ])
    expect(findMatches(index, "first. mark")).toEqual([{ first: 3, last: 4 }])
  })

  it("an empty query, or one that matches nothing, finds nothing", () => {
    const index = buildFindIndex(words("a", "b"))
    expect(findMatches(index, "   ")).toEqual([])
    expect(findMatches(index, "zebra")).toEqual([])
  })

  it("steps to the next and previous match, wrapping round (n of m)", () => {
    const matches = [{ first: 1, last: 1 }, { first: 5, last: 6 }, { first: 9, last: 9 }]
    expect(stepMatch(matches, 0, 1)).toBe(1)
    expect(stepMatch(matches, 2, 1)).toBe(0)
    expect(stepMatch(matches, 0, -1)).toBe(2)
    expect(stepMatch([], 0, 1)).toBe(-1)
  })

  it("starts from the first match at or after a word (the one in view)", () => {
    const matches = [{ first: 1, last: 1 }, { first: 5, last: 6 }, { first: 9, last: 9 }]
    expect(matchAtOrAfter(matches, 0)).toBe(0)
    expect(matchAtOrAfter(matches, 6)).toBe(1)
    expect(matchAtOrAfter(matches, 7)).toBe(2)
    expect(matchAtOrAfter(matches, 10)).toBe(0)
  })

  it("searches a 3-hour transcript quickly", () => {
    const many = Array.from({ length: 30_000 }, (_, i) => ({ text: i % 997 === 0 ? "Pricing" : `word${i}`, startMs: i, endMs: i + 1 }))
    const index = buildFindIndex(many)
    const start = performance.now()
    const matches = findMatches(index, "pricing")
    expect(performance.now() - start).toBeLessThan(50)
    expect(matches.length).toBe(Math.ceil(30_000 / 997))
  })
})
