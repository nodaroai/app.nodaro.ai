// Whether a model may be run at all, before any balance question — in the
// guard's order: the admin switch (`model_pricing.is_enabled`), the tier
// restriction (`model_pricing.tier_restriction`) against the caller's gate
// tier, then the free-tier model blocklist (`FREE_TIER_RESTRICTIONS
// .blockedModels`) under free-tier semantics.
//
// The ONE place this decision lives. The credit guard's preflight
// (`CreditsService.checkCreditsWithProfile`) refuses a run with it, and the
// UGC quote (`ee/lib/ugc-quote.ts`) refuses to price what the guard would
// refuse — both against gates from `spendGates` (org-entitlements.ts), so the
// two can never disagree about which models are runnable, for any payer.
import type { ModelPricing } from "./credits.js"
import type { EffectiveBillingGates } from "./org-entitlements.js"
import { FREE_TIER_RESTRICTIONS } from "./stripe-config.js"

// Tier order for restriction checks. payg ranks above free and below basic:
// inert while all model_pricing.tier_restriction seeds are null, but keeps an
// admin-set "basic and up" restriction meaning "not for payg" deliberately.
export const TIER_ORDER = ["free", "payg", "basic", "standard", "pro", "business"] as const

export type ModelAvailabilityRefusal =
  | { readonly reason: "disabled"; readonly error: string }
  | { readonly reason: "tier"; readonly error: string }
  | { readonly reason: "blocked"; readonly error: string }

/** The pricing row fields the decision reads. */
export type ModelAvailabilityRow = Pick<ModelPricing, "isEnabled" | "tierRestriction">

/** The gate fields the decision reads (`spendGates(...)`). */
export type ModelAvailabilityGates = Pick<EffectiveBillingGates, "tierForGates" | "freeSemantics">

function isBlocklisted(modelIdentifier: string): boolean {
  // Exact-string match on the id the route reserves under.
  return (FREE_TIER_RESTRICTIONS.blockedModels as readonly string[]).includes(modelIdentifier)
}

/**
 * Why `modelIdentifier` cannot be run under `gates`, or null when it can.
 * A disabled model is refused whatever the gates.
 */
export function modelAvailabilityRefusal(
  modelIdentifier: string,
  pricing: ModelAvailabilityRow,
  gates: ModelAvailabilityGates,
): ModelAvailabilityRefusal | null {
  if (!pricing.isEnabled) {
    return { reason: "disabled", error: "This model is currently disabled" }
  }
  if (pricing.tierRestriction) {
    const tiers: readonly string[] = TIER_ORDER
    if (tiers.indexOf(gates.tierForGates) < tiers.indexOf(pricing.tierRestriction)) {
      return {
        reason: "tier",
        error: `This model requires ${pricing.tierRestriction} tier or higher. Please upgrade your plan.`,
      }
    }
  }
  if (gates.freeSemantics && isBlocklisted(modelIdentifier)) {
    return {
      reason: "blocked",
      error: "This model requires a paid subscription. Upgrade to Basic or higher.",
    }
  }
  return null
}

/**
 * Whether the gates can change `modelAvailabilityRefusal`'s answer for this
 * row: false means the answer is the same for every payer, so a caller that
 * has to read a profile to build the gates (the UGC quote) may skip the read.
 * Pinned against the decision itself in `model-availability.test.ts`.
 */
export function modelAvailabilityNeedsGates(modelIdentifier: string, pricing: ModelAvailabilityRow): boolean {
  return pricing.isEnabled && (Boolean(pricing.tierRestriction) || isBlocklisted(modelIdentifier))
}
