import { describe, it, expect } from "vitest"
import { price } from "../price.ee.js"

describe("speaker-map price", () => {
  it("one flat row at 10 credits, named by the type; no data-dependent credit id", () => {
    expect(price.staticCosts).toEqual({ "speaker-map": 10 })
    expect("creditId" in price).toBe(false)
  })
})
