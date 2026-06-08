import { describe, it, expect } from "vitest"
import { PERSON_DIMENSION_SECTIONS, PERSON_DIMENSION_ORDER } from "../index.js"

describe("PERSON_DIMENSION_SECTIONS", () => {
  it("partitions every PersonDimension exactly once", () => {
    const inSections = PERSON_DIMENSION_SECTIONS.flatMap((s) => s.dimensions)
    expect([...inSections].sort()).toEqual([...PERSON_DIMENSION_ORDER].sort())
    expect(new Set(inSections).size).toBe(inSections.length)
  })
  it("has 6 sections with the expected counts", () => {
    expect(PERSON_DIMENSION_SECTIONS.map((s) => s.dimensions.length)).toEqual([4, 2, 6, 3, 4, 2])
  })
})
