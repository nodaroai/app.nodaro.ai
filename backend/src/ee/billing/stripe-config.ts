/**
 * Stripe Billing Configuration
 *
 * All billing constants: price IDs, tier mappings, credit allocations,
 * storage limits, and free-tier restrictions.
 */

import { VIDEO_DURATION_TIERS } from "@nodaro/shared/models"
import { defaultLaneSizesForTier, PARALLELISM_TIERS } from "../../lib/concurrency-lanes/defaults.js"

/**
 * Every Vidu Q4 4K composite the credit identifier can emit
 * (`vidu-q4:<N>s:4k`), derived from the SAME duration ladder the builder reads
 * so a new tier is blocked the moment it becomes billable.
 */
const VIDU_Q4_4K_COMPOSITES: readonly string[] = (VIDEO_DURATION_TIERS["vidu-q4"] ?? []).map(
  (t) => `vidu-q4:${t.suffix}:4k`,
)

export const STRIPE_PRODUCTS = {
  basic: {
    productId: "prod_U6gPUNpvVGjE2f",
    monthly: "price_1T8T2r6EOX16l3P8KLqPT0Gp",
    yearly: "price_1UW3116EOX16l3P8cfayw1lX",
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

type PlanPrice = { plan: string; interval: "monthly" | "yearly" }

/** The prices on sale → { plan, interval }. Checkout and plan changes accept only these. */
export const ON_SALE_PRICE_TO_PLAN: Record<string, PlanPrice> = {
  [STRIPE_PRODUCTS.basic.monthly]: { plan: "basic", interval: "monthly" },
  [STRIPE_PRODUCTS.basic.yearly]: { plan: "basic", interval: "yearly" },
  [STRIPE_PRODUCTS.standard.monthly]: { plan: "standard", interval: "monthly" },
  [STRIPE_PRODUCTS.standard.yearly]: { plan: "standard", interval: "yearly" },
  [STRIPE_PRODUCTS.pro.monthly]: { plan: "pro", interval: "monthly" },
  [STRIPE_PRODUCTS.pro.yearly]: { plan: "pro", interval: "yearly" },
  [STRIPE_PRODUCTS.business.monthly]: { plan: "business", interval: "monthly" },
  [STRIPE_PRODUCTS.business.yearly]: { plan: "business", interval: "yearly" },
}

/**
 * Prices no longer sold that existing subscriptions still renew on. They must
 * keep resolving to their plan (tier, monthly credits on a yearly plan), but a
 * new checkout or plan change can never pick them.
 */
export const RETIRED_PRICE_TO_PLAN: Record<string, PlanPrice> = {
  // Basic yearly at $108/year, replaced by $120/year on 2026-10-30.
  "price_1T92PK6EOX16l3P8f7VcNi21": { plan: "basic", interval: "yearly" },
}

/** Every price a subscription can be on (on sale or retired) → { plan, interval }. */
export const PRICE_TO_PLAN: Record<string, PlanPrice> = {
  ...ON_SALE_PRICE_TO_PLAN,
  ...RETIRED_PRICE_TO_PLAN,
}

export const TOP_UPS: Record<string, number> = {
  // Re-rated onto the flattened curve (design §4.3, signed off 2026-07-30).
  // Dollar amounts and Stripe price IDs are unchanged — only the grants move.
  "price_1T8T5M6EOX16l3P85i5sCtUs": 3300,   // $10
  "price_1T8T5k6EOX16l3P8a1goDXGm": 8500,   // $25
  "price_1T8T5w6EOX16l3P8mNU7sLkU": 17500,  // $50
  "price_1T8T6B6EOX16l3P8CmcSaJyR": 36000,  // $100
}

export interface OrgPack {
  priceId: string
  credits: number
  usd: number
}

/**
 * Prepaid packs an ORGANIZATION can buy (E2/P13). Identical to the personal
 * ladder — owner decision, 2026-08-26 — down to the Stripe price ids: the same product
 * is sold, and what makes the purchase an org purchase is the checkout's
 * `metadata.payerKind === "org"` plus the org-owned Stripe customer, never a
 * different price. A guard test pins each pack's (priceId, credits) to the
 * TOP_UPS row it mirrors, so a personal re-rate cannot silently drift the two
 * ladders apart.
 */
export const ORG_TOP_UPS: Record<string, OrgPack> = {
  "org-10": { priceId: "price_1T8T5M6EOX16l3P85i5sCtUs", credits: 3300, usd: 10 },
  "org-25": { priceId: "price_1T8T5k6EOX16l3P8a1goDXGm", credits: 8500, usd: 25 },
  "org-50": { priceId: "price_1T8T5w6EOX16l3P8mNU7sLkU", credits: 17500, usd: 50 },
  "org-100": { priceId: "price_1T8T6B6EOX16l3P8CmcSaJyR", credits: 36000, usd: 100 },
}

export function getOrgPack(packId: string): OrgPack | null {
  return ORG_TOP_UPS[packId] ?? null
}

export const TIER_CREDITS: Record<string, number> = {
  // Tier flattening + x10 re-denomination. $/credit spread collapses 1.79x -> 1.08x.
  // MUST stay in lockstep with tier_config.monthly_credits — migrations 067 and
  // 281 are prior production incidents from updating only one of the two.
  free: 1500,
  basic: 4500,
  standard: 11000,
  pro: 23000,
  business: 52000,
}

/**
 * Max concurrent nodes per workflow execution, by tier — each tier's default
 * provider-lane size, whose one code copy is lib/concurrency-lanes/defaults.ts
 * (payg = basic there: a derived tier, effective-tier.ts). No `enterprise` key.
 */
export const TIER_PARALLELISM: Record<string, number> = Object.fromEntries(
  PARALLELISM_TIERS.map((t) => [t, defaultLaneSizesForTier(t).provider]),
)

export const TIER_STORAGE_LIMITS: Record<string, number> = {
  free: 1 * 1024 * 1024 * 1024,          // 1 GB
  payg: 10 * 1024 * 1024 * 1024,         // 10 GB — write-managed floor, = basic
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
  // Daily spend cap for free-tier accounts (payg "web-free" spending rides it
  // too). null = no daily cap — disabled 2026-08-17; total free exposure is
  // bounded by the one-time 1,500 signup grant (profiles.subscription_credits
  // DEFAULT, migration 295). To re-enable, set a number AND re-seed
  // tier_config.daily_credit_limit for 'free' in a migration —
  // free-tier-config.test.ts enforces that pairing.
  dailyCreditCap: null as number | null,
  // Exact-string match (credits.ts checkCredits). Two shapes only: a whole
  // model (veo3 family) and the 4K tier of an otherwise-allowed model — the
  // Gemini Omni family's 4K composites, gated identically for both SKUs, and
  // Vidu Q4's 4K rows (every other Vidu tier stays open).
  blockedModels: [
    "veo3", "veo3.1",
    "gemini-omni-video:4k:4", "gemini-omni-video:4k:6", "gemini-omni-video:4k:8", "gemini-omni-video:4k:10", "gemini-omni-video:4k:vref",
    "gemini-omni-flash:4k:4", "gemini-omni-flash:4k:6", "gemini-omni-flash:4k:8", "gemini-omni-flash:4k:10", "gemini-omni-flash:4k:vref",
    ...VIDU_Q4_4K_COMPOSITES,
  ],
  watermark: true,
} as const

export function getTierFromPriceId(priceId: string): string {
  return PRICE_TO_PLAN[priceId]?.plan ?? "free"
}

export function getTopupCredits(priceId: string): number | null {
  return TOP_UPS[priceId] ?? null
}

