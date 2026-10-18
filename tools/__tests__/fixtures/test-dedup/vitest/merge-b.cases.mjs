import { expect, test } from "vitest"
import { sum } from "./math.mjs"

test("adds", () => {
  expect(sum(1, 2)).toBe(3)
})
