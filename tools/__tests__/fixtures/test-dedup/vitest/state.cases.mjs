import { expect, test } from "vitest"
import { label, setStrict, unit } from "./state.mjs"

// Runs first and leaves strict mode on. It asserts nothing about the strict branch.
test("turns strict on", () => {
  setStrict(true)
  expect(typeof label(5)).toBe("string")
  expect(unit()).toBe("u")
})

// The candidate. Alone it takes the non-strict branch; in file order the
// strict one, where `>` → `<=` makes it fail — a kill no keeper shares.
test("labels zero", () => {
  expect(["0", "non-pos"]).toContain(label(0))
  expect(unit()).toBe("u")
})
