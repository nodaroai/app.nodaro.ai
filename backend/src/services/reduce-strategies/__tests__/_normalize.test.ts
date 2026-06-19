import { describe, expect, it } from "vitest"
import { filterSurvivors } from "../_normalize"

describe("filterSurvivors", () => {
  it("removes empty strings", () => {
    expect(filterSurvivors(["a", "", "b", ""])).toEqual(["a", "b"])
  })
  it("removes whitespace-only strings (a failed iteration that emitted blank space is not a survivor)", () => {
    expect(filterSurvivors(["a", " ", "b", "\n\t"])).toEqual(["a", "b"])
  })
  it("returns empty array when all are empty", () => {
    expect(filterSurvivors(["", "", ""])).toEqual([])
  })
  it("returns empty array on empty input", () => {
    expect(filterSurvivors([])).toEqual([])
  })
})
