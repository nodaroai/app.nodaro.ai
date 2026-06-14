import { describe, it, expect } from "vitest"
import {
  PEOPLE,
  PERSON_DIMENSION_ORDER,
  PERSON_FIELD_BY_DIMENSION,
  MAX_SELECTED_BY_DIMENSION,
  getPersonDimensionLimit,
} from "../person.js"
import { buildPickerAnalyzerSpec } from "../picker-analyzer-registry.js"

// PersonData array-capable fields (string | ReadonlyArray<string>).
const ARRAY_FIELDS = new Set([
  "ethnicity", "regionalAesthetic", "lipState", "hairColor",
  "skinTexture", "eyeColor", "eyeState", "distinctiveFeature",
])

describe("person analyzer invariants", () => {
  it("every dimension has a field mapping and a defined limit", () => {
    for (const dim of PERSON_DIMENSION_ORDER) {
      expect(PERSON_FIELD_BY_DIMENSION[dim]).toBeTruthy()
      expect(getPersonDimensionLimit(dim)).toBeGreaterThanOrEqual(1)
    }
    expect(PERSON_DIMENSION_ORDER).toHaveLength(29)
  })

  it("cardinality bijection: limit>1 ⇔ field is array-capable", () => {
    for (const dim of PERSON_DIMENSION_ORDER) {
      const field = PERSON_FIELD_BY_DIMENSION[dim]
      const multi = getPersonDimensionLimit(dim) > 1
      expect(multi).toBe(ARRAY_FIELDS.has(field))
    }
  })

  it("analyzer enum equals the catalog ids per dimension (ids, never labels)", () => {
    const spec = buildPickerAnalyzerSpec("person")
    for (const d of spec.dimensions) {
      const catalog = PEOPLE.filter((p) => p.dimension === d.dimension && p.id !== "age-custom").map((p) => p.id)
      expect([...d.entryIds].sort()).toEqual([...catalog].sort())
    }
  })

  it("MAX_SELECTED keys are all valid dimensions", () => {
    for (const k of Object.keys(MAX_SELECTED_BY_DIMENSION)) {
      expect(PERSON_DIMENSION_ORDER).toContain(k)
    }
  })
})
