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
import { LLM_FEATURE_DEFAULTS, getLlmModel, llmDefaultsFeature, llmPriceKey, type LlmFeature } from "@nodaro/shared/llm-models"
import type { MeteredLlmFeature } from "../../../ee/billing/llm-typical-usage.js"

/** Re-exported so tool files name a metered feature without importing ee/ themselves. */
export type { MeteredLlmFeature }

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

/** The model a metered LLM feature runs on when the caller names none (borrowed defaults included). */
export function llmFeatureDefaultModel(feature: MeteredLlmFeature): string {
  return LLM_FEATURE_DEFAULTS[llmDefaultsFeature(feature) as LlmFeature]
}

/** Where every model's per-token rate is stated. */
const LLM_RATES_PAGE = "docs/pricing/llm-models.md"

/**
 * The estimate hint for a METERED LLM call: `"≈N credits typical on <Model>"`
 * — what the server quotes before a run of `feature` on `modelId` (its
 * metered price key, `llmPriceKey`; `POST /v1/credits/model-costs` answers it
 * live), the `≈N` the Run button shows. A metered call is charged per token at
 * the model's rate, never a fixed price, so the figure is always written as
 * approximate; it still carries its price key when rendering the docs, so the
 * docs test holds it to the server's estimate.
 *
 * NEVER THROWS (tool registration runs at boot). Off-cloud it is the off-cloud
 * pointer; under the `LLM_TIER_PRICING_ROLLBACK` switch (metered keys are then
 * priced nowhere) and for a model with no price it names no figure.
 * `creditsOf` cannot price a metered key and would throw there.
 */
export function estimateHint(feature: MeteredLlmFeature, modelId: string = llmFeatureDefaultModel(feature)): string {
  if (!hasCredits()) return OFF_CLOUD
  const name = getLlmModel(modelId)?.displayName ?? modelId
  try {
    const key = llmPriceKey(feature, modelId)
    const credits = statedPrices().credits(key)
    if (credits !== undefined) return `≈${stated(credits, key)} credits typical on ${name}`
  } catch {
    // fall through to the figure-free hint
  }
  return `on ${name}, see ${LLM_RATES_PAGE}`
}

/**
 * The pricing sentence for a tool whose LLM call is metered: charged per
 * token at the model's rate, the typical figure on `modelId` (the feature's
 * default when omitted), and where every model's rate is stated.
 */
export function meteredLlmPriceSentence(feature: MeteredLlmFeature, modelId?: string): string {
  if (!hasCredits()) return `(${OFF_CLOUD})`
  return `Charged per token at the model's rate: ${estimateHint(feature, modelId)} (every model: ${LLM_RATES_PAGE}).`
}
