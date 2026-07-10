import { describe, it, expect } from "vitest"
import { referenceSheetBody } from "../reference-sheet.schema.js"
const base = {
  entityKind: "character", entityDbId: "11111111-1111-4111-8111-111111111111",
  type: "turnaround", skin: "studio",
  flavour: { outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey", sections: [{ kind: "head-turnaround" }] },
}
describe("referenceSheetBody", () => {
  it("accepts a valid request", () => { expect(referenceSheetBody.safeParse(base).success).toBe(true) })
  it("rejects an off-catalog skin", () => { expect(referenceSheetBody.safeParse({ ...base, skin: "neon" }).success).toBe(false) })
  it("rejects an off-catalog type", () => { expect(referenceSheetBody.safeParse({ ...base, type: "poster" }).success).toBe(false) })
  it("rejects a non-uuid entityDbId", () => { expect(referenceSheetBody.safeParse({ ...base, entityDbId: "nope" }).success).toBe(false) })
  it("rejects when neither entity nor imageUrl provided", () => {
    const { entityKind, entityDbId, ...rest } = base
    expect(referenceSheetBody.safeParse(rest).success).toBe(false)
  })
  it("accepts and preserves flavour.presetId", () => {
    const r = referenceSheetBody.safeParse({ ...base, flavour: { ...base.flavour, presetId: "studio-main" } })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.flavour.presetId).toBe("studio-main")
  })
  it("rejects an unknown presetId", () => {
    expect(referenceSheetBody.safeParse({ ...base, flavour: { ...base.flavour, presetId: "bogus" } }).success).toBe(false)
  })
})
