/**
 * Stripe Billing Configuration
 *
 * All billing constants: price IDs, tier mappings, credit allocations,
 * storage limits, and free-tier restrictions.
 */

import { VIDEO_DURATION_TIERS } from "@nodaro/shared/models"
import { defaultLaneSizesForTier, PARALLELISM_TIERS } from "../../lib/concurrency-lanes/defaults.js"
import { PLAN_KEYS, resolveStripeCatalog, type PlanKey, type PlanPrice, type StripeProduct } from "./stripe-catalog.js"

/**
 * Every Vidu Q4 4K composite the credit identifier can emit
 * (`vidu-q4:<N>s:4k`), derived from the SAME duration ladder the builder reads
 * so a new tier is blocked the moment it becomes billable.
 */
const VIDU_Q4_4K_COMPOSITES: readonly string[] = (VIDEO_DURATION_TIERS["vidu-q4"] ?? []).map(
  (t) => `vidu-q4:${t.suffix}:4k`,
)

/** Gemini Omni Flash 1.2's 4K rows, closed to the free tier like every Omni 4K row. */
const GEMINI_OMNI_12_4K_COMPOSITES: readonly string[] = (VIDEO_DURATION_TIERS["gemini-omni-flash-1-2"] ?? []).map(
  (t) => `gemini-omni-flash-1-2:${t.suffix}:4k`,
)

/**
 * Every price id below comes from the deployment's Stripe catalogue
 * (stripe-catalog.ts): the live one, id for id, unless the deployment runs on a
 * test-mode key with a test catalogue of its own (a staging environment).
 * Read from the environment, not `config`: this module is imported by tests
 * that mock `config` with only the helpers they need.
 */
const CATALOG = resolveStripeCatalog({ secretKey: process.env.STRIPE_SECRET_KEY, testCatalog: process.env.STRIPE_TEST_CATALOG })

export const STRIPE_PRODUCTS: Readonly<Record<PlanKey, StripeProduct>> = CATALOG.products

/** The prices on sale → { plan, interval }. Checkout and plan changes accept only these. */
export const ON_SALE_PRICE_TO_PLAN: Record<string, PlanPrice> = Object.fromEntries(
  PLAN_KEYS.flatMap((plan): Array<[string, PlanPrice]> => [
    [STRIPE_PRODUCTS[plan].monthly, { plan, interval: "monthly" }],
    [STRIPE_PRODUCTS[plan].yearly, { plan, interval: "yearly" }],
  ]),
)

/**
 * Prices no longer sold that existing subscriptions still renew on. They must
 * keep resolving to their plan (tier, monthly credits on a yearly plan), but a
 * new checkout or plan change can never pick them.
 */
export const RETIRED_PRICE_TO_PLAN: Record<string, PlanPrice> = { ...CATALOG.retired }

/** Every price a subscription can be on (on sale or retired) → { plan, interval }. */
export const PRICE_TO_PLAN: Record<string, PlanPrice> = {
  ...ON_SALE_PRICE_TO_PLAN,
  ...RETIRED_PRICE_TO_PLAN,
}

/** A fixed credit pack's price id → the credits it grants. */
export const TOP_UPS: Record<string, number> = { ...CATALOG.topUps }

export interface OrgPack {
  priceId: string
  credits: number
  usd: number
}

/** The org ladder: the personal ladder's packs, by the credits each grants. */
const ORG_PACK_LADDER: ReadonlyArray<{ id: string; credits: number; usd: number }> = [
  { id: "org-10", credits: 3300, usd: 10 },
  { id: "org-25", credits: 8500, usd: 25 },
  { id: "org-50", credits: 17500, usd: 50 },
  { id: "org-100", credits: 36000, usd: 100 },
]

/**
 * Prepaid packs an ORGANIZATION can buy (E2/P13). Identical to the personal
 * ladder — owner decision, 2026-08-26 — down to the Stripe price ids: the same product
 * is sold, and what makes the purchase an org purchase is the checkout's
 * `metadata.payerKind === "org"` plus the org-owned Stripe customer, never a
 * different price. Each pack takes the price id of the TOP_UPS row that grants
 * the same credits, and a guard test pins each pack's (priceId, credits) to
 * that row, so a personal re-rate cannot silently drift the two ladders apart.
 */
export const ORG_TOP_UPS: Record<string, OrgPack> = Object.fromEntries(
  ORG_PACK_LADDER.flatMap(({ id, credits, usd }): Array<[string, OrgPack]> => {
    const priceId = Object.keys(TOP_UPS).find((price) => TOP_UPS[price] === credits)
    return priceId ? [[id, { priceId, credits, usd }]] : []
  }),
)

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
    ...GEMINI_OMNI_12_4K_COMPOSITES,
  ],
  watermark: true,
} as const

export function getTierFromPriceId(priceId: string): string {
  return PRICE_TO_PLAN[priceId]?.plan ?? "free"
}

export function getTopupCredits(priceId: string): number | null {
  return TOP_UPS[priceId] ?? null
}

