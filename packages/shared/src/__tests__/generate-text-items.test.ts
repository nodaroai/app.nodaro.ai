import { describe, it, expect } from "vitest"
import { splitGeneratedItems, GENERATE_TEXT_DELIMITER } from "../generate-text-items"

describe("splitGeneratedItems", () => {
  it("splits on the delimiter, trims, drops empties", () => {
    expect(splitGeneratedItems(`a${GENERATE_TEXT_DELIMITER}  b  ${GENERATE_TEXT_DELIMITER}c`)).toEqual(["a", "b", "c"])
  })
  it("collapses blank/whitespace-only segments", () => {
    expect(splitGeneratedItems(`  one  ${GENERATE_TEXT_DELIMITER}   ${GENERATE_TEXT_DELIMITER}  two  `)).toEqual(["one", "two"])
  })
  it("no delimiter → single trimmed item", () => {
    expect(splitGeneratedItems("just one block")).toEqual(["just one block"])
  })
  it("empty/undefined → []", () => {
    expect(splitGeneratedItems("")).toEqual([])
    expect(splitGeneratedItems(undefined)).toEqual([])
    expect(splitGeneratedItems("   ")).toEqual([])
  })
})
