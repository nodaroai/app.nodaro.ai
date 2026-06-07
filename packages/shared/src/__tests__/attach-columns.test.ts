import { describe, it, expect } from "vitest"
import { CHARACTER_ATTACH_COLUMNS, OBJECT_ATTACH_COLUMNS, LOCATION_ATTACH_COLUMNS } from "../entity-prompts.js"

describe("attach columns include the reference-sheet buckets", () => {
  it("character gains sheets, detail_closeups, outfit_variations", () => {
    for (const c of ["sheets", "detail_closeups", "outfit_variations"]) expect(CHARACTER_ATTACH_COLUMNS).toContain(c)
    // originals preserved
    for (const c of ["expressions", "poses", "angles", "body_angles", "lighting_variations"]) expect(CHARACTER_ATTACH_COLUMNS).toContain(c)
  })
  it("object gains sheets, detail_closeups (NOT outfit_variations)", () => {
    for (const c of ["sheets", "detail_closeups"]) expect(OBJECT_ATTACH_COLUMNS).toContain(c)
    expect(OBJECT_ATTACH_COLUMNS).not.toContain("outfit_variations")
    for (const c of ["angles", "materials", "variations", "motion_clips"]) expect(OBJECT_ATTACH_COLUMNS).toContain(c)
  })
  it("location gains sheets, detail_closeups", () => {
    for (const c of ["sheets", "detail_closeups"]) expect(LOCATION_ATTACH_COLUMNS).toContain(c)
    for (const c of ["time_of_day", "weather", "seasons", "angles", "lighting", "atmosphere_motions"]) expect(LOCATION_ATTACH_COLUMNS).toContain(c)
  })
})
