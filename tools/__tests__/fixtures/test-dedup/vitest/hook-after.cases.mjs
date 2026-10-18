import { afterAll, expect, test } from "vitest"
import { f, g } from "./hooks.mjs"

afterAll(() => {
  expect(f(2)).toBe("big")
})

test("g multiplies", () => {
  expect(g(2, 3)).toBe(6)
})
