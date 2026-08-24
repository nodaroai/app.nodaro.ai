import { describe, it, expect, beforeEach } from "vitest"
import { projectAllCatalogs } from "../picker-catalogs.js"
import { registerCatalogPack, resetCatalogPacks } from "../catalog-packs.js"

beforeEach(() => resetCatalogPacks())

describe("projectAllCatalogs", () => {
  it("projects every registered catalog, compact by default, with no promptHint/description", () => {
    const all = projectAllCatalogs()
    const setting = all.find((c) => c.catalogId === "setting")!
    expect(setting.detail).toBe("compact")
    expect(setting.options![0]).not.toHaveProperty("promptHint")
    expect(setting.options![0]).not.toHaveProperty("description")
  })

  it("detail:full carries promptHint + description", () => {
    const setting = projectAllCatalogs({ detail: "full" }).find((c) => c.catalogId === "setting")!
    expect(setting.options![0]).toHaveProperty("promptHint")
  })

  it("reflects a registered pack (server-driven curation)", () => {
    registerCatalogPack({ id: "sai/deny", catalogId: "setting", mode: "deny", denyIds: ["forest"] })
    const setting = projectAllCatalogs().find((c) => c.catalogId === "setting")!
    expect(setting.options!.some((o) => o.id === "forest")).toBe(false)
  })
})
