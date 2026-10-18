import { expect, test } from "vitest"
import { CASES } from "./each.mjs"

test("two cases, the second is 1", () => {
  expect(CASES.length).toBe(2)
  expect(CASES[1]).toBe(1)
})
