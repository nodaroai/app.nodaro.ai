import { describe, it, expect } from "vitest"
import { price } from "../price.ee.js"

describe("shot-cuts price", () => {
  it("one flat row of 1 credit, named by the type, with or without frames; no data-dependent credit id", () => {
    expect(price.staticCosts).toEqual({ "shot-cuts": 1 })
    expect("creditId" in price).toBe(false)
  })
})
