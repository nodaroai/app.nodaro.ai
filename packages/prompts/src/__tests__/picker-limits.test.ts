import { describe, it, expect } from "vitest"
import { MAX_SELECTED_BY_STYLING_DIMENSION, getStylingDimensionLimit, MAX_SELECTED_BY_FRAMING_CATEGORY, getFramingCategoryLimit } from "../index.js"

describe("styling dimension limits", () => {
  it("matches the picker's caps", () => {
    expect(MAX_SELECTED_BY_STYLING_DIMENSION.jewelry).toBe(3)
    expect(MAX_SELECTED_BY_STYLING_DIMENSION["wardrobe-state"]).toBe(3)
    expect(MAX_SELECTED_BY_STYLING_DIMENSION["hair-state"]).toBe(2)
    expect(getStylingDimensionLimit("jewelry")).toBe(3)
    expect(getStylingDimensionLimit("makeup")).toBe(1) // unlisted → 1
  })
})

describe("framing category limits", () => {
  it("matches the picker's caps", () => {
    expect(MAX_SELECTED_BY_FRAMING_CATEGORY.composition).toBe(2)
    expect(getFramingCategoryLimit("composition")).toBe(2)
    expect(getFramingCategoryLimit("angle")).toBe(1) // unlisted → 1
  })
})
