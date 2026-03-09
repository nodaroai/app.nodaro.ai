import { describe, it, expect } from "vitest"
import {
  PRICING_TIERS,
  TIER_STORAGE_BYTES,
  TOPUP_PACKAGES,
  getTierPrice,
  getTierPriceId,
  getAnnualSavingsPercent,
  getBillingCycleFromPriceId,
} from "../pricing-data"
import type { PricingTier } from "../pricing-data"

describe("PRICING_TIERS", () => {
  it("has exactly 5 tiers", () => {
    expect(PRICING_TIERS).toHaveLength(5)
  })

  it("tiers are in order: free, basic, standard, pro, business", () => {
    expect(PRICING_TIERS.map((t) => t.id)).toEqual([
      "free",
      "basic",
      "standard",
      "pro",
      "business",
    ])
  })

  it("every tier has required fields", () => {
    for (const tier of PRICING_TIERS) {
      expect(tier.id).toBeTruthy()
      expect(tier.name).toBeTruthy()
      expect(typeof tier.priceMonthly).toBe("number")
      expect(typeof tier.priceAnnual).toBe("number")
      expect(typeof tier.credits).toBe("number")
      expect(tier.storage).toBeTruthy()
      expect(tier.features.length).toBeGreaterThan(0)
      expect(tier.cta).toBeTruthy()
    }
  })

  it("free tier has zero prices and null price IDs", () => {
    const free = PRICING_TIERS[0]
    expect(free.priceMonthly).toBe(0)
    expect(free.priceAnnual).toBe(0)
    expect(free.priceIdMonthly).toBeNull()
    expect(free.priceIdAnnual).toBeNull()
  })

  it("paid tiers have positive prices", () => {
    for (const tier of PRICING_TIERS.slice(1)) {
      expect(tier.priceMonthly).toBeGreaterThan(0)
      expect(tier.priceAnnual).toBeGreaterThan(0)
    }
  })

  it("annual price is always <= monthly price", () => {
    for (const tier of PRICING_TIERS) {
      expect(tier.priceAnnual).toBeLessThanOrEqual(tier.priceMonthly)
    }
  })

  it("credits increase with each tier", () => {
    for (let i = 1; i < PRICING_TIERS.length; i++) {
      expect(PRICING_TIERS[i].credits).toBeGreaterThan(PRICING_TIERS[i - 1].credits)
    }
  })

  it("only pro tier is highlighted", () => {
    for (const tier of PRICING_TIERS) {
      if (tier.id === "pro") {
        expect(tier.highlighted).toBe(true)
      } else {
        expect(tier.highlighted).toBeFalsy()
      }
    }
  })

  it("business tier has unlimited LLM requests (null)", () => {
    const biz = PRICING_TIERS.find((t) => t.id === "business")!
    expect(biz.llmRequests).toBeNull()
  })
})

describe("TIER_STORAGE_BYTES", () => {
  it("has entries for free, basic, standard, pro, business, enterprise", () => {
    expect(Object.keys(TIER_STORAGE_BYTES)).toEqual(
      expect.arrayContaining(["free", "basic", "standard", "pro", "business", "enterprise"])
    )
  })

  it("free tier is 1 GB", () => {
    expect(TIER_STORAGE_BYTES.free).toBe(1 * 1024 * 1024 * 1024)
  })

  it("basic tier is 10 GB", () => {
    expect(TIER_STORAGE_BYTES.basic).toBe(10 * 1024 * 1024 * 1024)
  })

  it("standard tier is 25 GB", () => {
    expect(TIER_STORAGE_BYTES.standard).toBe(25 * 1024 * 1024 * 1024)
  })

  it("pro tier is 50 GB", () => {
    expect(TIER_STORAGE_BYTES.pro).toBe(50 * 1024 * 1024 * 1024)
  })

  it("business tier is 200 GB", () => {
    expect(TIER_STORAGE_BYTES.business).toBe(200 * 1024 * 1024 * 1024)
  })

  it("enterprise tier is 500 GB", () => {
    expect(TIER_STORAGE_BYTES.enterprise).toBe(500 * 1024 * 1024 * 1024)
  })

  it("values increase with tier level", () => {
    expect(TIER_STORAGE_BYTES.free).toBeLessThan(TIER_STORAGE_BYTES.basic)
    expect(TIER_STORAGE_BYTES.basic).toBeLessThan(TIER_STORAGE_BYTES.standard)
    expect(TIER_STORAGE_BYTES.standard).toBeLessThan(TIER_STORAGE_BYTES.pro)
    expect(TIER_STORAGE_BYTES.pro).toBeLessThan(TIER_STORAGE_BYTES.business)
    expect(TIER_STORAGE_BYTES.business).toBeLessThan(TIER_STORAGE_BYTES.enterprise)
  })
})

