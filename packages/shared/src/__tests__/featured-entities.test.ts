import { describe, it, expect } from "vitest"
import { FEATURED_ENTITIES, getFeaturedEntities } from "../featured-entities.js"

describe("FEATURED_ENTITIES", () => {
  it("covers the three pipeline entity types", () => {
    expect(Object.keys(FEATURED_ENTITIES).sort()).toEqual([
      "character",
      "location",
      "object",
    ])
  })

  it("every preset has a unique id within its type and a usable description", () => {
    for (const [type, presets] of Object.entries(FEATURED_ENTITIES)) {
      const ids = presets.map((p) => p.id)
      expect(new Set(ids).size, `${type} ids unique`).toBe(ids.length)
      for (const p of presets) {
        expect(p.label.length, `${type}/${p.id} label`).toBeGreaterThan(0)
        expect(p.description.length, `${type}/${p.id} description`).toBeGreaterThan(20)
      }
    }
  })
})

describe("getFeaturedEntities", () => {
  it("returns presets for a known type", () => {
    expect(getFeaturedEntities("character").length).toBeGreaterThan(0)
  })

  it("returns an empty array for an unknown type (e.g. scene)", () => {
    expect(getFeaturedEntities("scene")).toEqual([])
  })
})
