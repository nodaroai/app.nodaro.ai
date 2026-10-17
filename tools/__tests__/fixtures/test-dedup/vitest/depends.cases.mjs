import { expect, test } from "vitest"
import { twice } from "./math.mjs"

// "needs it" passes only after "prepares" ran: removing "prepares" breaks it.
let ready = false

test("prepares", () => {
  ready = true
  expect(twice(1)).toBe(2)
})

test("needs it", () => {
  expect(ready).toBe(true)
  expect(twice(2)).toBe(4)
})
