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
// NOTE: the existing test file already imports `buildPickerAnalyzerSpec` from
// "../picker-analyzer-registry.js" — do NOT re-import it here (duplicate-identifier
// error). Import only the NEW symbols, and reuse the existing buildPickerAnalyzerSpec.
import { PICKER_TYPES, ANALYZABLE_PICKER_TYPES, isAnalyzablePicker } from "../index.js"
import { STYLINGS } from "../styling.js"
import { FRAMINGS } from "../framing.js"
import { LENSES } from "../lens.js"
import { CAMERA_FORMATS } from "../camera-format.js"

describe("buildPickerAnalyzerSpec(person)", () => {
  const spec = buildPickerAnalyzerSpec("person")

  it("covers all 33 dimensions with the correct field + limit", () => {
    expect(spec.dimensions).toHaveLength(33)
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

describe("registry membership (Task 2: person only)", () => {
  it("exposes person via the registry-derived set", () => {
    expect(PICKER_TYPES).toContain("person")
    expect(ANALYZABLE_PICKER_TYPES.has("person")).toBe(true)
    expect(isAnalyzablePicker("person")).toBe(true)
    expect(isAnalyzablePicker("not-a-picker")).toBe(false)
  })
  it("person spec is unchanged after generalization", () => {
    const spec = buildPickerAnalyzerSpec("person")
    expect(spec.toolName).toBe("emit_person")
    // age dimension still excludes the age-custom sentinel
    const age = spec.dimensions.find((d) => d.dimension === "age")!
    expect(age.entryIds).not.toContain("age-custom")
    // ethnicity is a 2-pick array dimension
    expect(spec.dimensions.find((d) => d.dimension === "ethnicity")!.limit).toBe(2)
    // every dimension now carries a human label
    expect(spec.dimensions.find((d) => d.dimension === "type")!.label).toBe("Type")
  })
})

describe("registry invariants (all analyzable pickers)", () => {
  it("registers the batch", () => {
    expect(new Set(PICKER_TYPES)).toEqual(
      new Set(["person", "styling", "framing", "lens", "camera-format"]),
    )
  })
  it.each(PICKER_TYPES)("%s: every dimension enum equals its catalog ids and is non-empty", (t) => {
    const spec = buildPickerAnalyzerSpec(t)
    expect(spec.dimensions.length).toBeGreaterThan(0)
    for (const d of spec.dimensions) {
      expect(d.entryIds.length).toBeGreaterThan(0)
      expect(d.entryIds.length).toBe(new Set(d.entryIds).size) // no dupes
      expect(d.field.length).toBeGreaterThan(0)
      expect(d.label.length).toBeGreaterThan(0)
    }
  })
  it("flat pickers are single limit-1 dimensions keyed by their field", () => {
    expect(buildPickerAnalyzerSpec("lens").dimensions).toMatchObject([{ field: "lens", limit: 1 }])
    expect(buildPickerAnalyzerSpec("camera-format").dimensions).toMatchObject([
      { field: "cameraFormat", limit: 1 },
    ])
  })
  it("multi-pick caps come through (styling jewelry=3, framing composition=2)", () => {
    const styling = buildPickerAnalyzerSpec("styling")
    expect(styling.dimensions.find((d) => d.dimension === "jewelry")!.limit).toBe(3)
    const framing = buildPickerAnalyzerSpec("framing")
    expect(framing.dimensions.find((d) => d.dimension === "composition")!.limit).toBe(2)
  })
  it("lens enum equals LENSES ids", () => {
    expect(buildPickerAnalyzerSpec("lens").dimensions[0].entryIds).toEqual(LENSES.map((l) => l.id))
  })
})
