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
    credits: 250,
    llmRequests: 20,
    storage: "1 GB",
    features: [
      "250 credits / month",
      "50 credits / day cap",
      "20 LLM requests / month",
      "1 GB storage",
      "Basic models only",
      "Watermarked exports",
      "60-day media retention",
    ],
    cta: "Get Started",
  },
  {
    id: "basic",
    name: "Basic",
    priceMonthly: 12,
    priceAnnual: 9,
    priceIdMonthly: "price_1T8T2r6EOX16l3P8KLqPT0Gp",
    priceIdAnnual: "price_1T92PK6EOX16l3P8f7VcNi21",
    credits: 475,
    llmRequests: 100,
    storage: "10 GB",
    features: [
      "475 credits / month",
      "100 LLM requests / month",
      "10 GB storage",
      "All standard models",
      "No watermark",
      "Priority queue",
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
    credits: 1175,
    llmRequests: 300,
    storage: "25 GB",
    features: [
      "1,175 credits / month",
      "300 LLM requests / month",
      "25 GB storage",
      "All models incl. premium",
      "No watermark",
      "Priority queue",
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
    credits: 2650,
    llmRequests: 1000,
    storage: "50 GB",
    features: [
      "2,650 credits / month",
      "1,000 LLM requests / month",
      "50 GB storage",
      "All models incl. premium",
      "No watermark",
      "Fastest queue priority",
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
    credits: 5600,
    llmRequests: null,
    storage: "200 GB",
    features: [
      "5,600 credits / month",
      "Unlimited LLM requests",
      "200 GB storage",
      "All models incl. premium",
      "No watermark",
      "Fastest queue + dedicated",
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
  basic: 10 * 1024 * 1024 * 1024,        // 10 GB
  standard: 25 * 1024 * 1024 * 1024,     // 25 GB
  pro: 50 * 1024 * 1024 * 1024,          // 50 GB
  business: 200 * 1024 * 1024 * 1024,    // 200 GB
  enterprise: 500 * 1024 * 1024 * 1024,  // 500 GB
}

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
    credits: 275,
    price: 10,
    perCredit: "$0.04",
  },
  {
    id: "topup_25",
    priceId: "price_1T8T5k6EOX16l3P8a1goDXGm",
    credits: 750,
    price: 25,
    perCredit: "$0.03",
    popular: true,
  },
  {
    id: "topup_50",
    priceId: "price_1T8T5w6EOX16l3P8mNU7sLkU",
    credits: 1650,
    price: 50,
    perCredit: "$0.03",
  },
  {
    id: "topup_100",
    priceId: "price_1T8T6B6EOX16l3P8CmcSaJyR",
    credits: 3500,
    price: 100,
    perCredit: "$0.03",
  },
] as const
