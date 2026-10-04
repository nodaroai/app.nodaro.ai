import { describe, it, expect } from "vitest"
import { parseWordList } from "../import-words-dialog"

describe("parseWordList", () => {
  it("reads a JSON list, trimmed and without repeats", () => {
    expect(parseWordList(' ["a", " b ", "a", 3, ""] ')).toEqual(["a", "b"])
  })

  it("reads a JSON object with a words list", () => {
    expect(parseWordList('{"words": ["a", "b c"]}')).toEqual(["a", "b c"])
  })

  it("reads plain text, one per line or comma separated", () => {
    expect(parseWordList("a\nb c, d\n\n a ")).toEqual(["a", "b c", "d"])
  })

  it("is empty for nothing", () => {
    expect(parseWordList("   ")).toEqual([])
  })
})
