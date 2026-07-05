import { describe, it, expect } from "vitest"
import { buildWardrobeHints, getWardrobePromptHint, WARDROBE_DIMENSION_ORDER } from "../wardrobe.js"

describe("buildWardrobeHints", () => {
  it("returns [] for empty value", () => {
    expect(buildWardrobeHints({})).toEqual([])
  })
  it("emits single-pick hints in dimension order", () => {
    const hints = buildWardrobeHints({ archetype: "wd-formal", top: "wd-blouse", colorPalette: "wd-all-black" })
    expect(hints[0]).toBe(getWardrobePromptHint("wd-formal"))
    expect(hints).toContain(getWardrobePromptHint("wd-blouse"))
    expect(hints).toContain(getWardrobePromptHint("wd-all-black"))
  })
  it("suppresses the 'none' outerwear sentinel", () => {
    expect(buildWardrobeHints({ outerwear: "wd-outer-none" })).toEqual([])
  })
  it("emits multi-pick accessories independently", () => {
    const hints = buildWardrobeHints({ accessories: ["wd-glasses", "wd-scarf"] })
    expect(hints).toContain(getWardrobePromptHint("wd-glasses"))
    expect(hints).toContain(getWardrobePromptHint("wd-scarf"))
  })
  it("WARDROBE_DIMENSION_ORDER has no duplicates", () => {
    expect(new Set(WARDROBE_DIMENSION_ORDER).size).toBe(WARDROBE_DIMENSION_ORDER.length)
  })
})
