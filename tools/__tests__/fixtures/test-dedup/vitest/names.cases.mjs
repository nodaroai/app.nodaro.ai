import { expect, test } from "vitest"
import { add, list } from "./names.mjs"

// The candidate. Under `>` → `<=` it pushes "", and only then does the sibling
// below fail: run alone, the sibling passes that mutant.
test("rejects empty", () => {
  add("")
  expect(list()).toEqual([])
})

test("only non-empty names", () => {
  add("a")
  expect(list().every((n) => n.length > 0)).toBe(true)
})
