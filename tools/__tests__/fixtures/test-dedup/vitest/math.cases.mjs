import { expect, test } from "vitest"
import { pick, sum, twice } from "./math.mjs"

test("sums exactly", () => {
  expect(sum(2, 3)).toBe(5)
  expect(pick({ v: [1, 2] })).toEqual([-1, -2])
  expect(twice(3)).toBe(6)
})

test("sums to a number", () => {
  expect(typeof sum(2, 3)).toBe("number")
  expect(Array.isArray(pick({ v: [1] }))).toBe(true)
  expect(twice(3)).toBe(6)
})
