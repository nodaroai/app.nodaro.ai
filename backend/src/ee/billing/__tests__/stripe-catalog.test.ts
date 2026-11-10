import { describe, it, expect, vi, afterEach } from "vitest"

/**
 * Which Stripe prices this deployment sells. A live key (or none) is today's
 * catalogue, id for id. A test-mode key sells the test catalogue the
 * deployment names in STRIPE_TEST_CATALOG, checked whole before it is used;
 * anything else falls back to the live ids (which test mode cannot sell, so a
 * mistake shows as "unavailable", never as a wrong charge).
 */

const LIVE_BASIC_MONTHLY = "price_1T8T2r6EOX16l3P8KLqPT0Gp"
const LIVE_PACK_10 = "price_1T8T5M6EOX16l3P85i5sCtUs"

const TEST_CATALOG = {
  products: {
    basic: { productId: "prod_TestBasic", monthly: "price_TestBasicM", yearly: "price_TestBasicY" },
    standard: { productId: "prod_TestStandard", monthly: "price_TestStandardM", yearly: "price_TestStandardY" },
    pro: { productId: "prod_TestPro", monthly: "price_TestProM", yearly: "price_TestProY" },
    business: { productId: "prod_TestBusiness", monthly: "price_TestBusinessM", yearly: "price_TestBusinessY" },
  },
  retired: { price_TestBasicOldY: { plan: "basic", interval: "yearly" } },
  topUps: { price_TestPack10: 3300, price_TestPack25: 8500, price_TestPack50: 17500, price_TestPack100: 36000 },
}

async function catalogModule() {
  return await import("../stripe-catalog.js")
}

describe("resolveStripeCatalog", () => {
  it("a live key, or none, sells today's catalogue id for id", async () => {
    const { resolveStripeCatalog, LIVE_STRIPE_CATALOG } = await catalogModule()
    for (const secretKey of ["sk_live_x", "", undefined, "rk_live_x"]) {
      const catalog = resolveStripeCatalog({ secretKey, testCatalog: JSON.stringify(TEST_CATALOG) })
      expect(catalog).toBe(LIVE_STRIPE_CATALOG)
    }
    expect(LIVE_STRIPE_CATALOG.products.basic.monthly).toBe(LIVE_BASIC_MONTHLY)
    expect(LIVE_STRIPE_CATALOG.topUps[LIVE_PACK_10]).toBe(3300)
  })

  it("a test-mode key sells the test catalogue it is given", async () => {
    const { resolveStripeCatalog } = await catalogModule()
    const catalog = resolveStripeCatalog({ secretKey: "sk_test_x", testCatalog: JSON.stringify(TEST_CATALOG) })
    expect(catalog.products.pro.yearly).toBe("price_TestProY")
    expect(catalog.topUps).toEqual(TEST_CATALOG.topUps)
    expect(catalog.retired).toEqual(TEST_CATALOG.retired)
  })

  it("a restricted test-mode key (rk_test_) is test mode too", async () => {
    const { resolveStripeCatalog } = await catalogModule()
    const catalog = resolveStripeCatalog({ secretKey: "rk_test_x", testCatalog: JSON.stringify(TEST_CATALOG) })
    expect(catalog.products.pro.yearly).toBe("price_TestProY")
  })

  it("a test-mode key without a valid test catalogue keeps the live ids, with a warning", async () => {
    const { resolveStripeCatalog, LIVE_STRIPE_CATALOG } = await catalogModule()
    const badLadder = { ...TEST_CATALOG, topUps: { price_TestPack10: 3300, price_TestPack25: 9999, price_TestPack50: 17500, price_TestPack100: 36000 } }
    const missingPlan = { ...TEST_CATALOG, products: { ...TEST_CATALOG.products, business: undefined } }
    const reusedId = { ...TEST_CATALOG, retired: { price_TestProY: { plan: "pro", interval: "yearly" } } }
    for (const testCatalog of [undefined, "", "{ not json", JSON.stringify(badLadder), JSON.stringify(missingPlan), JSON.stringify(reusedId)]) {
      const warn = vi.fn()
      expect(resolveStripeCatalog({ secretKey: "sk_test_x", testCatalog }, warn)).toBe(LIVE_STRIPE_CATALOG)
      expect(warn).toHaveBeenCalledTimes(1)
    }
  })
})

