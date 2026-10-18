import { expect, test } from "vitest"
import { countdown } from "./loop.mjs"

test("counts down to zero", () => {
  expect(countdown(3)).toBe(0)
})

test("zero stays zero", () => {
  expect(countdown(0)).toBe(0)
})
