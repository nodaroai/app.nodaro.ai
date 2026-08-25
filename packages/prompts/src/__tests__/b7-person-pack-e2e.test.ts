import { describe, it, expect, beforeEach } from "vitest"
import { registerPersonPack, resetPersonPacks } from "../person-packs.js"
import { resetCatalogPacks, getRegisteredCatalogPacks } from "../catalog-packs.js"
import { getRegisteredPickerCatalogs, projectAllCatalogs } from "../picker-catalogs.js"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"
import { computePackSidecarCoverage } from "../catalog-sidecar-coverage.js"
import { PERSON_SECTOR_PACK } from "./fixtures/person-sector-pack.js"

beforeEach(() => {
  resetPersonPacks()
  resetCatalogPacks()
})

describe("B7 person pack — one registration, every read kind", () => {
  it("enumerates in the registered person catalog + /v1/catalogs projection", () => {
    registerPersonPack(PERSON_SECTOR_PACK)
    const person = getRegisteredPickerCatalogs().find((c) => c.catalogId === "person")!
    expect(person.dimensions!.some((d) => d.field === "sectorAttire")).toBe(true)
    const projected = projectAllCatalogs().find((c) => c.catalogId === "person")!
    expect(projected.dimensions!.some((d) => d.options.some((o) => o.id === "attire-modest-suit"))).toBe(true)
  })

  it("composes a hint for the pack dimension", () => {
    registerPersonPack(PERSON_SECTOR_PACK)
    expect(
      getParameterPromptHint({ id: "n1", type: "person", data: { sectorAttire: "attire-modest-suit" } }),
    ).toContain("modest tailored suit")
  })

  it("reports the declared sidecar exemption (not a failure)", () => {
    registerPersonPack(PERSON_SECTOR_PACK)
    const pack = getRegisteredCatalogPacks().find((p) => p.id === PERSON_SECTOR_PACK.id)!
    const cov = computePackSidecarCoverage(pack)
    expect(cov.exempted.length).toBeGreaterThan(0) // e.g. hi/ja/ko/zh-CN/ru/ar declared exempt
    expect(cov.missing.filter((m) => m.locale === "he")).toEqual([]) // he provided
  })
})
