import { describe, it, expect } from "vitest"
import {
  PADDLE_PRICES,
  PRICE_TO_TIER,
  TIER_CREDITS,
  TIER_STORAGE_LIMITS,
  FREE_TIER_RESTRICTIONS,
  getTierFromPriceId,
  getTopupCredits,
  TOPUP_CREDITS,
} from "../paddle-config.js"

describe("paddle-config", () => {
  // ── getTierFromPriceId ──

  describe("getTierFromPriceId", () => {
    it("returns 'basic' for the basic monthly price ID", () => {
      expect(getTierFromPriceId(PADDLE_PRICES.basic_monthly)).toBe("basic")
    })

    it("returns 'standard' for the standard monthly price ID", () => {
      expect(getTierFromPriceId(PADDLE_PRICES.standard_monthly)).toBe("standard")
    })

    it("returns 'pro' for the pro monthly price ID", () => {
      expect(getTierFromPriceId(PADDLE_PRICES.pro_monthly)).toBe("pro")
    })

    it("returns 'business' for the business monthly price ID", () => {
      expect(getTierFromPriceId(PADDLE_PRICES.business_monthly)).toBe("business")
    })

    it("returns 'free' for an unknown price ID", () => {
      expect(getTierFromPriceId("pri_unknown_id")).toBe("free")
    })

    it("returns 'free' for an empty string", () => {
      expect(getTierFromPriceId("")).toBe("free")
    })
  })

  // ── getTopupCredits ──

  describe("getTopupCredits", () => {
    it("returns 275 for the credits_55 price ID", () => {
      expect(getTopupCredits(PADDLE_PRICES.credits_55)).toBe(275)
    })

    it("returns 750 for the credits_150 price ID", () => {
      expect(getTopupCredits(PADDLE_PRICES.credits_150)).toBe(750)
    })

    it("returns 1650 for the credits_330 price ID", () => {
      expect(getTopupCredits(PADDLE_PRICES.credits_330)).toBe(1650)
    })

    it("returns 3500 for the credits_700 price ID", () => {
      expect(getTopupCredits(PADDLE_PRICES.credits_700)).toBe(3500)
    })

    it("returns null for an unknown price ID", () => {
      expect(getTopupCredits("pri_unknown_topup")).toBeNull()
    })

    it("returns null for a subscription price ID (not a topup)", () => {
      expect(getTopupCredits(PADDLE_PRICES.basic_monthly)).toBeNull()
    })
  })

  // ── TIER_CREDITS ──

  describe("TIER_CREDITS", () => {
    it("has credit allocations for all 5 tiers", () => {
      expect(Object.keys(TIER_CREDITS)).toHaveLength(5)
      expect(TIER_CREDITS).toHaveProperty("free")
      expect(TIER_CREDITS).toHaveProperty("basic")
      expect(TIER_CREDITS).toHaveProperty("standard")
      expect(TIER_CREDITS).toHaveProperty("pro")
      expect(TIER_CREDITS).toHaveProperty("business")
    })

    it("has correct credit values for each tier", () => {
      expect(TIER_CREDITS.free).toBe(250)
      expect(TIER_CREDITS.basic).toBe(475)
      expect(TIER_CREDITS.standard).toBe(1175)
      expect(TIER_CREDITS.pro).toBe(2650)
      expect(TIER_CREDITS.business).toBe(5600)
    })

    it("has credits in ascending order by tier", () => {
      expect(TIER_CREDITS.free).toBeLessThan(TIER_CREDITS.basic)
      expect(TIER_CREDITS.basic).toBeLessThan(TIER_CREDITS.standard)
      expect(TIER_CREDITS.standard).toBeLessThan(TIER_CREDITS.pro)
      expect(TIER_CREDITS.pro).toBeLessThan(TIER_CREDITS.business)
    })
  })

  // ── TIER_STORAGE_LIMITS ──

  describe("TIER_STORAGE_LIMITS", () => {
    const GB = 1024 * 1024 * 1024

    it("has storage limits for all 6 tiers including enterprise", () => {
      expect(Object.keys(TIER_STORAGE_LIMITS)).toHaveLength(6)
      expect(TIER_STORAGE_LIMITS).toHaveProperty("free")
      expect(TIER_STORAGE_LIMITS).toHaveProperty("basic")
      expect(TIER_STORAGE_LIMITS).toHaveProperty("standard")
      expect(TIER_STORAGE_LIMITS).toHaveProperty("pro")
      expect(TIER_STORAGE_LIMITS).toHaveProperty("business")
      expect(TIER_STORAGE_LIMITS).toHaveProperty("enterprise")
    })

    it("has correct storage values in bytes", () => {
      expect(TIER_STORAGE_LIMITS.free).toBe(1 * GB)
      expect(TIER_STORAGE_LIMITS.basic).toBe(10 * GB)
      expect(TIER_STORAGE_LIMITS.standard).toBe(25 * GB)
      expect(TIER_STORAGE_LIMITS.pro).toBe(50 * GB)
      expect(TIER_STORAGE_LIMITS.business).toBe(200 * GB)
      expect(TIER_STORAGE_LIMITS.enterprise).toBe(500 * GB)
    })

    it("has limits in ascending order by tier", () => {
      expect(TIER_STORAGE_LIMITS.free).toBeLessThan(TIER_STORAGE_LIMITS.basic)
      expect(TIER_STORAGE_LIMITS.basic).toBeLessThan(TIER_STORAGE_LIMITS.standard)
      expect(TIER_STORAGE_LIMITS.standard).toBeLessThan(TIER_STORAGE_LIMITS.pro)
      expect(TIER_STORAGE_LIMITS.pro).toBeLessThan(TIER_STORAGE_LIMITS.business)
      expect(TIER_STORAGE_LIMITS.business).toBeLessThan(TIER_STORAGE_LIMITS.enterprise)
    })
  })

  // ── FREE_TIER_RESTRICTIONS ──

  describe("FREE_TIER_RESTRICTIONS", () => {
    it("has a daily credit cap of 50", () => {
      expect(FREE_TIER_RESTRICTIONS.dailyCreditCap).toBe(50)
    })

    it("blocks veo3, veo3.1, and sora2-pro models", () => {
      expect(FREE_TIER_RESTRICTIONS.blockedModels).toContain("veo3")
      expect(FREE_TIER_RESTRICTIONS.blockedModels).toContain("veo3.1")
      expect(FREE_TIER_RESTRICTIONS.blockedModels).toContain("sora2-pro")
      expect(FREE_TIER_RESTRICTIONS.blockedModels).toHaveLength(3)
    })

    it("has watermark enabled", () => {
      expect(FREE_TIER_RESTRICTIONS.watermark).toBe(true)
    })
  })

  // ── PRICE_TO_TIER mapping ──

  describe("PRICE_TO_TIER", () => {
    it("maps all 4 subscription price IDs to their tiers", () => {
      expect(Object.keys(PRICE_TO_TIER)).toHaveLength(4)
      expect(PRICE_TO_TIER[PADDLE_PRICES.basic_monthly]).toBe("basic")
      expect(PRICE_TO_TIER[PADDLE_PRICES.standard_monthly]).toBe("standard")
      expect(PRICE_TO_TIER[PADDLE_PRICES.pro_monthly]).toBe("pro")
      expect(PRICE_TO_TIER[PADDLE_PRICES.business_monthly]).toBe("business")
    })
  })

  // ── TOPUP_CREDITS mapping ──

  describe("TOPUP_CREDITS", () => {
    it("maps all 4 topup price IDs to credit amounts", () => {
      expect(Object.keys(TOPUP_CREDITS)).toHaveLength(4)
      expect(TOPUP_CREDITS[PADDLE_PRICES.credits_55]).toBe(275)
      expect(TOPUP_CREDITS[PADDLE_PRICES.credits_150]).toBe(750)
      expect(TOPUP_CREDITS[PADDLE_PRICES.credits_330]).toBe(1650)
      expect(TOPUP_CREDITS[PADDLE_PRICES.credits_700]).toBe(3500)
    })
  })
})
