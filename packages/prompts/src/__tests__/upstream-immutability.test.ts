// The convergence invariant, in-package form: registering a pack NEVER mutates
// an upstream/base catalog array (curation is additive-by-registration, never
// an in-place edit of an upstream file's exported data).
import { describe, it, expect, beforeEach } from "vitest"
import { PICKER_CATALOGS } from "../picker-catalogs.js"
import { registerCatalogPack, resetCatalogPacks } from "../catalog-packs.js"

beforeEach(() => resetCatalogPacks())

describe("packs never edit upstream in place", () => {
  it("base PICKER_CATALOGS is frozen and unchanged after replace/extend/deny", () => {
    const snapshot = JSON.stringify(PICKER_CATALOGS)
    expect(Object.isFrozen(PICKER_CATALOGS)).toBe(true)
    registerCatalogPack({ id: "x", catalogId: "setting", mode: "deny", denyIds: ["forest"] })
    registerCatalogPack({
      id: "y",
      catalogId: "mood",
      mode: "extend",
      options: [{ id: "z", label: "Z", promptHint: "z", term: "z" }],
    })
    expect(JSON.stringify(PICKER_CATALOGS)).toBe(snapshot)
  })
})
