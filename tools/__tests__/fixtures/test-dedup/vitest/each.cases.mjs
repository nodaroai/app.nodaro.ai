import { expect, test } from "vitest"
import { CASES } from "./each.mjs"

// The candidate is "n=0": each row must sit at its own index.
test.each(CASES.map((n, i) => [n, i]))("n=%i", (n, i) => {
  expect(n).toBe(i)
})

test("two cases, the second is 1", () => {
  expect(CASES.length).toBe(2)
  expect(CASES[1]).toBe(1)
})
