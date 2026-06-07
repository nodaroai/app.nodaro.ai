import { describe, it, expect } from "vitest"
import { referenceSheetBody } from "../reference-sheet.schema.js"
const base = {
  entityKind: "character", entityDbId: "11111111-1111-1111-1111-111111111111",
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
})
