import { describe, it, expect, afterEach } from "vitest"
import { registerCatalogSidecars, resetCatalogSidecars, resolveLabel, entryMatchesQuery } from "../index.js"

afterEach(() => resetCatalogSidecars())

describe("pack sidecars resolve through the shared localizer (G10)", () => {
  it("resolveLabel returns a pack-registered localized label", () => {
    // English fallback before registration
    expect(resolveLabel("person", "attire-x", "Modest Suit", "he")).toBe("Modest Suit")
    registerCatalogSidecars("person", { he: { "attire-x": { label: "חליפה צנועה" } } })
    expect(resolveLabel("person", "attire-x", "Modest Suit", "he")).toBe("חליפה צנועה")
  })
  it("english locale ignores sidecars", () => {
    registerCatalogSidecars("person", { he: { "attire-x": { label: "חליפה צנועה" } } })
    expect(resolveLabel("person", "attire-x", "Modest Suit", "en")).toBe("Modest Suit")
  })
  it("search matches the localized pack label", () => {
    registerCatalogSidecars("person", { he: { "attire-x": { label: "חליפה צנועה" } } })
    expect(entryMatchesQuery("person", "attire-x", "Modest Suit", "d", "he", "חליפה")).toBe(true)
  })
})
