import { describe, it, expect } from "vitest"
import {
  FRAMINGS,
  FRAMING_CATEGORY_ORDER,
  FRAMING_CATEGORY_LABELS,
  getFraming,
  isVantageFraming,
} from "../framing.js"

describe("Framing vantage category", () => {
  it("includes vantage in the category order", () => {
    expect(FRAMING_CATEGORY_ORDER).toContain("vantage")
  })
  it("labels vantage correctly", () => {
    expect(FRAMING_CATEGORY_LABELS.vantage).toBe("Vantage")
  })
  it("contains all 6 vantage entries", () => {
    const ids = ["front-on", "three-quarter-front", "profile-left", "profile-right", "three-quarter-back", "behind"]
    for (const id of ids) {
      const entry = getFraming(id)
      expect(entry).toBeDefined()
      expect(entry?.category).toBe("vantage")
      expect(entry?.promptHint.length).toBeGreaterThan(10)
    }
  })
  it("isVantageFraming correctly identifies vantage entries", () => {
    expect(isVantageFraming("front-on")).toBe(true)
    expect(isVantageFraming("profile-left")).toBe(true)
    expect(isVantageFraming("medium-shot")).toBe(false)  // shot-size
    expect(isVantageFraming("high-angle")).toBe(false)    // angle
    expect(isVantageFraming("rule-of-thirds")).toBe(false) // composition
    expect(isVantageFraming(undefined)).toBe(false)
  })
  it("has at least the core framing entries (vantage + foundational categories)", () => {
    // Initial set was 35 (24 original + 6 vantage + 4 reference-parity + 1 later);
    // catalog has since grown. Use a lower-bound check so this doesn't break on every catalog expansion.
    expect(FRAMINGS.length).toBeGreaterThanOrEqual(35)
  })
})
