import { describe, it, expect } from "vitest"
import { buildFramingHints, FRAMING_FIELD_BY_CATEGORY, FRAMING_CATEGORY_ORDER } from "../framing.js"

describe("buildFramingHints", () => {
  it("returns empty when nothing is set", () => {
    const hints = buildFramingHints({})
    expect(hints).toEqual([])
  })

  it("emits one hint per set per-category field, in canonical category order", () => {
    const hints = buildFramingHints({
      shotSize: "wide-shot",
      angle: "low-angle",
      coverage: "single",
      composition: "rule-of-thirds",
      vantage: "front-on",
    })
    expect(hints.length).toBe(5)
    // Canonical order: shot-size, angle, coverage, composition, vantage
    expect(hints[0]).toMatch(/wide shot/i)
    expect(hints[1]).toMatch(/low angle/i)
    expect(hints[2]).toMatch(/single shot/i)
    expect(hints[3]).toMatch(/rule of thirds/i)
    expect(hints[4]).toMatch(/front-on/i)
  })

  it("ignores the legacy framing field — multi-category is the sole shape", () => {
    // Legacy compat layer was removed: the legacy `framing` field is no
    // longer read; only per-category fields are considered.
    const hints = buildFramingHints({ framing: "medium-shot" } as Record<string, unknown>)
    expect(hints).toEqual([])
  })

  it("skipVantage suppresses ONLY the vantage hint, keeps other categories", () => {
    const hints = buildFramingHints(
      {
        shotSize: "close-up",
        angle: "high-angle",
        vantage: "profile-left",
      },
      true,
    )
    expect(hints.length).toBe(2)
    expect(hints[0]).toMatch(/close-up/i)
    expect(hints[1]).toMatch(/high angle/i)
    expect(hints.some((h) => /profile/i.test(h))).toBe(false)
  })

  it("ignores empty-string and non-string values", () => {
    const hints = buildFramingHints({
      shotSize: "",
      angle: undefined,
      coverage: null as unknown as string,
      composition: 42 as unknown as string,
      vantage: "front-on",
    })
    expect(hints.length).toBe(1)
    expect(hints[0]).toMatch(/front-on/i)
  })

  it("FRAMING_FIELD_BY_CATEGORY covers all categories in order", () => {
    for (const cat of FRAMING_CATEGORY_ORDER) {
      expect(FRAMING_FIELD_BY_CATEGORY[cat]).toBeDefined()
    }
  })

  it("returns empty when an unknown framing id is given (no hint string)", () => {
    const hints = buildFramingHints({ shotSize: "this-is-not-a-real-id" })
    expect(hints).toEqual([])
  })
})
