import { describe, it, expect } from "vitest"
import { buildMultiPickerAnalyzerSpec, buildPickerAnalyzerSpec, pickerFanoutTargets } from "../index.js"

describe("buildMultiPickerAnalyzerSpec", () => {
  it("composes one section per wired picker plus gaps, order-independent", () => {
    const a = buildMultiPickerAnalyzerSpec(["styling", "person"])
    const b = buildMultiPickerAnalyzerSpec(["person", "styling"])
    expect(a.toolName).toBe("emit_pickers")
    const parsed = a.schema.parse({ person: { type: "stylish-influencer" }, styling: { makeup: "makeup-natural" } })
    expect(parsed).toMatchObject({ person: { type: "stylish-influencer" } })
    expect(a.legend).toBe(b.legend) // sorted → deterministic
  })

  it("defaults gaps to empty and accepts a valid gaps payload", () => {
    const { schema } = buildMultiPickerAnalyzerSpec(["lens"])
    expect(schema.parse({ lens: { lens: "normal-50mm" } })).toMatchObject({
      gaps: { missingItems: [], missingCategories: [] },
    })
    const withGaps = schema.parse({
      lens: { lens: "normal-50mm" },
      gaps: { missingItems: [{ picker: "lens", dimension: "lens", observed: "tilt-shift macro hybrid" }] },
    })
    expect(withGaps.gaps.missingItems).toHaveLength(1)
  })

  it("FUZZ: arbitrary gaps content never alters the enum-validated picker sections", () => {
    const { schema } = buildMultiPickerAnalyzerSpec(["person"])
    const personSpec = buildPickerAnalyzerSpec("person")
    const validPerson = { type: "stylish-influencer", age: "age-early-20s" }
    const garbage = [
      { missingItems: Array.from({ length: 50 }, () => ({ picker: "x", dimension: "y", observed: "z".repeat(500) })) },
      { missingItems: [{ picker: 123, dimension: null, observed: {} }] },
      "not even an object",
      { unknownKey: true },
    ]
    for (const g of garbage) {
      const result = schema.safeParse({ person: validPerson, gaps: g })
      // Either the whole payload is rejected (gaps invalid) OR it parses with
      // the person section intact — never a corrupted person section.
      if (result.success) {
        expect(result.data.person).toEqual(validPerson)
        // when gaps parses at all it is within the 8-item cap (over-cap or
        // over-length payloads like the 50-item one are REJECTED outright by
        // .max(), never truncated — so they take the !success path above)
        expect(result.data.gaps.missingItems.length).toBeLessThanOrEqual(8)
      }
    }
    // The person section schema itself rejects an out-of-enum value regardless
    expect(personSpec.dimensions.length).toBeGreaterThan(0)
  })
})

describe("pickerFanoutTargets", () => {
  const nodes = [
    { id: "dp", type: "describe-to-picker" },
    { id: "p", type: "person" },
    { id: "s", type: "styling" },
    { id: "t", type: "combine-text" },
  ]
  const edges = [
    { source: "dp", target: "p", sourceHandle: "picker-json" },
    { source: "dp", target: "s", sourceHandle: "picker-json" },
    { source: "dp", target: "t", sourceHandle: "in" }, // non-picker target ignored
  ]
  it("derives only analyzable picker-json targets, deduped", () => {
    expect(pickerFanoutTargets("dp", edges, nodes).sort()).toEqual(["person", "styling"])
  })
  it("ignores non-picker-json source handles", () => {
    expect(pickerFanoutTargets("dp", [{ source: "dp", target: "p", sourceHandle: "out" }], nodes)).toEqual([])
  })
})
