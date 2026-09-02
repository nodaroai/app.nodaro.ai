import { describe, it, expect, beforeEach } from "vitest"
import { registerPersonPack, resetPersonPacks, getRegisteredPeople } from "../person-packs.js"
import { registerCatalogPack, resetCatalogPacks } from "../catalog-packs.js"

beforeEach(() => {
  resetPersonPacks()
  resetCatalogPacks()
})

describe("person packs carry adultOnly", () => {
  it("an extend person pack entry keeps its flag in getRegisteredPeople()", () => {
    registerPersonPack({
      id: "test/person-extend",
      dimensions: [{ dimension: "vibe", field: "vibe", label: "Vibe" }],
      entries: [
        { id: "vibe-boudoir", label: "Boudoir", dimension: "vibe", description: "Boudoir styling", promptHint: "in a boudoir setting", adultOnly: true },
        { id: "vibe-picnic", label: "Picnic", dimension: "vibe", description: "Picnic styling", promptHint: "at a picnic" },
      ],
    })
    const people = getRegisteredPeople()
    expect(people.find((p) => p.id === "vibe-boudoir")?.adultOnly).toBe(true)
    expect(people.find((p) => p.id === "vibe-picnic")?.adultOnly).toBeUndefined()
  })

  it("a replace catalog pack for person keeps the flag through personEntriesFromDims", () => {
    registerCatalogPack({
      id: "test/person-replace",
      catalogId: "person",
      mode: "replace",
      catalog: {
        catalogId: "person",
        kind: "multi",
        label: "Person",
        dimensions: [
          {
            field: "bust",
            label: "Bust",
            options: [{ id: "bust-very-full", label: "Very Full", promptHint: "very full bust", adultOnly: true }],
          },
        ],
      } as never,
    })
    expect(getRegisteredPeople().find((p) => p.id === "bust-very-full")?.adultOnly).toBe(true)
  })
})
