/**
 * Cinematic Avatar (HeyGen `type:"cinematic_avatar"`) provider-cost formulas —
 * CORE (not ee/): `providers/heygen/cinematic.ts` needs the real USD cost
 * regardless of edition, and `ee/billing/credits.ts` needs it to seed the
 * at-cost credit-hold table. Everything NON-monetary (the resolution type,
 * duration clamp/bounds, the credit-id builder) stays in `@nodaro/shared` —
 * this file holds only the provider-$ rate table and the formulas derived
 * from it.
 *
 * Moved out of `packages/shared` (published Apache-2.0 on npm — an
 * irrevocable grant) per the 2026-07-06 public-flip IP audit, S5.
 *
 * ─── How this differs from ai-avatar pricing ────────────────────────────────
 * Cinematic Avatar is a generative clip (Seedance-style pipeline) driven by a
 * prompt + 1–3 avatar look ids. Crucially, `duration` is a USER PARAMETER
 * (4–15s, clamped) and is therefore KNOWN at submit time — unlike ai-avatar's
 * text/audio script whose clip length is only estimated. So the reserve here is
 * EXACT (no duration-bucket estimation): the credit id encodes the exact
 * requested duration, and the metered true-up at commit refunds nothing in the
 * common case (provider returns the requested duration).
 *
 * ─── Rate (ESTIMATE — ship-gate) ────────────────────────────────────────────
 * CINEMATIC_RATE_USD_PER_SEC values below are UNCONFIRMED placeholders for the
 * generative Seedance pipeline. They MUST be confirmed via a PAID run before
 * cinematic-avatar ships to production (run the `audit-credits` skill + a paid
 * generation, then update this file and reseed the DB migration — follow the
 * Provider Enum Sync checklist steps 7–9).
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { CinematicResolution } from "@nodaro/shared"

/**
 * Per-second USD cost that HeyGen charges Nodaro for a cinematic_avatar clip.
 * These are PROVIDER costs — NOT Nodaro credits. Credits are derived at billing
 * time: ceil(usdCost / CREDIT_BASE_USD) with markup.
 *
 * UNCONFIRMED ESTIMATE — confirm via a paid run per the audit-credits ship-gate
 * before enabling cinematic-avatar in production.
 */
export const CINEMATIC_RATE_USD_PER_SEC: Record<CinematicResolution, number> = {
  // ESTIMATE (generative Seedance pipeline) — UNCONFIRMED placeholders.
  "720p": 0.15,
  "1080p": 0.22,
}

/**
 * USD cost for a single cinematic-avatar generation.
 *
 * @param resolution  Output resolution
 * @param durationSec Fractional clip duration (ceils to whole seconds)
 * @returns           Provider cost in USD, rounded to 4 decimal places
 */
export function cinematicUsdCost(
  resolution: CinematicResolution,
  durationSec: number,
): number {
  const ratePerSec = CINEMATIC_RATE_USD_PER_SEC[resolution]
  const billedSecs = Math.ceil(durationSec)
  return Math.round(ratePerSec * billedSecs * 10000) / 10000
}

/**
 * Credit hold (the STORED 0%-base reserve) for a given (resolution, durationSec).
 *
 * Formula: ceil(cinematicUsdCost(resolution, durationSec) / 0.02)
 *
 * This is the at-cost base-credit value (1 credit = $0.02, CREDIT_BASE_USD).
 * It is deliberately MINIMAL — there is NO *1.5 safety factor — because the
 * admin cost-markup (~25% default) is applied to this stored value AGAIN at
 * RESERVE time by getModelCreditCostFromDB (reserved = ceil(hold * 1.25)).
 * Baking a second buffer here was a redundant double-markup.
 *
 * Refund-only invariant (verified by the pricing test): because duration is a
 * user parameter known at submit time, the reserve id encodes the EXACT
 * duration, so reserved = ceil(hold * markup) = ceil(ceil(usd/0.02) * markup)
 * equals the metered actual computed at commit from the same USD cost. They
 * coincide exactly (the provider returns the requested duration), so
 * commit_credits refunds nothing in the common case and can only ever refund,
 * never undercharge.
 */
export function cinematicHoldCredits(
  resolution: CinematicResolution,
  durationSec: number,
): number {
  return Math.ceil(cinematicUsdCost(resolution, durationSec) / 0.02)
}
