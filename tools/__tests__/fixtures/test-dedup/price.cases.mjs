import { test } from "node:test"
import assert from "node:assert/strict"
import { price } from "./price.mjs"

test("discounts orders over 100", () => {
  assert.equal(price(20, 10), 190)
})

// A true copy: everything it kills, the test above kills too.
test("discounts orders over 100 (copy)", () => {
  assert.equal(price(20, 10), 190)
})

test("small orders pay full price", () => {
  assert.equal(price(2, 3), 6)
})

// The planted unique assertion: nothing else in this file checks qty <= 0.
test("an empty order is free", () => {
  assert.equal(price(0, 5), 0)
})
