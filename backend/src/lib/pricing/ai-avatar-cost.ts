/**
 * AI Avatar (HeyGen) provider-cost formulas — CORE (not ee/): the HeyGen
 * provider integration (`providers/heygen/video.ts`) needs the real USD cost
 * regardless of edition, and `ee/billing/credits.ts` needs it to seed the
 * at-cost credit-hold table. Everything NON-monetary (engine/resolution
 * types, duration buckets, the credit-id builder) stays in
 * `@nodaro/shared` — this file holds only the provider-$ rate table and the
 * formulas derived from it.
 *
 * Moved out of `packages/shared` (published Apache-2.0 on npm — an
 * irrevocable grant) per the 2026-07-06 public-flip IP audit, S5: provider
 * rate cards and margin-derivation math must not ship in the published
 * package. See plan.nodaro.ai `specs/superpowers/2026-07-06-public-flip-ip-audit.md`.
 *
 * ─── Derivation notes ───────────────────────────────────────────────────────
 * "avatar-iv" 720p is CONFIRMED against an actual production run; rounded
 *   conservatively to $0.06/s.
 *
 *   1080p: HeyGen public info ~$4/min = $0.0667/s → rounded to $0.08/s.
 *   4K: ESTIMATE ~2× 1080p = $0.16/s (not yet confirmed against a paid run).
 *
 * "avatar-v": ALL cells are UNPINNED ESTIMATES (premium engine, not yet
 *   tested on a paid run). Must be confirmed before avatar-v becomes default.
 *
 * ─── Ship-gate ──────────────────────────────────────────────────────────────
 * Non-720p-IV and all avatar-v cells are estimates. The `audit-credits` skill
 * + a paid Avatar-V test must confirm these values before those combinations
 * are enabled in production. Update this file and reseed the DB migration when
 * confirmed (follow the Provider Enum Sync checklist steps 7–9).
 * ────────────────────────────────────────────────────────────────────────────
 */
import { AI_AVATAR_MAX_DURATION_SEC } from "@nodaro/shared"
import type { AiAvatarEngine, AiAvatarResolution } from "@nodaro/shared"

/**
 * Per-second USD cost that HeyGen charges Nodaro.
 * These are PROVIDER costs — NOT Nodaro credits.
 * Credits are derived at billing time: ceil(usdCost / CREDIT_BASE_USD) with markup.
 */
export const AI_AVATAR_RATE_USD_PER_SEC: Record<AiAvatarEngine, Record<AiAvatarResolution, number>> = {
  // avatar-iv: 720p anchored (live test); 1080p rounded from /min; 4k estimate.
  "avatar-iv": { "720p": 0.06, "1080p": 0.08, "4k": 0.16 },
  // avatar-v: ALL UNPINNED ESTIMATES — must be confirmed before avatar-v is default.
  "avatar-v":  { "720p": 0.08, "1080p": 0.10, "4k": 0.20 },
}

/**
 * USD cost for a single ai-avatar generation.
 *
 * @param engine      HeyGen engine identifier
 * @param resolution  Output resolution
 * @param durationSec Fractional clip duration (e.g. 3.05633 → ceils to 4s)
 * @returns           Provider cost in USD, rounded to 4 decimal places
 */
export function aiAvatarUsdCost(
  engine: AiAvatarEngine,
  resolution: AiAvatarResolution,
  durationSec: number,
): number {
  const ratePerSec = AI_AVATAR_RATE_USD_PER_SEC[engine][resolution]
  const billedSecs = Math.ceil(durationSec)
  return Math.round(ratePerSec * billedSecs * 10000) / 10000
}

/**
 * Credit hold (the STORED 0%-base reserve) for a given (engine, resolution, bucket).
 *
 * Formula: ceil(aiAvatarUsdCost(engine, resolution, bucketSec) / 0.02)
 *
 * This is the at-cost base-credit value (1 credit = $0.02, CREDIT_BASE_USD).
 * It is deliberately MINIMAL — there is NO *1.5 safety factor — because:
 *
 *   1. The admin cost-markup (~25% default) is applied to this stored value
 *      AGAIN at RESERVE time by getModelCreditCostFromDB
 *      (reserved = ceil(hold * 1.25)). Baking a second buffer here was a
 *      redundant double-markup — the user-reported over-reservation bug.
 *   2. The reserve buckets UP (true clip duration ≤ bucket ceiling), so the
 *      bucket-up alone guarantees reserved ≥ metered-actual.
 *
 * Refund-only invariant (verified by the pricing test): for every bucket at its
 * CEILING duration, reserved = ceil(hold * markup) EQUALS the metered actual
 * = ceil(ceil(usd/0.02) * markup) — they share the exact same base. For any
 * shorter clip the metered actual is strictly less. So commit_credits
 * (computeActualCredits at job completion) can only ever REFUND surplus, never
 * undercharge. No epsilon is needed — the bases are identical at the boundary.
 */
export function aiAvatarHoldCredits(
  engine: AiAvatarEngine,
  resolution: AiAvatarResolution,
  bucketSec: number,
): number {
  return Math.ceil(aiAvatarUsdCost(engine, resolution, bucketSec) / 0.02)
}

/**
 * Worst-case USD cost for a given (engine, resolution) combination.
 * Used to derive the credit ceiling seeded in STATIC_CREDIT_COSTS / DB.
 */
export function aiAvatarReserveCeilingUsd(
  engine: AiAvatarEngine,
  resolution: AiAvatarResolution,
): number {
  return aiAvatarUsdCost(engine, resolution, AI_AVATAR_MAX_DURATION_SEC)
}
