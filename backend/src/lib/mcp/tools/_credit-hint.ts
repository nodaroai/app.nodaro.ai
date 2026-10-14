/**
 * DERIVED CREDIT FIGURES FOR TOOL DESCRIPTIONS (audit 2026-09-06 fix #4 —
 * A-1 / C-7). Hand-typed prices in descriptions sat a full repricing stale
 * (10–12× off the table: "kling-turbo (5s, 10 credits)" vs 110; "wav2lip
 * (1 cr)" vs 10) — every agent read a wrong price. The rule: a description
 * may carry a number only when it is derived here at registration. The
 * tripwire is `credit-hints.test.ts`, which fails on any `<n> cr|credits`
 * literal in this directory.
 *
 * These are CHARGED prices — what a run costs on Nodaro Cloud, the figure on
 * the Run button — never a price-table row before the pricing settings apply:
 * `statedPrices()` (`ee/billing/stated-prices.ts`) prices each id with the
 * server's own price-table rule at the hosted deployment's settings, the same
 * rule the public docs are held to. `list_models` reports the live figure.
 *
 * DOCS ANNOTATIONS: `docs/mcp/tool-parameters.md` is rendered from these
 * descriptions, and every price figure in `docs/` names its price id
 * (`docs-charged-prices.test.ts`). The gen-skills capture sets
 * `NODARO_PRICE_ANNOTATIONS=1` (`scripts/lib/gen-skills/tool-surface.ts`), and
 * only then does a figure carry its invisible `<!-- credits: <id> -->`; the
 * wire never does.
 *
 * EDITION GATE: the table lives under `ee/billing`, which only the cloud
 * edition backs with tables. Off-cloud every hint is the same pointer
 * `list_models` answers with for `pricing`, and the table is never read.
 */
import { hasCredits } from "../../../lib/config.js"
import { STATIC_CREDIT_COSTS } from "../../../ee/billing/credits.js"
import { statedPrices } from "../../../ee/billing/stated-prices.js"
import { isPerSecondLipSyncProvider } from "@nodaro/shared/credits"

const OFF_CLOUD = "credits: see list_models"

/** The charged price for a credit id; throws at registration on a typo. */
export function creditsOf(id: string): number {
  const v = statedPrices().credits(id)
  if (typeof v !== "number") throw new Error(`unknown credit id in a tool description: ${id}`)
  return v
}

/** `n` as a description states it — with its price id attached when rendering the docs. */
function stated(n: number, id: string): string {
  return process.env.NODARO_PRICE_ANNOTATIONS === "1" ? `${n}<!-- credits: ${id} -->` : `${n}`
}

/** `"<n> cr"` for a credit id. */
export function creditHint(id: string): string {
  return hasCredits() ? `${stated(creditsOf(id), id)} cr` : OFF_CLOUD
}

/** `"<a>/<b>/… credits"` — one charged figure per id, in order (a duration-bucket ladder). */
export function creditLadderHint(ids: readonly string[]): string {
  return hasCredits() ? `${ids.map((id) => stated(creditsOf(id), id)).join("/")} credits` : OFF_CLOUD
}

/**
 * The price parenthetical for one lip-sync model in a model list:
 * ` (<n> cr/15s)` for a per-second provider, ` (<n> cr)` for a flat one,
 * ` (duration-tiered)` for a tiered one, and nothing off-cloud.
 */
export function lipSyncPriceSuffix(id: string): string {
  if (!hasCredits()) return ""
  const bucket = `${id}:15s`
  if (typeof STATIC_CREDIT_COSTS[bucket] === "number" && isPerSecondLipSyncProvider(id)) return ` (${stated(creditsOf(bucket), bucket)} cr/15s)`
  const tiered =
    STATIC_CREDIT_COSTS[`${id}:8s:480p`] !== undefined || STATIC_CREDIT_COSTS[`${id}:4s:480p`] !== undefined
  if (typeof STATIC_CREDIT_COSTS[id] === "number" && !tiered) return ` (${stated(creditsOf(id), id)} cr)`
  return " (duration-tiered)"
}
