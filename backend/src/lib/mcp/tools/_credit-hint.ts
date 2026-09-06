/**
 * DERIVED CREDIT FIGURES FOR TOOL DESCRIPTIONS (audit 2026-09-06 fix #4 —
 * A-1 / C-7). Hand-typed prices in descriptions sat a full repricing stale
 * (10–12× off the table: "kling-turbo (5s, 10 credits)" vs 110; "wav2lip
 * (1 cr)" vs 10) — every agent read a wrong price. The rule is the one
 * `VIDEO_ANALYSIS_PRICING_HINT` set: a description may carry a number only
 * when it is read from `STATIC_CREDIT_COSTS` at registration. The tripwire
 * is `credit-hints.test.ts`, which fails on any `<n> cr|credits` literal in
 * this directory.
 *
 * These are LIST prices (the static table); a deployment's per-model
 * overrides and markup apply at charge time, which `list_models` reports.
 *
 * EDITION GATE: the table lives under `ee/billing`, which only the cloud
 * edition backs with tables. Off-cloud every hint is the same pointer
 * `list_models` answers with for `pricing`, and the table is never read.
 */
import { hasCredits } from "../../../lib/config.js"
import { STATIC_CREDIT_COSTS } from "../../../ee/billing/credits.js"
import { isPerSecondLipSyncProvider } from "@nodaro/shared"

const OFF_CLOUD = "credits: see list_models"

/** The static list price for a credit id; throws at registration on a typo. */
export function creditsOf(id: string): number {
  const v = STATIC_CREDIT_COSTS[id]
  if (typeof v !== "number") throw new Error(`unknown credit id in a tool description: ${id}`)
  return v
}

/** `"<n> cr"` for a credit id. */
export function creditHint(id: string): string {
  return hasCredits() ? `${creditsOf(id)} cr` : OFF_CLOUD
}

/** `"<n> cr/s"` for a per-second lip-sync provider, from its 15 s bucket. */
export function perSecondHint(provider: string): string {
  return hasCredits() ? `${creditsOf(`${provider}:15s`) / 15} cr/s` : OFF_CLOUD
}

/**
 * The price parenthetical for one lip-sync model in a model list:
 * ` (<n> cr/15s)` for a per-second provider, ` (<n> cr)` for a flat one,
 * ` (duration-tiered)` for a tiered one, and nothing off-cloud.
 */
export function lipSyncPriceSuffix(id: string): string {
  if (!hasCredits()) return ""
  const flat = STATIC_CREDIT_COSTS[id]
  const bucket = STATIC_CREDIT_COSTS[`${id}:15s`]
  if (typeof bucket === "number" && isPerSecondLipSyncProvider(id)) return ` (${bucket} cr/15s)`
  const tiered =
    STATIC_CREDIT_COSTS[`${id}:8s:480p`] !== undefined || STATIC_CREDIT_COSTS[`${id}:4s:480p`] !== undefined
  if (typeof flat === "number" && !tiered) return ` (${flat} cr)`
  return " (duration-tiered)"
}