describe("stripe-config under a test-mode deployment", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("every price table and the org packs follow the test catalogue, (id, credits) pair for pair", async () => {
    vi.resetModules()
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x")
    vi.stubEnv("STRIPE_TEST_CATALOG", JSON.stringify(TEST_CATALOG))
    const cfg = await import("../stripe-config.js")
    expect(cfg.STRIPE_PRODUCTS.basic.monthly).toBe("price_TestBasicM")
    expect(cfg.ON_SALE_PRICE_TO_PLAN.price_TestBusinessY).toEqual({ plan: "business", interval: "yearly" })
    expect(cfg.ON_SALE_PRICE_TO_PLAN[LIVE_BASIC_MONTHLY]).toBeUndefined()
    expect(cfg.PRICE_TO_PLAN.price_TestBasicOldY).toEqual({ plan: "basic", interval: "yearly" })
    expect(cfg.TOP_UPS).toEqual(TEST_CATALOG.topUps)
    for (const pack of Object.values(cfg.ORG_TOP_UPS)) expect(cfg.TOP_UPS[pack.priceId], pack.priceId).toBe(pack.credits)
    expect(cfg.getOrgPack("org-10")).toEqual({ priceId: "price_TestPack10", credits: 3300, usd: 10 })
  })

  it("a live deployment's tables are byte for byte today's", async () => {
    vi.resetModules()
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_x")
    vi.stubEnv("STRIPE_TEST_CATALOG", JSON.stringify(TEST_CATALOG))
    const cfg = await import("../stripe-config.js")
    expect(cfg.STRIPE_PRODUCTS.basic).toEqual({ productId: "prod_U6gPUNpvVGjE2f", monthly: LIVE_BASIC_MONTHLY, yearly: "price_1UW3116EOX16l3P8cfayw1lX" })
    expect(cfg.getOrgPack("org-10")).toEqual({ priceId: LIVE_PACK_10, credits: 3300, usd: 10 })
    expect(cfg.ORG_TOP_UPS).toEqual({
      "org-10": { priceId: LIVE_PACK_10, credits: 3300, usd: 10 },
      "org-25": { priceId: "price_1T8T5k6EOX16l3P8a1goDXGm", credits: 8500, usd: 25 },
      "org-50": { priceId: "price_1T8T5w6EOX16l3P8mNU7sLkU", credits: 17500, usd: 50 },
      "org-100": { priceId: "price_1T8T6B6EOX16l3P8CmcSaJyR", credits: 36000, usd: 100 },
    })
    expect(cfg.RETIRED_PRICE_TO_PLAN).toEqual({ price_1T92PK6EOX16l3P8f7VcNi21: { plan: "basic", interval: "yearly" } })
  })
})

describe("GET /v1/billing/plans under a test-mode deployment", () => {
  afterEach(() => {
    vi.doUnmock("../../../lib/config.js")
    vi.doUnmock("../stripe-client.js")
    vi.doUnmock("../../../lib/concurrency-lanes/sizes.js")
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("lists the test catalogue's prices and packs", async () => {
    vi.resetModules()
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x")
    vi.stubEnv("STRIPE_TEST_CATALOG", JSON.stringify(TEST_CATALOG))
    // The plans route asks config for the key (no key, nothing to quote).
    const real = await vi.importActual<typeof import("../../../lib/config.js")>("../../../lib/config.js")
    vi.doMock("../../../lib/config.js", () => ({ ...real, config: { ...real.config, STRIPE_SECRET_KEY: "sk_test_x" } }))
    vi.doMock("../../../lib/concurrency-lanes/sizes.js", () => ({ lastMirroredEnforced: () => false, lanesEnforced: async () => false }))
    const packUsd: Record<string, number> = { price_TestPack10: 10, price_TestPack25: 25, price_TestPack50: 50, price_TestPack100: 100 }
    vi.doMock("../stripe-client.js", () => ({
      getStripe: () => ({
        prices: {
          retrieve: async (id: string) => {
            const yearly = id.endsWith("Y")
            const isPack = id in packUsd
            return {
              id,
              object: "price",
              active: true,
              currency: "usd",
              unit_amount: isPack ? packUsd[id] * 100 : yearly ? 12 * 900 : 1099,
              recurring: isPack ? null : { interval: yearly ? "year" : "month", interval_count: 1 },
              product: "prod_Test",
            }
          },
        },
      }),
    }))
    const { readBillingPlans } = await import("../plans.js")
    const result = await readBillingPlans()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const basic = result.plans.data.find((plan) => plan.id === "basic")
    expect(basic?.prices?.monthly?.priceId).toBe("price_TestBasicM")
    expect(basic?.prices?.yearly?.priceId).toBe("price_TestBasicY")
    const priced = result.plans.topUps.filter((pack) => pack.price !== null)
    expect(priced.length).toBe(4)
  })
})
