import { test } from "node:test"
import assert from "node:assert/strict"
import { price } from "./price.mjs"

test("discounts orders over 100", () => {
  assert.equal(price(20, 10), 190)
})
