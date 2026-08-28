import { describe, it, expect, beforeEach } from "vitest"
import type { PickerCatalog, PickerOption } from "../picker-catalogs.js"
import {
  registerCatalogPack, getRegisteredCatalogPacks, resetCatalogPacks,
  catalogPacksVersion, composePickerCatalogs,
  type CatalogPack,
} from "../catalog-packs.js"

const base: readonly PickerCatalog[] = [
  { nodeType: "setting", label: "Setting", catalogId: "setting", kind: "single", valueField: "setting",
    options: [
      { id: "forest", label: "Forest", promptHint: "in a forest", term: "forest" },
      { id: "beach", label: "Beach", promptHint: "on a beach", term: "beach" },
    ] },
]

beforeEach(() => resetCatalogPacks())

describe("composePickerCatalogs — pure", () => {
  it("returns a structurally-equal NEW array when no packs (does not mutate base)", () => {
    const out = composePickerCatalogs(base, [])
    expect(out).toEqual(base)
    expect(out).not.toBe(base)
    expect(out[0]).not.toBe(base[0])
  })

  it("deny removes entry ids from the copy, leaving base untouched", () => {
    const out = composePickerCatalogs(base, [{ id: "p", catalogId: "setting", mode: "deny", denyIds: ["beach"] }])
    expect(out[0].options!.map((o: PickerOption) => o.id)).toEqual(["forest"])
    expect(base[0].options!.map((o: PickerOption) => o.id)).toEqual(["forest", "beach"]) // base immutable
  })

  it("extend appends single-dim options", () => {
    const out = composePickerCatalogs(base, [{ id: "p", catalogId: "setting", mode: "extend",
      options: [{ id: "shul", label: "Shul", promptHint: "in a synagogue", term: "shul" }] }])
    expect(out[0].options!.map((o: PickerOption) => o.id)).toEqual(["forest", "beach", "shul"])
  })

  it("replace swaps the catalog wholesale for its catalogId", () => {
    const vendored: PickerCatalog = { nodeType: "setting", label: "Setting", catalogId: "setting", kind: "single",
      valueField: "setting", options: [{ id: "forest", label: "Forest", promptHint: "in a forest", term: "forest" }] }
    const out = composePickerCatalogs(base, [{ id: "p", catalogId: "setting", mode: "replace", catalog: vendored }])
    expect(out[0].options!.map((o: PickerOption) => o.id)).toEqual(["forest"])
  })

  it("applies packs in registration order and throws for an unknown catalogId", () => {
    expect(() => composePickerCatalogs(base, [{ id: "p", catalogId: "nope", mode: "deny", denyIds: ["x"] }]))
      .toThrow(/unknown catalog id "nope"/i)
  })
})

describe("registry + version", () => {
  it("register bumps the version; reset clears and bumps", () => {
    const v0 = catalogPacksVersion()
    registerCatalogPack({ id: "a", catalogId: "setting", mode: "deny", denyIds: ["beach"] })
    expect(getRegisteredCatalogPacks().map((p: CatalogPack) => p.id)).toEqual(["a"])
    expect(catalogPacksVersion()).toBeGreaterThan(v0)
    const v1 = catalogPacksVersion()
    resetCatalogPacks()
    expect(getRegisteredCatalogPacks()).toEqual([])
    expect(catalogPacksVersion()).toBeGreaterThan(v1)
  })

  it("rejects a duplicate pack id", () => {
    registerCatalogPack({ id: "a", catalogId: "setting", mode: "deny", denyIds: ["beach"] })
    expect(() => registerCatalogPack({ id: "a", catalogId: "setting", mode: "deny", denyIds: ["forest"] }))
      .toThrow(/duplicate/i)
  })
})
