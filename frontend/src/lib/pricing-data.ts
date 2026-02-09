/**
 * Pricing Tier Data
 *
 * Client-side pricing constants for the pricing page and billing dashboard.
 * Price IDs match the Paddle configuration in backend/src/billing/paddle-config.ts.
 */

export interface PricingTier {
  readonly id: string
  readonly name: string
  readonly priceMonthly: number
  readonly priceId: string | null
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
    priceId: null,
    credits: 50,
    llmRequests: 20,
    storage: "500 MB",
    features: [
      "50 credits / month",
      "20 LLM requests / month",
      "500 MB storage",
      "Basic models only",
      "Watermarked exports",
      "60-day media retention",
    ],
    cta: "Get Started",
  },
  {
    id: "basic",
    name: "Basic",
    priceMonthly: 9,
    priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_BASIC || "pri_basic_monthly",
    credits: 95,
    llmRequests: 100,
    storage: "5 GB",
    features: [
      "95 credits / month",
      "100 LLM requests / month",
      "5 GB storage",
      "All standard models",
      "No watermark",
      "Priority queue",
    ],
    cta: "Subscribe",
  },
  {
    id: "standard",
    name: "Standard",
    priceMonthly: 24,
    priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_STANDARD || "pri_standard_monthly",
    credits: 235,
    llmRequests: 300,
    storage: "15 GB",
    features: [
      "235 credits / month",
      "300 LLM requests / month",
      "15 GB storage",
      "All models incl. premium",
      "No watermark",
      "Priority queue",
    ],
    highlighted: true,
    cta: "Subscribe",
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: 49,
    priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO || "pri_pro_monthly",
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
    cta: "Subscribe",
  },
  {
    id: "business",
    name: "Business",
    priceMonthly: 99,
    priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_BUSINESS || "pri_business_monthly",
    credits: 1120,
    llmRequests: null,
    storage: "100 GB",
    features: [
      "1,120 credits / month",
      "Unlimited LLM requests",
      "100 GB storage",
      "All models incl. premium",
      "No watermark",
      "Fastest queue + dedicated",
    ],
    cta: "Subscribe",
  },
] as const

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
    priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_TOPUP_10 || "pri_topup_10",
    credits: 55,
    price: 10,
    perCredit: "$0.18",
  },
  {
    id: "topup_25",
    priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_TOPUP_25 || "pri_topup_25",
    credits: 150,
    price: 25,
    perCredit: "$0.17",
    popular: true,
  },
  {
    id: "topup_50",
    priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_TOPUP_50 || "pri_topup_50",
    credits: 330,
    price: 50,
    perCredit: "$0.15",
  },
  {
    id: "topup_100",
    priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_TOPUP_100 || "pri_topup_100",
    credits: 700,
    price: 100,
    perCredit: "$0.14",
  },
] as const
