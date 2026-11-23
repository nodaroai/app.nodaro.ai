import { describe, expect, it, vi } from "vitest"

// A bare id that names options of two fields (and no main option) cannot be
// stored as either: the caller must say which. No served catalog has such an
// id today, so this one is made up.
vi.mock("@nodaro/prompts/picker-catalogs", () => ({
  getRegisteredPickerCatalogs: () => [
    {
      nodeType: "made-up",
      catalogId: "made-up",
      label: "Made up",
      kind: "multi",
      fields: ["first", "second"],
      dimensions: [
        { field: "first", label: "First", options: [{ id: "same", label: "Same (first)" }] },
        { field: "second", label: "Second", options: [{ id: "same", label: "Same (second)" }, { id: "only", label: "Only" }] },
      ],
    },
  ],
}))

import { resolveCatalogFavorite } from "../catalog-favorite-ids.js"

describe("an id in two fields", () => {
  it("must name its field", () => {
    expect(resolveCatalogFavorite("made-up", "same")).toMatchObject({ ok: false, reason: "ambiguous_option" })
    expect(resolveCatalogFavorite("made-up", "second:same")).toEqual({
      ok: true,
      key: { catalog: "made-up", optionId: "second:same", label: "Same (second)" },
    })
    expect(resolveCatalogFavorite("made-up", "only")).toMatchObject({ ok: true, key: { optionId: "second:only" } })
  })
})
