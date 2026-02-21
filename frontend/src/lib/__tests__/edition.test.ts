import { describe, it, expect, vi, beforeEach } from "vitest"

describe("edition helpers", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function loadEdition(edition: string) {
    vi.stubEnv("VITE_EDITION", edition)
    return await import("../edition")
  }

  describe("community edition", () => {
    it("returns correct values for all helpers", async () => {
      const mod = await loadEdition("community")
      expect(mod.EDITION).toBe("community")
      expect(mod.isCommunity()).toBe(true)
      expect(mod.isBusiness()).toBe(false)
      expect(mod.isCloud()).toBe(false)
      expect(mod.hasAdmin()).toBe(false)
      expect(mod.hasCredits()).toBe(false)
      expect(mod.hasUserManagement()).toBe(false)
    })

    it("has correct feature flags", async () => {
      const mod = await loadEdition("community")
      expect(mod.features.adminPanel).toBe(false)
      expect(mod.features.usersManagement).toBe(false)
      expect(mod.features.creditsSystem).toBe(false)
      expect(mod.features.billing).toBe(false)
      expect(mod.features.providerSelection).toBe(false)
      expect(mod.features.costMarkup).toBe(false)
    })
  })

  describe("business edition", () => {
    it("returns correct values for all helpers", async () => {
      const mod = await loadEdition("business")
      expect(mod.EDITION).toBe("business")
      expect(mod.isCommunity()).toBe(false)
      expect(mod.isBusiness()).toBe(true)
      expect(mod.isCloud()).toBe(false)
      expect(mod.hasAdmin()).toBe(true)
      expect(mod.hasCredits()).toBe(false)
      expect(mod.hasUserManagement()).toBe(true)
    })

    it("has correct feature flags", async () => {
      const mod = await loadEdition("business")
      expect(mod.features.adminPanel).toBe(true)
      expect(mod.features.usersManagement).toBe(true)
      expect(mod.features.creditsSystem).toBe(false)
      expect(mod.features.billing).toBe(false)
      expect(mod.features.providerSelection).toBe(false)
      expect(mod.features.costMarkup).toBe(false)
    })
  })

  describe("cloud edition", () => {
    it("returns correct values for all helpers", async () => {
      const mod = await loadEdition("cloud")
      expect(mod.EDITION).toBe("cloud")
      expect(mod.isCommunity()).toBe(false)
      expect(mod.isBusiness()).toBe(false)
      expect(mod.isCloud()).toBe(true)
      expect(mod.hasAdmin()).toBe(true)
      expect(mod.hasCredits()).toBe(true)
      expect(mod.hasUserManagement()).toBe(true)
    })

    it("has correct feature flags", async () => {
      const mod = await loadEdition("cloud")
      expect(mod.features.adminPanel).toBe(true)
      expect(mod.features.usersManagement).toBe(true)
      expect(mod.features.creditsSystem).toBe(true)
      expect(mod.features.billing).toBe(true)
      expect(mod.features.providerSelection).toBe(true)
      expect(mod.features.costMarkup).toBe(true)
    })
  })

  describe("default (no env var)", () => {
    it("defaults to community when VITE_EDITION is empty", async () => {
      vi.stubEnv("VITE_EDITION", "")
      vi.resetModules()
      const mod = await import("../edition")
      expect(mod.EDITION).toBe("community")
      expect(mod.isCommunity()).toBe(true)
      expect(mod.hasAdmin()).toBe(false)
      expect(mod.hasCredits()).toBe(false)
    })
  })

  describe("isFeatureEnabled", () => {
    it("returns true for enabled features in cloud", async () => {
      const mod = await loadEdition("cloud")
      expect(mod.isFeatureEnabled("adminPanel")).toBe(true)
      expect(mod.isFeatureEnabled("creditsSystem")).toBe(true)
      expect(mod.isFeatureEnabled("billing")).toBe(true)
      expect(mod.isFeatureEnabled("providerSelection")).toBe(true)
    })

    it("returns false for disabled features in community", async () => {
      const mod = await loadEdition("community")
      expect(mod.isFeatureEnabled("adminPanel")).toBe(false)
      expect(mod.isFeatureEnabled("creditsSystem")).toBe(false)
      expect(mod.isFeatureEnabled("billing")).toBe(false)
    })
  })
})
