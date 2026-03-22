/**
 * Stripe Billing Configuration
 *
 * All billing constants: price IDs, tier mappings, credit allocations,
 * storage limits, and free-tier restrictions.
 */

export const STRIPE_PRODUCTS = {
  basic: {
    productId: "prod_U6gPUNpvVGjE2f",
    monthly: "price_1T8T2r6EOX16l3P8KLqPT0Gp",
    yearly: "price_1T92PK6EOX16l3P8f7VcNi21",
  },
  standard: {
    productId: "prod_U6gOhMrAS056Lg",
    monthly: "price_1T8T1m6EOX16l3P8TuFGxcZr",
    yearly: "price_1T8T266EOX16l3P8g39cb6jm",
  },
  pro: {
    productId: "prod_U6gJ8iy2b9NP70",
    monthly: "price_1T8Swg6EOX16l3P8NNctdzT3",
    yearly: "price_1T8Syr6EOX16l3P8z92jaRh6",
  },
  business: {
    productId: "prod_U6gM9ZW1j1wcGN",
    monthly: "price_1T92U26EOX16l3P8fDbjHHi7",
    yearly: "price_1T8T0s6EOX16l3P8VRjmbJhr",
  },
} as const

/** Map every Stripe price ID → { plan, interval } */
export const PRICE_TO_PLAN: Record<string, { plan: string; interval: "monthly" | "yearly" }> = {
  [STRIPE_PRODUCTS.basic.monthly]: { plan: "basic", interval: "monthly" },
  [STRIPE_PRODUCTS.basic.yearly]: { plan: "basic", interval: "yearly" },
  [STRIPE_PRODUCTS.standard.monthly]: { plan: "standard", interval: "monthly" },
  [STRIPE_PRODUCTS.standard.yearly]: { plan: "standard", interval: "yearly" },
  [STRIPE_PRODUCTS.pro.monthly]: { plan: "pro", interval: "monthly" },
  [STRIPE_PRODUCTS.pro.yearly]: { plan: "pro", interval: "yearly" },
  [STRIPE_PRODUCTS.business.monthly]: { plan: "business", interval: "monthly" },
  [STRIPE_PRODUCTS.business.yearly]: { plan: "business", interval: "yearly" },
}

export const TOP_UPS: Record<string, number> = {
  "price_1T8T5M6EOX16l3P85i5sCtUs": 150,
  "price_1T8T5k6EOX16l3P8a1goDXGm": 450,
  "price_1T8T5w6EOX16l3P8mNU7sLkU": 1000,
  "price_1T8T6B6EOX16l3P8CmcSaJyR": 2200,
}

export const TIER_CREDITS: Record<string, number> = {
  free: 150,
  basic: 250,
  standard: 850,
  pro: 2000,
  business: 4800,
}

/** Max concurrent nodes per workflow execution, by tier. */
export const TIER_PARALLELISM: Record<string, number> = {
  free: 2,
  basic: 4,
  standard: 6,
  pro: 10,
  business: 12,
}

export const TIER_LLM_LIMITS: Record<string, number> = {
  free: 20,
  basic: 100,
  standard: 300,
  pro: 1000,
  business: Infinity,
}

export const TIER_STORAGE_LIMITS: Record<string, number> = {
  free: 1 * 1024 * 1024 * 1024,          // 1 GB
  basic: 10 * 1024 * 1024 * 1024,        // 10 GB
  standard: 25 * 1024 * 1024 * 1024,     // 25 GB
  pro: 50 * 1024 * 1024 * 1024,          // 50 GB
  business: 200 * 1024 * 1024 * 1024,    // 200 GB
  enterprise: 500 * 1024 * 1024 * 1024,  // 500 GB
}

export const RETENTION_DAYS = {
  free_media: 60,
  canceled_grace: 60,
} as const

export const FREE_TIER_RESTRICTIONS = {
  dailyCreditCap: 30,
  blockedModels: ["veo3", "veo3.1", "sora2-pro"],
  watermark: true,
} as const

export function getTierFromPriceId(priceId: string): string {
  return PRICE_TO_PLAN[priceId]?.plan ?? "free"
}

export function getTopupCredits(priceId: string): number | null {
  return TOP_UPS[priceId] ?? null
}

