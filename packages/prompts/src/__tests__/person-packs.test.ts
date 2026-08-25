import { describe, it, expect, beforeEach } from "vitest"
import { getPerson, getPersonPromptHint, buildPersonHints, getPickerCatalog } from "../index.js"
import {
  registerPersonPack,
  resetPersonPacks,
  getRegisteredPersonDimensionOrder,
  getRegisteredPeople,
} from "../person-packs.js"
import { registerCatalogPack, resetCatalogPacks } from "../catalog-packs.js"
import { PEOPLE } from "../person.js"
import { getParameterValue, resolveLabel } from "@nodaro/shared"

beforeEach(() => {
  resetPersonPacks()
  resetCatalogPacks()
})

const pack = {
  id: "sai/person-sector",
  dimensions: [{ dimension: "sector-attire", field: "sectorAttire", label: "Sector Attire" }],
  entries: [
    {
      id: "attire-modest-suit",
      label: "Modest Suit",
      group: "Attire",
      dimension: "sector-attire",
      description: "a modest tailored suit",
      promptHint: "wearing a modest tailored suit",
    },
  ],
  sidecars: { he: { "attire-modest-suit": { label: "חליפה צנועה" } } },
  exemptSidecarLocales: ["hi", "ja", "ko", "zh-CN", "ru", "ar", "es", "fr", "de", "pt-BR"] as const,
}

describe("registerPersonPack", () => {
  it("makes the new entry resolvable via getPerson + getPersonPromptHint", () => {
    expect(getPerson("attire-modest-suit")).toBeUndefined()
    registerPersonPack(pack)
    expect(getPerson("attire-modest-suit")?.label).toBe("Modest Suit")
    expect(getPersonPromptHint("attire-modest-suit")).toBe("wearing a modest tailored suit")
  })

  it("adds the new dimension to the registered dimension order + person picker catalog", () => {
    registerPersonPack(pack)
    expect(getRegisteredPersonDimensionOrder()).toContain("sector-attire")
    const person = getPickerCatalog("person")!
    expect(person.fields).toContain("sectorAttire")
    expect(person.dimensions!.find((d) => d.field === "sectorAttire")!.options.map((o) => o.id)).toEqual([
      "attire-modest-suit",
    ])
  })

  it("composes the pack dimension's hint into buildPersonHints output", () => {
    registerPersonPack(pack)
    const hints = buildPersonHints({ sectorAttire: "attire-modest-suit" } as never)
    expect(hints).toContain("wearing a modest tailored suit")
  })

  it("base person behaviour is unchanged with no pack", () => {
    expect(getRegisteredPersonDimensionOrder()).not.toContain("sector-attire")
  })
})

describe("getRegisteredPeople honors deny/replace CatalogPacks on person", () => {
  it("deny pack removes a base person id from the registered set", () => {
    // "man" is a base person entry (person.ts type dim).
    expect(getRegisteredPeople().some((e) => e.id === "man")).toBe(true)
    registerCatalogPack({ id: "sai/person-deny", catalogId: "person", mode: "deny", denyIds: ["man", "woman"] })
    const ids = getRegisteredPeople().map((e) => e.id)
    expect(ids).not.toContain("man")
    expect(ids).not.toContain("woman")
    // a non-denied base entry survives
    expect(ids).toContain("not-defined")
  })

  it("deny is applied AFTER extend so the pack's own added entries survive an unrelated deny", () => {
    registerPersonPack(pack) // adds attire-modest-suit (sector-attire dim)
    registerCatalogPack({ id: "sai/person-deny", catalogId: "person", mode: "deny", denyIds: ["woman"] })
    const ids = getRegisteredPeople().map((e) => e.id)
    expect(ids).toContain("attire-modest-suit")
    expect(ids).not.toContain("woman")
  })

  it("replace pack reconstructs the person set from the vendored catalog (removed base ids gone)", () => {
    registerCatalogPack({
      id: "sai/person-replace",
      catalogId: "person",
      mode: "replace",
      catalog: {
        nodeType: "person",
        label: "Person",
        catalogId: "person",
        kind: "multi",
        fields: ["type"],
        dimensions: [
          { field: "type", label: "Type", options: [{ id: "man", label: "Man", promptHint: "a man", category: "Realistic" }] },
        ],
      },
    })
    const ids = getRegisteredPeople().map((e) => e.id)
    expect(ids).toEqual(["man"]) // only the vendored copy; every other base entry is gone
    const reconstructed = getRegisteredPeople()[0]
    expect(reconstructed.dimension).toBe("type") // field "type" reverse-maps to dimension "type"
    expect(reconstructed.group).toBe("Realistic") // category -> group
  })

  it("no packs registered = base PEOPLE unchanged (mainline inert)", () => {
    expect(getRegisteredPeople().map((e) => e.id)).toEqual(PEOPLE.map((e) => e.id))
  })
})

