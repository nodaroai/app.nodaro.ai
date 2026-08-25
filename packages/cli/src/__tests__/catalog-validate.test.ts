import { describe, it, expect } from "vitest"
import { validatePackSidecars } from "../lib/catalog-validate.js"
import type { CatalogSnapshot } from "../lib/catalog-snapshot.js"

const ALL = ["es", "fr", "de", "pt-BR", "ru", "hi", "ja", "ko", "zh-CN", "he", "ar"]
const snap: CatalogSnapshot = {
  catalogId: "person",
  kind: "multi",
  entries: [{ id: "sector-a", label: "A", promptHint: "a" }],
  sidecars: { he: { "sector-a": { label: "א" } } },
}

describe("validatePackSidecars", () => {
  it("reports missing non-exempt locales; exemptions are recorded, not failures", () => {
    const r = validatePackSidecars(snap, ALL, ["hi", "ja", "ko", "zh-CN", "ru", "ar", "es", "fr", "de", "pt-BR"])
    expect(r.ok).toBe(true) // he present, the rest declared-exempt
    expect(r.exempted).toContain("pt-BR")
    expect(r.missing).toEqual([])
  })
  it("ok=false when a non-exempt locale is missing", () => {
    const r = validatePackSidecars(snap, ALL, [])
    expect(r.ok).toBe(false)
    expect(r.missing.some((m) => m.locale === "es" && m.id === "sector-a")).toBe(true)
  })
})
