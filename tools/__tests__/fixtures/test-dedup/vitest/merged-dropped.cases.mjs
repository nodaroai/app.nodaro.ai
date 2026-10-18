import { describe, expect, test } from "vitest"
import { sum, twice } from "./math.mjs"

// The same names, the same passes and the same covered lines as merged.cases.mjs
// — but one assertion was lost in the move.
describe("merge-a.cases.mjs", () => {
  describe("a", () => {
    test("doubles", () => {
      expect(twice(2)).toBe(4)
      twice(0)
    })
  })
})

describe("merge-b.cases.mjs", () => {
  test("adds", () => {
    expect(sum(1, 2)).toBe(3)
  })
})
