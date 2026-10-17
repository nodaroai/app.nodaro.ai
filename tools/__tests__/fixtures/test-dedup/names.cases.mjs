import { test } from "node:test"
import assert from "node:assert/strict"
import { add, list } from "./names.mjs"

// The candidate. Under `>` → `<=` it pushes "", and only then does the sibling
// below fail: run alone, the sibling passes that mutant.
test("rejects empty", () => {
  add("")
  assert.deepEqual(list(), [])
})

test("only non-empty names", () => {
  add("a")
  assert.equal(list().every((n) => n.length > 0), true)
})
