import { expect, test } from "vitest"
import { IDS, price } from "./ids.mjs"

// The candidate is "price a": its name comes from the data under test.
for (const id of IDS) {
  test(`price ${id}`, () => {
    expect(price(id)).toBe(5)
  })
}

test("one id, priced by length", () => {
  expect(IDS.length).toBe(1)
  expect(price("b")).toBe(5)
})
