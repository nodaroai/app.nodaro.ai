import { describe, it, expect } from "vitest"
import { buildLightingHints, LIGHTING_FIELD_BY_CATEGORY, LIGHTING_CATEGORY_ORDER } from "../lighting.js"

describe("buildLightingHints", () => {
  it("returns empty when nothing is set", () => {
    const hints = buildLightingHints({})
    expect(hints).toEqual([])
  })

  it("emits one hint per set per-category field, in canonical category order", () => {
    const hints = buildLightingHints({
      timeOfDay: "golden-hour",
      lightingStyle: "rembrandt",
      lightingDirection: "side",
    })
    expect(hints.length).toBe(3)
    // Canonical order: time-of-day, style, direction
    expect(hints[0]).toMatch(/golden hour/i)
    expect(hints[1]).toMatch(/rembrandt/i)
    expect(hints[2]).toMatch(/side lighting/i)
  })

  it("ignores the legacy lighting field — multi-category is the sole shape", () => {
    // Legacy compat layer was removed: the legacy `lighting` field is no
    // longer read; only per-category fields are considered.
    const hints = buildLightingHints({ lighting: "noon" } as Record<string, unknown>)
    expect(hints).toEqual([])
  })

  it("ignores empty-string and non-string values", () => {
    const hints = buildLightingHints({
      timeOfDay: "",
      lightingStyle: undefined,
      lightingDirection: "front",
    })
    expect(hints.length).toBe(1)
    expect(hints[0]).toMatch(/front lighting/i)
  })

  it("LIGHTING_FIELD_BY_CATEGORY covers all categories in order", () => {
    for (const cat of LIGHTING_CATEGORY_ORDER) {
      expect(LIGHTING_FIELD_BY_CATEGORY[cat]).toBeDefined()
    }
  })

  it("LIGHTING_FIELD_BY_CATEGORY maps each category to the expected field name", () => {
    expect(LIGHTING_FIELD_BY_CATEGORY["time-of-day"]).toBe("timeOfDay")
    expect(LIGHTING_FIELD_BY_CATEGORY.style).toBe("lightingStyle")
    expect(LIGHTING_FIELD_BY_CATEGORY.direction).toBe("lightingDirection")
  })

  it("returns empty when an unknown lighting id is given (no hint string)", () => {
    const hints = buildLightingHints({ timeOfDay: "this-is-not-a-real-id" })
    expect(hints).toEqual([])
  })

  it("aggregates all 3 categories with the correct prompt-hint substrings", () => {
    const hints = buildLightingHints({
      timeOfDay: "neon-night",
      lightingStyle: "low-key",
      lightingDirection: "back-rim",
    })
    expect(hints.length).toBe(3)
    expect(hints[0]).toMatch(/neon night/i)
    expect(hints[1]).toMatch(/low-key/i)
    expect(hints[2]).toMatch(/back-light|rim-light/i)
  })
})