describe("getTierPrice", () => {
  const tier: PricingTier = PRICING_TIERS.find((t) => t.id === "pro")!

  it("returns monthly price for monthly cycle", () => {
    expect(getTierPrice(tier, "monthly")).toBe(59)
  })

  it("returns annual price for annual cycle", () => {
    expect(getTierPrice(tier, "annual")).toBe(49)
  })

  it("returns 0 for free tier regardless of cycle", () => {
    const free = PRICING_TIERS[0]
    expect(getTierPrice(free, "monthly")).toBe(0)
    expect(getTierPrice(free, "annual")).toBe(0)
  })
})

describe("getTierPriceId", () => {
  it("returns monthly price ID for monthly cycle", () => {
    const basic = PRICING_TIERS.find((t) => t.id === "basic")!
    expect(getTierPriceId(basic, "monthly")).toBe(basic.priceIdMonthly)
  })

  it("returns annual price ID for annual cycle", () => {
    const basic = PRICING_TIERS.find((t) => t.id === "basic")!
    expect(getTierPriceId(basic, "annual")).toBe(basic.priceIdAnnual)
  })

  it("returns null for free tier price IDs", () => {
    const free = PRICING_TIERS[0]
    expect(getTierPriceId(free, "monthly")).toBeNull()
    expect(getTierPriceId(free, "annual")).toBeNull()
  })
})

describe("getAnnualSavingsPercent", () => {
  it("returns 0 for free tier", () => {
    const free = PRICING_TIERS[0]
    expect(getAnnualSavingsPercent(free)).toBe(0)
  })

  it("returns correct savings for basic tier", () => {
    const basic = PRICING_TIERS.find((t) => t.id === "basic")!
    // (12 - 9) / 12 * 100 = 25%
    expect(getAnnualSavingsPercent(basic)).toBe(Math.round(((12 - 9) / 12) * 100))
  })

  it("returns correct savings for pro tier", () => {
    const pro = PRICING_TIERS.find((t) => t.id === "pro")!
    // (59 - 49) / 59 * 100 = ~17%
    expect(getAnnualSavingsPercent(pro)).toBe(Math.round(((59 - 49) / 59) * 100))
  })

  it("returns positive savings for all paid tiers", () => {
    for (const tier of PRICING_TIERS.slice(1)) {
      expect(getAnnualSavingsPercent(tier)).toBeGreaterThan(0)
    }
  })
})

describe("getBillingCycleFromPriceId", () => {
  it("returns annual for null", () => {
    expect(getBillingCycleFromPriceId(null)).toBe("annual")
  })

  it("returns annual for undefined", () => {
    expect(getBillingCycleFromPriceId(undefined)).toBe("annual")
  })

  it("returns annual for unknown price ID", () => {
    expect(getBillingCycleFromPriceId("pri_unknown_id")).toBe("annual")
  })

  it("returns annual for known annual price ID", () => {
    const basic = PRICING_TIERS.find((t) => t.id === "basic")!
    if (basic.priceIdAnnual) {
      expect(getBillingCycleFromPriceId(basic.priceIdAnnual)).toBe("annual")
    }
  })

  it("returns monthly for known monthly price ID", () => {
    const withMonthly = PRICING_TIERS.find((t) => t.priceIdMonthly !== null)
    if (withMonthly) {
      expect(getBillingCycleFromPriceId(withMonthly.priceIdMonthly)).toBe("monthly")
    }
  })
})

describe("TOPUP_PACKAGES", () => {
  it("has exactly 4 packages", () => {
    expect(TOPUP_PACKAGES).toHaveLength(4)
  })

  it("packages have required fields", () => {
    for (const pkg of TOPUP_PACKAGES) {
      expect(pkg.id).toBeTruthy()
      expect(pkg.priceId).toBeTruthy()
      expect(pkg.credits).toBeGreaterThan(0)
      expect(pkg.price).toBeGreaterThan(0)
      expect(pkg.perCredit).toMatch(/^\$\d+\.\d{2}$/)
    }
  })

  it("package IDs are topup_10, topup_25, topup_50, topup_100", () => {
    expect(TOPUP_PACKAGES.map((p) => p.id)).toEqual([
      "topup_10",
      "topup_25",
      "topup_50",
      "topup_100",
    ])
  })

  it("only topup_25 is popular", () => {
    for (const pkg of TOPUP_PACKAGES) {
      if (pkg.id === "topup_25") {
        expect(pkg.popular).toBe(true)
      } else {
        expect(pkg.popular).toBeFalsy()
      }
    }
  })

  it("credits increase with price", () => {
    for (let i = 1; i < TOPUP_PACKAGES.length; i++) {
      expect(TOPUP_PACKAGES[i].credits).toBeGreaterThan(TOPUP_PACKAGES[i - 1].credits)
      expect(TOPUP_PACKAGES[i].price).toBeGreaterThan(TOPUP_PACKAGES[i - 1].price)
    }
  })
})
