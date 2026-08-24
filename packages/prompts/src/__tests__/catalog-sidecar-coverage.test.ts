import { describe, it, expect } from "vitest"
import { computePackSidecarCoverage } from "../catalog-sidecar-coverage.js"
import type { CatalogPack } from "../catalog-packs.js"

const pack: CatalogPack = {
  id: "sai/setting", catalogId: "setting", mode: "extend",
  options: [{ id: "shul-hall", label: "Shul Hall", promptHint: "in a synagogue hall" }],
  sidecars: { he: { "shul-hall": { label: "אולם בית כנסת" } } },      // he present
  exemptSidecarLocales: ["hi", "ja", "ko", "zh-CN", "ru", "ar"],       // declared exemption
}

describe("computePackSidecarCoverage", () => {
  it("reports missing non-exempt locales and lists the declared exemptions", () => {
    const r = computePackSidecarCoverage(pack)
    // he ok; hi/ja/ko/zh-CN/ru/ar exempt; es/fr/de/pt-BR missing (1 entry each)
    expect(r.exempted.map((e) => e.locale).sort()).toEqual(["ar", "hi", "ja", "ko", "ru", "zh-CN"].sort())
    expect(r.missing.map((m) => m.locale).sort()).toEqual(["de", "es", "fr", "pt-BR"].sort())
    expect(r.missing.every((m) => m.id === "shul-hall")).toBe(true)
  })

  it("full 11-locale coverage yields zero missing", () => {
    const locales = ["es","fr","de","pt-BR","ru","hi","ja","ko","zh-CN","he","ar"] as const
    const full: CatalogPack = { ...pack, exemptSidecarLocales: [],
      sidecars: Object.fromEntries(locales.map((l) => [l, { "shul-hall": { label: "x" } }])) }
    expect(computePackSidecarCoverage(full).missing).toEqual([])
  })
})
