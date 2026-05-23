import { describe, expect, it } from "vitest"
import { filterSurvivors } from "../_normalize"

describe("filterSurvivors", () => {
  it("removes empty strings only", () => {
    expect(filterSurvivors(["a", "", "b", ""])).toEqual(["a", "b"])
  })
  it("preserves whitespace-only strings (they may be intentional)", () => {
    expect(filterSurvivors(["a", " ", "b"])).toEqual(["a", " ", "b"])
  })
  it("returns empty array when all are empty", () => {
    expect(filterSurvivors(["", "", ""])).toEqual([])
  })
  it("returns empty array on empty input", () => {
    expect(filterSurvivors([])).toEqual([])
  })
})
