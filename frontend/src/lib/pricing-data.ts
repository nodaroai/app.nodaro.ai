/**
 * Pricing Tier Data
 *
 * Client-side pricing constants for the pricing page and billing dashboard.
 * Price IDs match the Paddle configuration in backend/src/billing/paddle-config.ts.
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
    credits: 50,
    llmRequests: 20,
    storage: "1 GB",
    features: [
      "50 credits / month",
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
    priceMonthly: 24,
    priceAnnual: 19,
    priceIdMonthly: import.meta.env.VITE_PADDLE_PRICE_BASIC_MONTHLY || null,
    priceIdAnnual: import.meta.env.VITE_PADDLE_PRICE_BASIC || "pri_01kh3bsqwcvna2shws5ee1fzek",
    credits: 95,
    llmRequests: 100,
    storage: "10 GB",
    features: [
      "95 credits / month",
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
    priceMonthly: 49,
    priceAnnual: 39,
    priceIdMonthly: import.meta.env.VITE_PADDLE_PRICE_STANDARD_MONTHLY || null,
    priceIdAnnual: import.meta.env.VITE_PADDLE_PRICE_STANDARD || "pri_01kh3btfezxg529x44qknn5h1q",
    credits: 235,
    llmRequests: 300,
    storage: "25 GB",
    features: [
      "235 credits / month",
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
    priceMonthly: 99,
    priceAnnual: 79,
    priceIdMonthly: import.meta.env.VITE_PADDLE_PRICE_PRO_MONTHLY || null,
    priceIdAnnual: import.meta.env.VITE_PADDLE_PRICE_PRO || "pri_01kh3bvg0gjkhnydp175zyzzd6",
    credits: 530,
    llmRequests: 1000,
    storage: "50 GB",
    features: [
      "530 credits / month",
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
    priceMonthly: 189,
    priceAnnual: 149,
    priceIdMonthly: import.meta.env.VITE_PADDLE_PRICE_BUSINESS_MONTHLY || null,
    priceIdAnnual: import.meta.env.VITE_PADDLE_PRICE_BUSINESS || "pri_01kh3bwnatzcgmj55pxdrkhap7",
    credits: 1120,
    llmRequests: null,
    storage: "200 GB",
    features: [
      "1,120 credits / month",
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
 * Must match backend TIER_STORAGE_LIMITS in paddle-config.ts.
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

/** Get the Paddle price ID for a tier based on billing cycle. */
export function getTierPriceId(tier: PricingTier, cycle: BillingCycle): string | null {
  return cycle === "monthly" ? tier.priceIdMonthly : tier.priceIdAnnual
}

/** Calculate the annual savings percentage compared to monthly billing. */
export function getAnnualSavingsPercent(tier: PricingTier): number {
  if (tier.priceMonthly <= 0) return 0
  return Math.round(((tier.priceMonthly - tier.priceAnnual) / tier.priceMonthly) * 100)
}

/** Determine billing cycle from a Paddle price ID by matching against all tiers. */
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
    priceId: import.meta.env.VITE_PADDLE_PRICE_TOPUP_10 || "pri_01kh3bxzszyn16c2mzsyyz4105",
    credits: 55,
    price: 10,
    perCredit: "$0.18",
  },
  {
    id: "topup_25",
    priceId: import.meta.env.VITE_PADDLE_PRICE_TOPUP_25 || "pri_01kh3bympxgkk83md78ey177bt",
    credits: 150,
    price: 25,
    perCredit: "$0.17",
    popular: true,
  },
  {
    id: "topup_50",
    priceId: import.meta.env.VITE_PADDLE_PRICE_TOPUP_50 || "pri_01kh3bz8shkvr7vrq65zpfdfn6",
    credits: 330,
    price: 50,
    perCredit: "$0.15",
  },
  {
    id: "topup_100",
    priceId: import.meta.env.VITE_PADDLE_PRICE_TOPUP_100 || "pri_01kh3bzr8tq1jbnkg2arkng5n9",
    credits: 700,
    price: 100,
    perCredit: "$0.14",
  },
] as const
