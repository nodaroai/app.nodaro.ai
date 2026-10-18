import { expect, test } from "vitest"
import { g } from "./hooks.mjs"

test("g multiplies too", () => {
  expect(g(2, 3)).toBe(6)
})
