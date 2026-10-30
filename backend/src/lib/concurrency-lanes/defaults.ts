// backend/src/lib/concurrency-lanes/defaults.ts — the code default of every
// plan's lane sizes, and the one backend copy of the per-tier provider numbers
// (ee/billing/stripe-config.ts derives TIER_PARALLELISM from it; the editor's
// copy in frontend/src/lib/pricing-data.ts is removed later). No imports at
// all, so the billing constants keep their light import graph.

/** The plan tiers with a parallelism of their own, in TIER_PARALLELISM's order (`enterprise` has none). */
export const PARALLELISM_TIERS = ["free", "payg", "basic", "standard", "pro", "business"] as const

export type ParallelismTier = (typeof PARALLELISM_TIERS)[number]

/** Provider-lane size per tier: what TIER_PARALLELISM has always been. */
const PROVIDER_PER_TIER: Readonly<Record<ParallelismTier, number>> = Object.freeze({
  free: 2,
  payg: 4, // derived tier (effective-tier.ts) — entitlements = basic's
  basic: 4,
  standard: 6,
  pro: 10,
  business: 12,
})

/**
 * A plan's default sizes: provider = its parallelism; llm = max(3, 2 × provider);
 * local = max(4, 2 × provider); run = provider. A tier with no row (an unknown
 * or retired one) is sized as `free`, as the orchestrator's parallelism lookup
 * always fell back. Structurally `LaneSizes` (types.ts); a fresh object per call.
 */
export function defaultLaneSizesForTier(tier: string): { provider: number; llm: number; local: number; run: number } {
  const provider = Object.hasOwn(PROVIDER_PER_TIER, tier) ? PROVIDER_PER_TIER[tier as ParallelismTier] : PROVIDER_PER_TIER.free
  return { provider, llm: Math.max(3, 2 * provider), local: Math.max(4, 2 * provider), run: provider }
}
