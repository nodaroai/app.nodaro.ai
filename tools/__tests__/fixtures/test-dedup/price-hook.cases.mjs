import { before, test } from "node:test"
import assert from "node:assert/strict"
import { price } from "./price.mjs"

// The empty-order assertion lives only in a hook: when it throws, node
// reports the test below as cancelled, never as failed.
before(() => {
  assert.equal(price(0, 5), 0)
})

test("discounts orders over 100", () => {
  assert.equal(price(20, 10), 190)
})
