/**
 * Pricing Tier Data
 *
 * Client-side pricing constants for the pricing page and billing dashboard.
 * Price IDs match the Stripe configuration in backend/src/billing/stripe-config.ts.
 *
 * Two billing cycles: "monthly" (higher price) and "annual" (billed yearly at lower per-month rate).
 */

export type BillingCycle = "monthly" | "annual"

export interface PricingTier {
  readonly id: string
  readonly name: string
  readonly priceMonthly: number
  readonly priceAnnual: number
  readonly priceIdMonthly: string | null
  readonly priceIdAnnual: string | null
  readonly credits: number
  readonly llmRequests: number | null
  readonly storage: string
  readonly features: readonly string[]
  readonly highlighted?: boolean
  readonly cta: string
}

export const PRICING_TIERS: readonly PricingTier[] = [
  {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    priceAnnual: 0,
    priceIdMonthly: null,
    priceIdAnnual: null,
    credits: 1500,
    llmRequests: 20,
    storage: "1 GB",
    features: [
      "No daily cap",
      "20 LLM requests / month",
      "1 GB storage",
      "Basic models only",
      "Watermarked exports",
      "60-day media retention",
    ],
    cta: "Start Free",
  },
  {
    // Synthetic DISPLAY entry for the derived pay-as-you-go tier. Not a
    // purchasable plan (price ids null) — it exists so tier lookups
    // (sidebar badge, upgrade modals) render paying non-subscribers
    // correctly instead of falling back to the free entry's numbers.
    id: "payg",
    name: "Pay as you go",
    priceMonthly: 0,
    priceAnnual: 0,
    priceIdMonthly: null,
    priceIdAnnual: null,
    credits: 0,
    llmRequests: 100,
    storage: "10 GB",
    features: [
      "No subscription — buy credit packs",
      "Credits valid for 12 months",
      "All models unlocked",
      "No watermark",
      "No daily cap",
      "10 GB storage",
    ],
    cta: "Buy credits",
  },
  {
    id: "basic",
    name: "Basic",
    priceMonthly: 12,
    priceAnnual: 10,
    priceIdMonthly: "price_1T8T2r6EOX16l3P8KLqPT0Gp",
    priceIdAnnual: "price_1T92PK6EOX16l3P8f7VcNi21",
    credits: 4500,
    llmRequests: 100,
    storage: "10 GB",
    features: [
      "4,500 credits / month",
      "100 LLM requests / month",
      "10 GB storage",
      "All standard models",
      "No watermark",
      "Priority queue \u2014 up to 2x speed",
    ],
    cta: "Subscribe",
  },
  {
    id: "standard",
    name: "Standard",
    priceMonthly: 29,
    priceAnnual: 24,
    priceIdMonthly: "price_1T8T1m6EOX16l3P8TuFGxcZr",
    priceIdAnnual: "price_1T8T266EOX16l3P8g39cb6jm",
    credits: 11000,
    llmRequests: 300,
    storage: "25 GB",
    features: [
      "11,000 credits / month",
      "300 LLM requests / month",
      "25 GB storage",
      "All models incl. premium",
      "No watermark",
      "Priority queue \u2014 up to 3x speed",
    ],
    cta: "Subscribe",
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: 59,
    priceAnnual: 49,
    priceIdMonthly: "price_1T8Swg6EOX16l3P8NNctdzT3",
    priceIdAnnual: "price_1T8Syr6EOX16l3P8z92jaRh6",
    credits: 23000,
    llmRequests: 1000,
    storage: "50 GB",
    features: [
      "23,000 credits / month",
      "1,000 LLM requests / month",
      "50 GB storage",
      "All models incl. premium",
      "No watermark",
      "Fastest queue \u2014 up to 5x speed",
    ],
    highlighted: true,
    cta: "Subscribe",
  },
  {
    id: "business",
    name: "Business",
    priceMonthly: 129,
    priceAnnual: 109,
    priceIdMonthly: "price_1T92U26EOX16l3P8fDbjHHi7",
    priceIdAnnual: "price_1T8T0s6EOX16l3P8VRjmbJhr",
    credits: 52000,
    llmRequests: null,
    storage: "200 GB",
    features: [
      "52,000 credits / month",
      "Unlimited LLM requests",
      "200 GB storage",
      "All models incl. premium",
      "No watermark",
      "Fastest queue \u2014 up to 8x speed",
    ],
    cta: "Subscribe",
  },
] as const

/**
 * Storage limits per tier in bytes.
 * Must match backend TIER_STORAGE_LIMITS in stripe-config.ts.
 */
export const TIER_STORAGE_BYTES: Record<string, number> = {
  free: 1 * 1024 * 1024 * 1024,          // 1 GB
  payg: 10 * 1024 * 1024 * 1024,         // 10 GB — derived tier, = basic
  basic: 10 * 1024 * 1024 * 1024,        // 10 GB
  standard: 25 * 1024 * 1024 * 1024,     // 25 GB
  pro: 50 * 1024 * 1024 * 1024,          // 50 GB
  business: 200 * 1024 * 1024 * 1024,    // 200 GB
  enterprise: 500 * 1024 * 1024 * 1024,  // 500 GB
}

/** Max concurrent nodes per workflow execution, by tier. Must match backend TIER_PARALLELISM in stripe-config.ts. */
export const TIER_PARALLELISM: Record<string, number> = {
  free: 2,
  payg: 4, // derived tier, = basic
  basic: 4,
  standard: 6,
  pro: 10,
  business: 12,
}