/** Every id the composed "person" catalog exposes (what /v1/catalogs + MCP read). */
function composedPersonIds(): Set<string> {
  const cat = getPickerCatalog("person")!
  return new Set((cat.dimensions ?? []).flatMap((d) => d.options.map((o) => o.id)))
}
/** Every id the picker-ui grids read. */
function gridPersonIds(): Set<string> {
  return new Set(getRegisteredPeople().map((e) => e.id))
}

describe("person grid and /v1/catalogs share one curation source (no drift)", () => {
  it("a denied id is absent from BOTH consumers", () => {
    // present in both before deny
    expect(gridPersonIds().has("woman")).toBe(true)
    expect(composedPersonIds().has("woman")).toBe(true)
    registerCatalogPack({ id: "sai/deny", catalogId: "person", mode: "deny", denyIds: ["woman", "beautiful-woman"] })
    for (const id of ["woman", "beautiful-woman"]) {
      expect(gridPersonIds().has(id)).toBe(false)
      expect(composedPersonIds().has(id)).toBe(false)
    }
  })
  it("an extended id is present in BOTH consumers", () => {
    registerPersonPack(pack) // adds attire-modest-suit
    expect(gridPersonIds().has("attire-modest-suit")).toBe(true)
    expect(composedPersonIds().has("attire-modest-suit")).toBe(true)
  })
  it("extend + deny together: pack entry present in both, denied base absent from both", () => {
    registerPersonPack(pack)
    registerCatalogPack({ id: "sai/deny", catalogId: "person", mode: "deny", denyIds: ["woman"] })
    expect(gridPersonIds().has("attire-modest-suit")).toBe(true)
    expect(composedPersonIds().has("attire-modest-suit")).toBe(true)
    expect(gridPersonIds().has("woman")).toBe(false)
    expect(composedPersonIds().has("woman")).toBe(false)
  })
})

describe("registerPersonPack wires getParameterValue (G4)", () => {
  it("registerPersonPack makes its dimension resolve in getParameterValue (G4)", () => {
    expect(getParameterValue({ sectorAttire: "attire-modest-suit" }, "person")).toBeUndefined()
    registerPersonPack(pack)
    expect(getParameterValue({ sectorAttire: "attire-modest-suit" }, "person")).toBe("attire-modest-suit")
    resetPersonPacks()
    expect(getParameterValue({ sectorAttire: "attire-modest-suit" }, "person")).toBeUndefined()
  })
})

describe("registerPersonPack wires pack sidecars into the localizer (G10)", () => {
  it("a registered person pack's Hebrew sidecar resolves in the localizer (G10)", () => {
    // The fixture `pack` carries a `he` sidecar for attire-modest-suit; before
    // registration the localizer has no entry and falls back to English.
    expect(resolveLabel("person", "attire-modest-suit", "Modest Suit", "he")).toBe("Modest Suit")
    registerPersonPack(pack)
    expect(resolveLabel("person", "attire-modest-suit", "Modest Suit", "he")).toBe("חליפה צנועה")
  })
})
