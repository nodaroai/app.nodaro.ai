import { expect, test } from "vitest"
import { IDS, price } from "./ids.mjs"

test("one id, priced by length", () => {
  expect(IDS.length).toBe(1)
  expect(price("b")).toBe(5)
})
