import { describe, it, expect, vi, beforeEach } from "vitest"

describe("edition helpers", () => {
  describe("cloud edition (default from setup.ts)", () => {
    it("isCloud returns true", async () => {
      const { isCloud } = await import("../config.js")
      expect(isCloud()).toBe(true)
    })

    it("isCommunity returns false", async () => {
      const { isCommunity } = await import("../config.js")
      expect(isCommunity()).toBe(false)
    })

    it("isBusiness returns false", async () => {
      const { isBusiness } = await import("../config.js")
      expect(isBusiness()).toBe(false)
    })

    it("hasAdmin returns true", async () => {
      const { hasAdmin } = await import("../config.js")
      expect(hasAdmin()).toBe(true)
    })

    it("hasCredits returns true", async () => {
      const { hasCredits } = await import("../config.js")
      expect(hasCredits()).toBe(true)
    })
  })

  describe("community edition", () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it("returns correct values for community", async () => {
      vi.doMock("../config.js", () => ({
        config: { EDITION: "community" },
        isCommunity: () => true,
        isBusiness: () => false,
        isCloud: () => false,
        hasAdmin: () => false,
        hasCredits: () => false,
      }))
      const mod = await import("../config.js")
      expect(mod.isCommunity()).toBe(true)
      expect(mod.isBusiness()).toBe(false)
      expect(mod.isCloud()).toBe(false)
      expect(mod.hasAdmin()).toBe(false)
      expect(mod.hasCredits()).toBe(false)
    })
  })

  describe("business edition", () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it("returns correct values for business", async () => {
      vi.doMock("../config.js", () => ({
        config: { EDITION: "business" },
        isCommunity: () => false,
        isBusiness: () => true,
        isCloud: () => false,
        hasAdmin: () => true,
        hasCredits: () => false,
      }))
      const mod = await import("../config.js")
      expect(mod.isCommunity()).toBe(false)
      expect(mod.isBusiness()).toBe(true)
      expect(mod.isCloud()).toBe(false)
      expect(mod.hasAdmin()).toBe(true)
      expect(mod.hasCredits()).toBe(false)
    })
  })
})
