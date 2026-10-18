import { describe, expect, test } from "vitest"
import { twice } from "./math.mjs"

describe("a", () => {
  test("doubles", () => {
    expect(twice(2)).toBe(4)
    expect(twice(0)).toBe(0)
  })
})
