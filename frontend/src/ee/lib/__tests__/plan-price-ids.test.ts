import { describe, it, expect } from "vitest"
import type { BillingPlansResult } from "@nodaro/sdk/billing"
import { PRICING_TIERS, TOPUP_PACKAGES } from "@/lib/pricing-data"
import { packCheckoutPriceId, planCheckoutPriceId, subscriptionTierId } from "../plan-price-ids"

/**
 * A checkout sends only the price this deployment lists (GET /v1/billing/plans),
 * so a deployment on Stripe's test mode checks out its test prices. The display
 * table's live ids are never sent: while the list is not here, or when it names
 * no price for a plan or pack, there is no id, and the purchase says so.
 */

const basic = PRICING_TIERS.find((t) => t.id === "basic")!
const pack10 = TOPUP_PACKAGES.find((p) => p.credits === 3300)!

const TEST_PLANS: BillingPlansResult = {
  data: [
    { id: "free", name: "Free", prices: null, signupCredits: 1500, parallelism: 1, storageBytes: 1 },
    {
      id: "basic",
      name: "Basic",
      prices: {
        monthly: { amount: 12, currency: "USD", priceId: "price_TestBasicM", credits: null },
        yearly: { amount: 120, currency: "USD", priceId: "price_TestBasicY", perMonth: 10, credits: null },
      },
      signupCredits: null,
      parallelism: 2,
      storageBytes: 1,
    },
  ],
  topUps: [{ id: "topup-10", credits: 3300, price: { amount: 10, currency: "USD" }, priceId: "price_TestPack10" }],
  topUpRange: { min: 5, max: 500, currency: "usd" },
}

describe("planCheckoutPriceId", () => {
  it("is the price the deployment lists", () => {
    expect(planCheckoutPriceId(basic, "monthly", TEST_PLANS)).toBe("price_TestBasicM")
    expect(planCheckoutPriceId(basic, "annual", TEST_PLANS)).toBe("price_TestBasicY")
  })

  it("is none, never the display table's live id, while the list is not here or names no price", () => {
    expect(planCheckoutPriceId(basic, "monthly", undefined)).toBeNull()
    const unavailable = { ...TEST_PLANS, data: [{ ...TEST_PLANS.data[1], prices: { monthly: null, yearly: null } }] }
    expect(planCheckoutPriceId(basic, "annual", unavailable)).toBeNull()
    expect(planCheckoutPriceId(basic, "monthly", { ...TEST_PLANS, data: [] })).toBeNull()
  })
})

describe("packCheckoutPriceId", () => {
  it("is the listed pack that grants the same credits", () => {
    expect(packCheckoutPriceId(pack10, TEST_PLANS)).toBe("price_TestPack10")
  })

  it("is none, never the display table's live id, while the list is not here or lists the pack without a price", () => {
    expect(packCheckoutPriceId(pack10, undefined)).toBeNull()
    expect(packCheckoutPriceId(pack10, { ...TEST_PLANS, topUps: [{ ...TEST_PLANS.topUps[0], priceId: null }] })).toBeNull()
    expect(packCheckoutPriceId(pack10, { ...TEST_PLANS, topUps: [] })).toBeNull()
  })
})

describe("subscriptionTierId", () => {
  it("reads a live price from the table and a deployment's own price from the list", () => {
    expect(subscriptionTierId(basic.priceIdMonthly, undefined)).toBe("basic")
    expect(subscriptionTierId("price_TestBasicY", TEST_PLANS)).toBe("basic")
    expect(subscriptionTierId("price_Unknown", TEST_PLANS)).toBeNull()
    expect(subscriptionTierId(null, TEST_PLANS)).toBeNull()
  })
})
