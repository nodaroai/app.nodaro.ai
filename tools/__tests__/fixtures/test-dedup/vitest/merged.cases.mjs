import { describe, expect, test } from "vitest"
import { sum, twice } from "./math.mjs"

describe("merge-a.cases.mjs", () => {
  describe("a", () => {
    test("doubles", () => {
      expect(twice(2)).toBe(4)
      expect(twice(0)).toBe(0)
    })
  })
})

describe("merge-b.cases.mjs", () => {
  test("adds", () => {
    expect(sum(1, 2)).toBe(3)
  })
})
