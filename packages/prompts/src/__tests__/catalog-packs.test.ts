import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { PickerCatalog, PickerOption } from "../picker-catalogs.js"
import type { PickerOptionInput, PickerCatalogInput } from "../catalog-packs.js"
import {
  registerCatalogPack, getRegisteredCatalogPacks, resetCatalogPacks,
  catalogPacksVersion, composePickerCatalogs,
  type CatalogPack,
} from "../catalog-packs.js"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"
import { getPickerCatalog } from "../picker-catalogs.js"

const base: readonly PickerCatalog[] = [
  { nodeType: "setting", label: "Setting", catalogId: "setting", kind: "single", valueField: "setting",
    options: [
      { id: "forest", label: "Forest", promptHint: "in a forest", term: "forest" },
      { id: "beach", label: "Beach", promptHint: "on a beach", term: "beach" },
    ] },
]

beforeEach(() => resetCatalogPacks())
afterEach(() => resetCatalogPacks()) // never leak a pack into another file's registry view

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
    const vendored: PickerCatalogInput = { nodeType: "setting", label: "Setting", catalogId: "setting", kind: "single",
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

// ---------------------------------------------------------------------------
// Compact hint mode over pack-added options
// ---------------------------------------------------------------------------

/**
 * `PickerOption.term` is REQUIRED at the type level, but a pack is compiled
 * separately — a vendored bundle built against a `@nodaro/prompts` that predates
 * `term` hands us an option object with no such property at run time. The cast
 * reproduces that exactly; without composition-time resolution the option would
 * inject its full hint in full mode and `undefined` (i.e. nothing) in compact.
 */
// A pack literal WITHOUT `term` must type-check against the pack input
// types (`PickerOptionInput`) — `term` is author-optional and resolved at
// composition. The helper is deliberately an identity on the INPUT type, not a
// cast to the registry's output type.
function legacyOption(o: Omit<PickerOption, "term">): PickerOptionInput {
  return o as PickerOption
}

describe("pack options resolve a term at composition", () => {
  it("extend: a term-less pack option gets the derived term", () => {
    const out = composePickerCatalogs(base, [{
      id: "legacy", catalogId: "setting", mode: "extend",
      options: [legacyOption({ id: "shul-hall", label: "Shul Hall", promptHint: "in a synagogue hall" })],
    }])
    expect(out[0].options!.find((o: PickerOption) => o.id === "shul-hall")!.term).toBe("shul hall")
  })

  it("replace: a term-less vendored catalog gets terms too", () => {
    const vendored: PickerCatalog = {
      nodeType: "setting", label: "Setting", catalogId: "setting", kind: "single", valueField: "setting",
      options: [
        legacyOption({ id: "shtiebel", label: "Shtiebel (Small Shul)", promptHint: "in a small prayer room" }),
        legacyOption({ id: "nowhere", label: "None", promptHint: "" }),
      ],
    }
    const out = composePickerCatalogs(base, [{ id: "legacy", catalogId: "setting", mode: "replace", catalog: vendored }])
    const terms = Object.fromEntries(out[0].options!.map((o: PickerOption) => [o.id, o.term]))
    // Parentheticals are stripped, and a no-op entry stays empty.
    expect(terms).toEqual({ shtiebel: "shtiebel", nowhere: "" })
  })

  it("a pack-added value injects in BOTH modes, never an empty compact fragment", () => {
    registerCatalogPack({
      id: "legacy", catalogId: "setting", mode: "extend",
      options: [legacyOption({ id: "shul-hall", label: "Shul Hall", promptHint: "in a synagogue hall" })],
    })
    // The registry view is what the hint path reads.
    const opt = getPickerCatalog("setting")!.options!.find((o: PickerOption) => o.id === "shul-hall")
    expect(opt?.term).toBe("shul hall")

    const node = { id: "n1", type: "setting", data: { setting: "shul-hall" } }
    expect(getParameterPromptHint(node)).toBe("in a synagogue hall")
    expect(getParameterPromptHint({ ...node, data: { ...node.data, hintMode: "compact" } })).toBe("shul hall")
  })
})
