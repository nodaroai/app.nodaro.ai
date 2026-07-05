import { describe, it, expect } from "vitest"
import { buildTemporalHints, TEMPORAL_FIELD_BY_CATEGORY, TEMPORAL_CATEGORY_ORDER } from "../temporal.js"

describe("buildTemporalHints", () => {
  it("returns empty when nothing is set", () => {
    const hints = buildTemporalHints({})
    expect(hints).toEqual([])
  })

  it("emits one hint per set per-category field, in canonical category order", () => {
    const hints = buildTemporalHints({
      temporalSpeed: "slow-motion",
      temporalFreeze: "bullet-time",
      temporalDirection: "reverse",
      temporalShutter: "long-exposure",
    })
    expect(hints.length).toBe(4)
    // Canonical order: speed, freeze, direction, shutter
    expect(hints[0]).toMatch(/slow motion/i)
    expect(hints[1]).toMatch(/bullet time/i)
    expect(hints[2]).toMatch(/reverse/i)
    expect(hints[3]).toMatch(/long exposure/i)
  })

  it("ignores the legacy temporal field — multi-category is the sole shape", () => {
    // Legacy compat layer was removed: the legacy `temporal` field is no
    // longer read; only per-category fields are considered.
    const hints = buildTemporalHints({ temporal: "slow-motion" } as Record<string, unknown>)
    expect(hints).toEqual([])
  })

  it("ignores empty-string and non-string values", () => {
    const hints = buildTemporalHints({
      temporalSpeed: "",
      temporalFreeze: undefined,
      temporalDirection: null as unknown as string,
      temporalShutter: "motion-blur",
    })
    expect(hints.length).toBe(1)
    expect(hints[0]).toMatch(/motion blur/i)
  })

  it("TEMPORAL_FIELD_BY_CATEGORY covers all categories in order", () => {
    for (const cat of TEMPORAL_CATEGORY_ORDER) {
      expect(TEMPORAL_FIELD_BY_CATEGORY[cat]).toBeDefined()
    }
  })

  it("TEMPORAL_FIELD_BY_CATEGORY maps each category to the expected field name", () => {
    expect(TEMPORAL_FIELD_BY_CATEGORY.speed).toBe("temporalSpeed")
    expect(TEMPORAL_FIELD_BY_CATEGORY.freeze).toBe("temporalFreeze")
    expect(TEMPORAL_FIELD_BY_CATEGORY.direction).toBe("temporalDirection")
    expect(TEMPORAL_FIELD_BY_CATEGORY.shutter).toBe("temporalShutter")
  })

  it("returns empty when an unknown temporal id is given (no hint string)", () => {
    const hints = buildTemporalHints({ temporalSpeed: "this-is-not-a-real-id" })
    expect(hints).toEqual([])
  })

  it("aggregates all 4 categories with the correct prompt-hint substrings", () => {
    const hints = buildTemporalHints({
      temporalSpeed: "time-lapse",
      temporalFreeze: "frozen-subject",
      temporalDirection: "loop-boomerang",
      temporalShutter: "stop-motion",
    })
    expect(hints.length).toBe(4)
    expect(hints[0]).toMatch(/time-lapse/i)
    expect(hints[1]).toMatch(/frozen subject/i)
    expect(hints[2]).toMatch(/boomerang/i)
    expect(hints[3]).toMatch(/stop-motion/i)
  })
})
