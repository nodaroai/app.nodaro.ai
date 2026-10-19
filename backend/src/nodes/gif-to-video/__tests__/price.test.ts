import { describe, it, expect } from "vitest"
import { price } from "../price.ee.js"

describe("gif-to-video price", () => {
  it("one flat row at zero credits, named by the type; no data-dependent credit id", () => {
    expect(price.staticCosts).toEqual({ "gif-to-video": 0 })
    expect("creditId" in price).toBe(false)
  })
})
