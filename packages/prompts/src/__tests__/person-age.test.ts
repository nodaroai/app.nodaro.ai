import { describe, it, expect } from "vitest"
import { buildAgeHint, buildPersonHints, getPerson } from "../person.js"

describe("buildAgeHint", () => {
  it("returns the catalog promptHint for non-custom presets", () => {
    expect(buildAgeHint("age-toddler", undefined)).toBe(getPerson("age-toddler")?.promptHint)
    expect(buildAgeHint("age-30s", undefined)).toBe("in their 30s")
  })

  it("returns empty when ageId is undefined or unknown", () => {
    expect(buildAgeHint(undefined, undefined)).toBe("")
    expect(buildAgeHint(null, undefined)).toBe("")
    expect(buildAgeHint("age-fictional", undefined)).toBe("")
  })

  it("ignores customAge unless ageId is the sentinel", () => {
    // Without the sentinel the helper falls through to the catalog hint —
    // a stale customAge from a previous selection must not leak.
    expect(buildAgeHint("age-30s", 7)).toBe("in their 30s")
  })

  it("returns empty for custom sentinel without a number", () => {
    expect(buildAgeHint("age-custom", undefined)).toBe("")
    expect(buildAgeHint("age-custom", null)).toBe("")
    expect(buildAgeHint("age-custom", Number.NaN)).toBe("")
  })

  it("generates age-band-tuned phrasing for the lower ranges", () => {
    expect(buildAgeHint("age-custom", 0)).toBe("a newborn under 1 year old")
    expect(buildAgeHint("age-custom", 1)).toBe("around 1 year old")
    expect(buildAgeHint("age-custom", 3)).toBe("a toddler around 3 years old")
    expect(buildAgeHint("age-custom", 5)).toBe("a young child around 5 years old")
    expect(buildAgeHint("age-custom", 8)).toBe("a child around 8 years old")
    expect(buildAgeHint("age-custom", 11)).toBe("a pre-teen around 11 years old")
    expect(buildAgeHint("age-custom", 14)).toBe("14 years old, in their teens")
  })

  it("uses plain phrasing for adult ages so Age dim composes with Type", () => {
    expect(buildAgeHint("age-custom", 22)).toBe("22 years old")
    expect(buildAgeHint("age-custom", 28)).toBe("28 years old")
    expect(buildAgeHint("age-custom", 47)).toBe("47 years old")
  })

  it("clamps and rounds outlandish numbers", () => {
    expect(buildAgeHint("age-custom", -3)).toBe("a newborn under 1 year old")
    expect(buildAgeHint("age-custom", 999)).toBe("120 years old")
    expect(buildAgeHint("age-custom", 7.6)).toBe("a child around 8 years old")
  })
})

describe("buildPersonHints with age-custom", () => {
  it("emits the custom-age phrase in canonical position", () => {
    const hints = buildPersonHints({
      type: "woman",
      age: "age-custom",
      customAge: 8,
    })
    expect(hints).toContain("a woman")
    expect(hints).toContain("a child around 8 years old")
    // Age must follow type per PERSON_DIMENSION_ORDER.
    expect(hints.indexOf("a child around 8 years old"))
      .toBeGreaterThan(hints.indexOf("a woman"))
  })

  it("drops the age clause silently when age-custom has no number", () => {
    const hints = buildPersonHints({
      type: "woman",
      age: "age-custom",
    })
    expect(hints).toEqual(["a woman"])
  })

  it("ignores customAge when a non-custom preset is selected", () => {
    const hints = buildPersonHints({
      age: "age-30s",
      customAge: 7,
    })
    expect(hints).toEqual(["in their 30s"])
  })
})
