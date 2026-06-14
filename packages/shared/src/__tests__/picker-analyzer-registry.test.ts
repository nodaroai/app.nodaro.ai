import { describe, it, expect } from "vitest"
import {
  PEOPLE,
  PERSON_FIELD_BY_DIMENSION,
  getPersonDimensionLimit,
} from "../person.js"
import {
  buildPickerAnalyzerSpec,
  buildPickerZodSchema,
} from "../picker-analyzer-registry.js"

describe("buildPickerAnalyzerSpec(person)", () => {
  const spec = buildPickerAnalyzerSpec("person")

  it("covers all 29 dimensions with the correct field + limit", () => {
    expect(spec.dimensions).toHaveLength(29)
    for (const d of spec.dimensions) {
      expect(PERSON_FIELD_BY_DIMENSION[d.dimension]).toBe(d.field)
      expect(d.limit).toBe(getPersonDimensionLimit(d.dimension))
      expect(d.entryIds.length).toBeGreaterThan(0)
    }
  })

  it("uses catalog ids as the enum vocabulary (never labels)", () => {
    const hairColor = spec.dimensions.find((d) => d.dimension === "hair-color")!
    const catalogIds = PEOPLE.filter((p) => p.dimension === "hair-color").map((p) => p.id)
    expect([...hairColor.entryIds].sort()).toEqual([...catalogIds].sort())
  })

  it("excludes the age-custom sentinel from the age enum", () => {
    const age = spec.dimensions.find((d) => d.dimension === "age")!
    expect(age.entryIds).not.toContain("age-custom")
  })

  it("Zod schema rejects off-catalog values and over-limit arrays", () => {
    const schema = buildPickerZodSchema(spec)
    expect(schema.safeParse({ "hair-color": ["not-a-real-id"] }).success).toBe(false)
    // distinctive-features limit is 3 → 4 fails. Real catalog ids.
    const four = ["feature-freckles", "feature-glasses", "feature-scar", "feature-dimples"]
      .filter((id) => PEOPLE.some((p) => p.id === id))
    expect(four).toHaveLength(4)
    expect(schema.safeParse({ "distinctive-features": four }).success).toBe(false)
    // a valid single-pick value passes
    const someType = PEOPLE.find((p) => p.dimension === "type")!.id
    expect(schema.safeParse({ type: someType }).success).toBe(true)
  })
})