/**
 * The free-tier signup grant, DERIVED from PRICING_TIERS rather than restated.
 *
 * Signup copy and balance fallbacks used to hardcode this. The 2026-07-30 x10
 * re-denomination moved the tier table but left those literals reading 150,
 * so the login page advertised a tenth of the real grant. Derive, don't repeat.
 */
export const FREE_TIER_CREDITS: number =
  PRICING_TIERS.find((t) => t.id === "free")?.credits ?? 1500

/**
 * One-shot Character LoRA training (Replicate flux-dev-lora-trainer, 1000 steps).
 *
 * Authority is STATIC_CREDIT_COSTS["character-lora-training"] in
 * backend/src/ee/billing/credits.ts. Pinned to it by a guard test in
 * __tests__/pricing-data.test.ts — the same x10 re-denomination left the two
 * training labels quoting 150 against a real cost of 1500.
 */
export const CHARACTER_LORA_TRAINING_CREDITS = 1500

/** Get the display price for a tier based on billing cycle. */
export function getTierPrice(tier: PricingTier, cycle: BillingCycle): number {
  return cycle === "monthly" ? tier.priceMonthly : tier.priceAnnual
}

/** Get the Stripe price ID for a tier based on billing cycle. */
export function getTierPriceId(tier: PricingTier, cycle: BillingCycle): string | null {
  return cycle === "monthly" ? tier.priceIdMonthly : tier.priceIdAnnual
}

/** Calculate the annual savings percentage compared to monthly billing. */
export function getAnnualSavingsPercent(tier: PricingTier): number {
  if (tier.priceMonthly <= 0) return 0
  return Math.round(((tier.priceMonthly - tier.priceAnnual) / tier.priceMonthly) * 100)
}

/** Calculate how much $/year is saved by choosing annual over monthly billing. */
export function getAnnualSavingsDollars(tier: PricingTier): number {
  if (tier.priceMonthly <= 0) return 0
  return (tier.priceMonthly - tier.priceAnnual) * 12
}

/** Determine billing cycle from a Stripe price ID by matching against all tiers. */
export function getBillingCycleFromPriceId(priceId: string | null | undefined): BillingCycle {
  if (!priceId) return "annual"
  for (const tier of PRICING_TIERS) {
    if (tier.priceIdMonthly === priceId) return "monthly"
    if (tier.priceIdAnnual === priceId) return "annual"
  }
  return "annual"
}

export interface TopupPackage {
  readonly id: string
  readonly priceId: string
  readonly credits: number
  readonly price: number
  readonly perCredit: string
  readonly popular?: boolean
}

export const TOPUP_PACKAGES: readonly TopupPackage[] = [
  {
    id: "topup_10",
    priceId: "price_1T8T5M6EOX16l3P85i5sCtUs",
    credits: 3300,
    price: 10,
    perCredit: "$0.0030",
  },
  {
    id: "topup_25",
    priceId: "price_1T8T5k6EOX16l3P8a1goDXGm",
    credits: 8500,
    price: 25,
    perCredit: "$0.0029",
    popular: true,
  },
  {
    id: "topup_50",
    priceId: "price_1T8T5w6EOX16l3P8mNU7sLkU",
    credits: 17500,
    price: 50,
    perCredit: "$0.0029",
  },
  {
    id: "topup_100",
    priceId: "price_1T8T6B6EOX16l3P8CmcSaJyR",
    credits: 36000,
    price: 100,
    perCredit: "$0.0028",
  },
] as const

/**
 * Pay-as-you-go load rate — DISPLAY MIRROR of the canonical function in
 * backend/src/ee/billing/load-rate.ts (sync-pinned by its test). Piecewise
 * linear between the live pack anchors; $10 rate extended down to the $5
 * minimum; flat ceiling above $100.
 */
export const LOAD_RATE_ANCHORS: ReadonlyArray<{ usd: number; credits: number }> = [
  { usd: 10, credits: 3300 },
  { usd: 25, credits: 8500 },
  { usd: 50, credits: 17500 },
  { usd: 100, credits: 36000 },
]
export const MIN_LOAD_USD = 5
export const MAX_LOAD_USD = 1000
export const MAX_LOAD_RATE_PER_USD = 360

export function creditsForLoadUsd(amountUsd: number): number | null {
  if (!Number.isInteger(amountUsd) || amountUsd < MIN_LOAD_USD || amountUsd > MAX_LOAD_USD) {
    return null
  }
  const first = LOAD_RATE_ANCHORS[0]
  const last = LOAD_RATE_ANCHORS[LOAD_RATE_ANCHORS.length - 1]
  if (amountUsd <= first.usd) return Math.round((amountUsd * first.credits) / first.usd)
  if (amountUsd >= last.usd) return Math.round((amountUsd * last.credits) / last.usd)
  for (let i = 0; i < LOAD_RATE_ANCHORS.length - 1; i++) {
    const a = LOAD_RATE_ANCHORS[i]
    const b = LOAD_RATE_ANCHORS[i + 1]
    if (amountUsd >= a.usd && amountUsd <= b.usd) {
      const t = (amountUsd - a.usd) / (b.usd - a.usd)
      return Math.round(a.credits + t * (b.credits - a.credits))
    }
  }
  return null
}
