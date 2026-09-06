/**
 * DERIVED CREDIT FIGURES FOR TOOL DESCRIPTIONS (audit 2026-09-06 fix #4 —
 * A-1 / C-7). Hand-typed prices in descriptions sat a full repricing stale
 * (10–12× off the table: "kling-turbo (5s, 10 credits)" vs 110; "wav2lip
 * (1 cr)" vs 10) — a live billing misquote to every agent. The rule is the
 * one `VIDEO_ANALYSIS_PRICING_HINT` set: a description may carry a number
 * only when it is read from `STATIC_CREDIT_COSTS` at registration. The
 * tripwire is `credit-hints.test.ts`, which fails on any `<n> cr|credits`
 * literal in this directory.
 *
 * These are LIST prices (the static table); a deployment's per-model
 * overrides and markup apply at charge time, which `list_models` reports.
 */
import { STATIC_CREDIT_COSTS } from "../../../ee/billing/credits.js"

/** The static list price for a credit id; throws at registration on a typo. */
export function creditsOf(id: string): number {
  const v = STATIC_CREDIT_COSTS[id]
  if (typeof v !== "number") throw new Error(`unknown credit id in a tool description: ${id}`)
  return v
}

/** `"<n> cr"` for a credit id. */
export function creditHint(id: string): string {
  return `${creditsOf(id)} cr`
}

/** `"<n> cr/s"` for a per-second lip-sync provider, from its 15 s bucket. */
export function perSecondHint(provider: string): string {
  return `${creditsOf(`${provider}:15s`) / 15} cr/s`
}
