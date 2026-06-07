import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

describe("reference-sheet assembly pricing", () => {
  it("the flat assembly fee is registered at 4 credits", () => {
    expect(STATIC_CREDIT_COSTS["reference-sheet:assembly"]).toBe(4)
  })
  it("the flat motion-assembly fee is registered at 6 credits", () => {
    expect(STATIC_CREDIT_COSTS["reference-sheet:assembly-motion"]).toBe(6)
  })
})
