import { describe, it, expect } from "vitest"
import { price } from "../price.ee.js"

describe("remove-audio price", () => {
  it("one flat row, named by the type; no data-dependent credit id", () => {
    expect(price.staticCosts).toEqual({ "remove-audio": 20 })
    expect("creditId" in price).toBe(false)
  })
})
