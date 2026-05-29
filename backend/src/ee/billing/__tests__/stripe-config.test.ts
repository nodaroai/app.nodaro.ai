import { describe, it, expect } from "vitest"
import {
  STRIPE_PRODUCTS,
  PRICE_TO_PLAN,
  TOP_UPS,
  TIER_CREDITS,
  TIER_PARALLELISM,
  TIER_LLM_LIMITS,
  TIER_STORAGE_LIMITS,
  RETENTION_DAYS,
  FREE_TIER_RESTRICTIONS,
  getTierFromPriceId,
  getTopupCredits,
} from "../stripe-config.js"

describe("stripe-config", () => {
  describe("STRIPE_PRODUCTS", () => {
    it("has 4 tiers: basic, standard, pro, business", () => {
      const tiers = Object.keys(STRIPE_PRODUCTS)
      expect(tiers).toEqual(["basic", "standard", "pro", "business"])
    })

    it("each product has productId, monthly, yearly as non-empty strings", () => {
      for (const [tier, product] of Object.entries(STRIPE_PRODUCTS)) {
        expect(product.productId, `${tier}.productId`).toEqual(expect.any(String))
        expect(product.productId.length, `${tier}.productId length`).toBeGreaterThan(0)
        expect(product.monthly, `${tier}.monthly`).toEqual(expect.any(String))
        expect(product.monthly.length, `${tier}.monthly length`).toBeGreaterThan(0)
        expect(product.yearly, `${tier}.yearly`).toEqual(expect.any(String))
        expect(product.yearly.length, `${tier}.yearly length`).toBeGreaterThan(0)
      }
    })
  })

  describe("PRICE_TO_PLAN", () => {
    it("has 8 entries (4 tiers x 2 intervals)", () => {
      expect(Object.keys(PRICE_TO_PLAN)).toHaveLength(8)
    })

    it("every STRIPE_PRODUCTS price ID exists in PRICE_TO_PLAN", () => {
      for (const [tier, product] of Object.entries(STRIPE_PRODUCTS)) {
        expect(PRICE_TO_PLAN[product.monthly], `${tier} monthly`).toEqual({
          plan: tier,
          interval: "monthly",
        })
        expect(PRICE_TO_PLAN[product.yearly], `${tier} yearly`).toEqual({
          plan: tier,
          interval: "yearly",
        })
      }
    })
  })

  describe("TOP_UPS", () => {
    it("has 4 entries", () => {
      expect(Object.keys(TOP_UPS)).toHaveLength(4)
    })

    it("all credit values are positive", () => {
      for (const [priceId, credits] of Object.entries(TOP_UPS)) {
        expect(credits, priceId).toBeGreaterThan(0)
      }
    })
  })

  describe("TIER_CREDITS", () => {
    it("has free, basic, standard, pro, business tiers", () => {
      expect(Object.keys(TIER_CREDITS)).toEqual(
        expect.arrayContaining(["free", "basic", "standard", "pro", "business"])
      )
    })

    it("values are ascending from free to business", () => {
      expect(TIER_CREDITS.free).toBeLessThan(TIER_CREDITS.basic)
      expect(TIER_CREDITS.basic).toBeLessThan(TIER_CREDITS.standard)
      expect(TIER_CREDITS.standard).toBeLessThan(TIER_CREDITS.pro)
      expect(TIER_CREDITS.pro).toBeLessThan(TIER_CREDITS.business)
    })
  })

  describe("TIER_PARALLELISM", () => {
    it("values are ascending: free < basic < standard < pro < business", () => {
      expect(TIER_PARALLELISM.free).toBeLessThan(TIER_PARALLELISM.basic)
      expect(TIER_PARALLELISM.basic).toBeLessThan(TIER_PARALLELISM.standard)
      expect(TIER_PARALLELISM.standard).toBeLessThan(TIER_PARALLELISM.pro)
      expect(TIER_PARALLELISM.pro).toBeLessThan(TIER_PARALLELISM.business)
    })
  })

  describe("TIER_LLM_LIMITS", () => {
    it("business tier is Infinity", () => {
      expect(TIER_LLM_LIMITS.business).toBe(Infinity)
    })
  })

  describe("TIER_STORAGE_LIMITS", () => {
    it("values are ascending, enterprise > business", () => {
      expect(TIER_STORAGE_LIMITS.free).toBeLessThan(TIER_STORAGE_LIMITS.basic)
      expect(TIER_STORAGE_LIMITS.basic).toBeLessThan(TIER_STORAGE_LIMITS.standard)
      expect(TIER_STORAGE_LIMITS.standard).toBeLessThan(TIER_STORAGE_LIMITS.pro)
      expect(TIER_STORAGE_LIMITS.pro).toBeLessThan(TIER_STORAGE_LIMITS.business)
      expect(TIER_STORAGE_LIMITS.business).toBeLessThan(TIER_STORAGE_LIMITS.enterprise)
    })

    it("free tier is 1 GB", () => {
      expect(TIER_STORAGE_LIMITS.free).toBe(1 * 1024 * 1024 * 1024)
    })
  })

  describe("RETENTION_DAYS", () => {
    it("has free_media and canceled_grace", () => {
      expect(RETENTION_DAYS.free_media).toBe(60)
      expect(RETENTION_DAYS.canceled_grace).toBe(60)
    })
  })

  describe("FREE_TIER_RESTRICTIONS", () => {
    it("dailyCreditCap is 50", () => {
      expect(FREE_TIER_RESTRICTIONS.dailyCreditCap).toBe(50)
    })

    it("blockedModels includes veo3", () => {
      expect(FREE_TIER_RESTRICTIONS.blockedModels).toContain("veo3")
    })
  })

  describe("getTierFromPriceId", () => {
    it("returns basic for known basic monthly price", () => {
      expect(getTierFromPriceId(STRIPE_PRODUCTS.basic.monthly)).toBe("basic")
    })

    it("returns pro for known pro yearly price", () => {
      expect(getTierFromPriceId(STRIPE_PRODUCTS.pro.yearly)).toBe("pro")
    })

    it("returns free for unknown price ID", () => {
      expect(getTierFromPriceId("price_unknown_xyz")).toBe("free")
    })
  })

  describe("getTopupCredits", () => {
    it("returns 150 for the first topup price", () => {
      const firstPriceId = Object.keys(TOP_UPS)[0]
      expect(getTopupCredits(firstPriceId)).toBe(150)
    })

    it("returns 2200 for the last topup price", () => {
      const keys = Object.keys(TOP_UPS)
      const lastPriceId = keys[keys.length - 1]
      expect(getTopupCredits(lastPriceId)).toBe(2200)
    })

    it("returns null for unknown price ID", () => {
      expect(getTopupCredits("price_unknown_xyz")).toBeNull()
    })
  })
})
