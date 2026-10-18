import { describe, test } from "node:test"
import assert from "node:assert/strict"

describe("merge-a.cases.mjs", () => {
  describe("a", () => {
    test("one", () => assert.ok(true))
    test("two", () => assert.ok(true))
  })
})

describe("merge-b.cases.mjs", () => {
  test("three", () => assert.ok(true))
})
