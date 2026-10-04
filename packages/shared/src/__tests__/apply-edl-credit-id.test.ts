import { describe, it, expect } from "vitest"
// Through the package index: the id builder is part of the public surface the
// backend, the editor and SDK users all price an Apply EDL render through.
import { applyEdlCreditId } from "../index.js"

describe("applyEdlCreditId — the credit id an Apply EDL render is priced on", () => {
  it("a proxy (preview) render has its own id", () => {
    expect(applyEdlCreditId("proxy")).toBe("apply-edl:proxy")
  })

  it("a final render keeps the bare id", () => {
    expect(applyEdlCreditId("final")).toBe("apply-edl")
  })

  it("no quality is the final, as the route and the node default it", () => {
    expect(applyEdlCreditId(undefined)).toBe("apply-edl")
    expect(applyEdlCreditId(null)).toBe("apply-edl")
  })

  it("anything that is not exactly \"proxy\" prices as the final (the dearer id: never under-quote)", () => {
    for (const q of ["PROXY", " proxy", "preview", "", 0, true, {}, ["proxy"]]) {
      expect(applyEdlCreditId(q)).toBe("apply-edl")
    }
  })
})
