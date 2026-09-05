// The ONE place a workspace payer's entitlements override the profile-derived
// gates (E2/P14, W4b). Both spend sites — `checkCreditsWithProfile` (the
// guard's preflight) and `reserveCredits` (the reservation) — consume this
// helper's answers instead of re-deriving them, so the two can never disagree
// about what class work is entitled to.
//
// Every workspace-side value is READ from `ctx.entitlements` — the grade the
// resolver stamped (one hard-coded grade, decision A3, literal-typed in the
// plugin contract so a workspace context that watermarks or daily-caps cannot
// even be constructed). Nothing here re-states the grade; a second copy is
// the drift this axis keeps paying for.
//
// SCOPE RULE (guard-tested): the override may reach a spend site ONLY on a
// path that actually goes on to reserve credits under the workspace. A
// check-only route (creditGuard installed, nothing ever reserved) that
// received a workspace context would answer "allowed" out of a budget it
// never debits — a free proxy with no one paying. See
// `check-only-credit-guard.test.ts`, which pins that exclusion.
import type { BillingContext } from "../../lib/billing-context.js"

/** Profile-derived inputs, computed by the caller exactly as before P14. */
export interface ProfileDerivedGates {
  /** `effectiveTierOf(profile)` — the personal entitlement tier. */
  userTier: string
  /** The pool-aware web-spend flag AND payg-ness, already resolved. */
  webFree: boolean
}

/** The effective gate values a spend site must use. */
export interface EffectiveBillingGates {
  workspacePayer: boolean
  /** What tierRestriction (and future resolution/upload gates) compare against. */
  tierForGates: string
  /** Pool-aware web-spend semantics. A workspace payer is never web-free. */
  webFree: boolean
  /**
   * Free-tier semantics: the model blocklist, the free daily-cap branch and
   * the app-allowance economy all key on this. Class work is never free-tier
   * work — the workspace's budget is paying.
   */
  freeSemantics: boolean
  /**
   * Whether the personal-balance comparison applies. For a workspace payer it
   * does not: headroom is the RPC's atomic job (`FOR UPDATE` on the budget
   * row), and a zero-balance member doing class work must not be refused for
   * a personal balance they don't need.
   */
  personalBalance: boolean
  /** Whether the app-credits-allowance economy applies to an app run. */
  appAllowance: boolean
  /** true = no daily cap at all (class work is never personally day-capped). */
  dailyCapOff: boolean
  /** Whether free-tier watermarking may apply (workspace: never). */
  watermarkable: boolean
}

export function applyOrgEntitlements(
  derived: ProfileDerivedGates,
  ctx?: BillingContext,
): EffectiveBillingGates {
  // Deployment payer (item 9): the payer ACCOUNT's grade replaces the
  // requester's, read from the context the resolver stamped — same
  // no-second-copy rule as the workspace branch below. `personalBalance`
  // stays TRUE on purpose: the balance that gates the run is a real personal
  // pool (the PAYER's — the guard fetches that profile), unlike a workspace
  // budget whose ceiling lives in the RPC. Free semantics and the app
  // allowance are off — deployment work is prepaid class work, never
  // free-tier work.
  if (ctx?.payer === "deployment") {
    const ent = ctx.entitlements
    const capIsAlwaysNull: null = ent.dailyCapCredits
    return {
      workspacePayer: false,
      tierForGates: ent.tierForGates,
      webFree: false,
      freeSemantics: false,
      personalBalance: true,
      appAllowance: false,
      dailyCapOff: capIsAlwaysNull === null,
      watermarkable: ent.watermark,
    }
  }

  // Personal payer — including the DEGRADED personal fallback and an absent
  // context — keeps today's derivation exactly. This branch must stay
  // byte-equivalent to the pre-P14 site logic: with the flag off, nothing
  // ever constructs a workspace context, and these answers are the tree.
  if (ctx?.payer !== "workspace") {
    const freeSemantics = derived.userTier === "free" || derived.webFree
    return {
      workspacePayer: false,
      tierForGates: derived.webFree ? "free" : derived.userTier,
      webFree: derived.webFree,
      freeSemantics,
      personalBalance: true,
      appAllowance: true,
      dailyCapOff: false,
      watermarkable: freeSemantics,
    }
  }

  const ent = ctx.entitlements
  // Drift tripwire: the grade's daily cap is LITERALLY null today, so
  // `dailyCapOff` below is statically true. A numeric org daily cap cannot be
  // enforced at these sites at all — both compare against the PERSONAL
  // daily-spend counter, and an org cap needs a workspace counter, which only
  // the reserve RPC holds. The assignment below fails to compile the day the
  // contract widens `dailyCapCredits` beyond null, forcing that redesign
  // instead of silently falling back to the personal derivation.
  const capIsAlwaysNull: null = ent.dailyCapCredits
  return {
    workspacePayer: true,
    tierForGates: ent.tierForGates,
    webFree: ent.webFreeMode,
    freeSemantics: ent.freeTierBlocklist,
    personalBalance: false,
    appAllowance: ent.appCreditsAllowance,
    dailyCapOff: capIsAlwaysNull === null,
    watermarkable: ent.watermark,
  }
}
