/**
 * Pricing Tier Data
 *
 * Client-side pricing constants for the pricing page and billing dashboard.
 * Price IDs match the Stripe configuration in backend/src/billing/stripe-config.ts.
 *
 * Two billing cycles: "monthly" (higher price) and "annual" (billed yearly at lower per-month rate).
 */

import type { MessageKey } from "@/lib/i18n"

export type BillingCycle = "monthly" | "annual"

/**
 * One line of a tier's feature list: a dictionary key and its values, so the
 * list reads in the interface language. Numbers stay numbers and are formatted
 * at render; units and acronyms (GB, LLM) live in the dictionary text.
 */
export interface TierFeature {
  readonly key: MessageKey
  readonly vars?: Readonly<Record<string, string | number>>
}

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
  readonly features: readonly TierFeature[]
  readonly highlighted?: boolean
  readonly cta: MessageKey
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
      { key: "pricing.feat.noDailyCap" },
      { key: "pricing.feat.llmRequests", vars: { n: 20 } },
      { key: "pricing.feat.storage", vars: { size: "1 GB" } },
      { key: "pricing.feat.basicModelsOnly" },
      { key: "pricing.feat.watermarkedExports" },
      { key: "pricing.feat.mediaRetention", vars: { days: 60 } },
    ],
    cta: "pricing.cta.startFree",
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
      { key: "pricing.feat.noSubscription" },
      { key: "pricing.feat.creditsValid12Months" },
      { key: "pricing.feat.allModelsUnlocked" },
      { key: "pricing.feat.noWatermark" },
      { key: "pricing.feat.noDailyCap" },
      { key: "pricing.feat.storage", vars: { size: "10 GB" } },
    ],
    cta: "pricing.cta.buyCredits",
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
      { key: "pricing.feat.creditsPerMonth", vars: { n: 4_500 } },
      { key: "pricing.feat.llmRequests", vars: { n: 100 } },
      { key: "pricing.feat.storage", vars: { size: "10 GB" } },
      { key: "pricing.feat.allStandardModels" },
      { key: "pricing.feat.noWatermark" },
      { key: "pricing.feat.priorityQueue", vars: { x: 2 } },
    ],
    cta: "pricing.cta.subscribe",
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
      { key: "pricing.feat.creditsPerMonth", vars: { n: 11_000 } },
      { key: "pricing.feat.llmRequests", vars: { n: 300 } },
      { key: "pricing.feat.storage", vars: { size: "25 GB" } },
      { key: "pricing.feat.allModelsPremium" },
      { key: "pricing.feat.noWatermark" },
      { key: "pricing.feat.priorityQueue", vars: { x: 3 } },
    ],
    cta: "pricing.cta.subscribe",
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
      { key: "pricing.feat.creditsPerMonth", vars: { n: 23_000 } },
      { key: "pricing.feat.llmRequests", vars: { n: 1_000 } },
      { key: "pricing.feat.storage", vars: { size: "50 GB" } },
      { key: "pricing.feat.allModelsPremium" },
      { key: "pricing.feat.noWatermark" },
      { key: "pricing.feat.fastestQueue", vars: { x: 5 } },
    ],
    highlighted: true,
    cta: "pricing.cta.subscribe",
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
      { key: "pricing.feat.creditsPerMonth", vars: { n: 52_000 } },
      { key: "pricing.feat.unlimitedLlm" },
      { key: "pricing.feat.storage", vars: { size: "200 GB" } },
      { key: "pricing.feat.allModelsPremium" },
      { key: "pricing.feat.noWatermark" },
      { key: "pricing.feat.fastestQueue", vars: { x: 8 } },
    ],
    cta: "pricing.cta.subscribe",
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
