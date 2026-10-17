import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { price } from "./price.mjs"

describe("edge cases", () => {
  test("an empty order costs nothing", () => {
    assert.equal(price(0, 5), 0)
  })
})
