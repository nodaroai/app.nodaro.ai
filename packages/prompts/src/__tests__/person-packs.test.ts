import { describe, it, expect, beforeEach } from "vitest"
import { getPerson, getPersonPromptHint, buildPersonHints, getPickerCatalog } from "../index.js"
import { registerPersonPack, resetPersonPacks, getRegisteredPersonDimensionOrder } from "../person-packs.js"
import { resetCatalogPacks } from "../catalog-packs.js"

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
