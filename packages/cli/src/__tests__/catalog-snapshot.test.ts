import { describe, it, expect } from "vitest"
import { buildCatalogSnapshot } from "../lib/catalog-snapshot.js"

describe("buildCatalogSnapshot", () => {
  it("flattens single-dim options + sidecars, id-sorted and stable", () => {
    const snap = buildCatalogSnapshot(
      {
        catalogId: "setting",
        kind: "single",
        options: [
          { id: "forest", label: "Forest", promptHint: "in a forest" },
          { id: "beach", label: "Beach", promptHint: "on a beach" },
        ],
      },
      { he: { forest: { label: "יער" }, beach: { label: "חוף" } } },
    )
    expect(snap.entries.map((e) => e.id)).toEqual(["beach", "forest"]) // sorted
    expect(snap.sidecars.he.forest.label).toBe("יער")
  })

  it("flattens multi-dim dimensions into a single entry list, de-duped by id", () => {
    const snap = buildCatalogSnapshot(
      {
        catalogId: "person",
        kind: "multi",
        dimensions: [
          { options: [{ id: "type-woman", label: "Woman", promptHint: "a woman" }] },
          { options: [{ id: "age-30s", label: "30s", promptHint: "in their 30s" }] },
        ],
      },
      {},
    )
    expect(snap.entries.map((e) => e.id).sort()).toEqual(["age-30s", "type-woman"])
  })
})
