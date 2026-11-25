// Tier lives in TWO columns on `profiles`: `tier` and `subscription_tier`.
//
// They exist for historical reasons and nothing keeps them in step, so they
// drift: every Stripe path (provision-credits, billing change-plan) wrote only
// `tier`, while the admin panel and GET /v1/me read only `subscription_tier`.
// On 2026-07-28 that surfaced as a paying Basic customer being displayed as
// "free" in admin — and looking, at a glance, like a free user who had blown
// straight through the free daily cap.
//
// Until the duplicate column is dropped, these two helpers are the only
// sanctioned way to touch tier:
//
//   READ  -> resolveEffectiveTier / resolveStoredTier (@nodaro/shared) —
//            entitlement sites use effective (payg derivation); billing/
//            provisioning writers use stored. resolveTierFrom below mirrors
//            the stored coalesce for admin display.
//   WRITE -> tierColumns(tier, fromTier)  spreads BOTH columns ("payg" NEVER written)
//
// `profiles-tier-columns.test.ts` fails the build if any writer sets `tier:`
// on a profiles update without going through tierColumns().
//
// Because every tier write comes through here, so does whatever must change
// WITH a tier: a drop from a plan with private outputs to one without also
// returns the outputs setting to public (`outputsColumnsForPlanChange`,
// lib/private-outputs-plan.ts). That is why every writer names the plan the
// profile holds before the write.

import { outputsColumnsForPlanChange } from "../../lib/private-outputs-plan.js"

/**
 * Every column that must move together when a user's tier changes.
 * Spread into a `profiles` update:
 *
 *   .update({ ...tierColumns(newTier, storedTierBefore), subscription_credits: credits })
 *
 * `fromTier` is the plan the profile holds before this write (null when it is
 * not known). A drop from a plan with private outputs (Standard, Pro,
 * Business) to one without (Free, Basic) also sets `public_outputs: true`, so
 * the person's NEW results are public again; nothing they made while private
 * is republished. Any other move leaves the setting as the person chose it.
 */
export function tierColumns(
  tier: string,
  fromTier: string | null,
): { tier: string; subscription_tier: string; public_outputs?: true } {
  return { tier, subscription_tier: tier, ...outputsColumnsForPlanChange(fromTier, tier) }
}

/**
 * Resolve a profile's effective tier. `tier` wins because it is the column the
 * Stripe paths have always written, so it is the one that tracks reality;
 * `subscription_tier` is the historical fallback for rows predating it.
 *
 * This mirrors the SQL side (`COALESCE(tier, subscription_tier, 'free')` in
 * migration 022) and credit enforcement (`resolveTier` in credits.ts).
 */
export function resolveTierFrom(profile: {
  tier?: string | null
  subscription_tier?: string | null
}): string {
  return profile.tier ?? profile.subscription_tier ?? "free"
}
