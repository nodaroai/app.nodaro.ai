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
import { AUDIO_ISOLATION_RATE_ID, LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS, isPerSecondLipSyncProvider, isSeedanceLipSyncProvider, lipSyncAudioRateOf, motionTransferRateOf, seedanceLipSyncCreditId, videoToVideoClipRateOf, WAN_VIDEOEDIT_FLOOR_CREDIT_ID } from "@nodaro/shared/credits"
import { LLM_FEATURE_DEFAULTS, getLlmModel, llmDefaultsFeature, llmPriceKey, type LlmFeature } from "@nodaro/shared/llm-models"
import type { MeteredLlmFeature } from "../../../ee/billing/llm-typical-usage.js"
import { amountAbbreviation, amountWord, statedAmount, unitFields } from "../amounts.js"

/** Re-exported so tool files name a metered feature without importing ee/ themselves. */
export type { MeteredLlmFeature }

const OFF_CLOUD = "credits: see list_models"

/** The charged price for a credit id; throws at registration on a typo. */
export function creditsOf(id: string): number {
  const v = statedPrices().credits(id)
  if (typeof v !== "number") throw new Error(`unknown credit id in a tool description: ${id}`)
  return v
}

/**
 * `n` as a description states it — in the deployment's unit when it has one
 * (`lib/mcp/amounts.ts`, the one funnel), with its price id attached when
 * rendering the docs. The docs are rendered in credits, so a figure in a
 * deployment's own unit never carries a credits annotation.
 */
function stated(n: number, id: string): string {
  if (unitFields().unit !== undefined) {
    const shown = statedAmount(n)
    return shown === null ? "?" : `${shown}`
  }
  return process.env.NODARO_PRICE_ANNOTATIONS === "1" ? `${n}<!-- credits: ${id} -->` : `${n}`
}

/** The charged price of a credit id as a figure a sentence states (`"<n>"`, in the deployment's unit when it has one). */
export function statedCreditsOf(id: string): string {
  const shown = statedAmount(creditsOf(id))
  return shown === null ? "?" : `${shown}`
}

/** `"<n> cr"` for a credit id. */
export function creditHint(id: string): string {
  return hasCredits() ? `${stated(creditsOf(id), id)} ${amountAbbreviation()}` : OFF_CLOUD
}

/** `"<a>/<b>/… credits"` — one charged figure per id, in order (a duration-bucket ladder). */
export function creditLadderHint(ids: readonly string[]): string {
  return hasCredits() ? `${ids.map((id) => stated(creditsOf(id), id)).join("/")} ${amountWord()}` : OFF_CLOUD
}

/** The charged price of `units` of a per-unit rate; throws at registration on a rate priced nowhere. */
function rateCreditsOf(rateId: string, units: number): number {
  const v = statedPrices().credits(rateId, units)
  if (typeof v !== "number") throw new Error(`unknown credit rate in a tool description: ${rateId}`)
  return v
}

/**
 * The price parenthetical for one lip-sync model in a model list:
 * ` (<n> cr/15s)` for a per-second provider, ` (<n> cr)` for a flat one,
 * ` (duration-tiered)` for a tiered one, a Seedance model's 8-second clip at
 * 720p, and nothing off-cloud. A model
 * charged per second of its audio at a rate (OmniHuman 2.0) states 15 seconds
 * and its minimum charge, each the whole run's charged price.
 */
export function lipSyncPriceSuffix(id: string): string {
  if (!hasCredits()) return ""
  const rate = lipSyncAudioRateOf(id)
  if (rate) {
    const per15 = stated(rateCreditsOf(rate.rateId, LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS), `${rate.rateId}@${LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS}`)
    const least = stated(rateCreditsOf(rate.rateId, rate.minSeconds), `${rate.rateId}@${rate.minSeconds}`)
    const cr = amountAbbreviation()
    return ` (${per15} ${cr}/15s, per second of audio, at least ${least} ${cr})`
  }
  // A Seedance model: one 8-second clip, priced by the resolution it renders
  // (decided 2026-11-16) — its 720p price, the default.
  if (isSeedanceLipSyncProvider(id)) {
    const at720 = seedanceLipSyncCreditId(id, "720p")
    return ` (8s clip: ${stated(creditsOf(at720), at720)} ${amountAbbreviation()} at 720p, by resolution)`
  }
  const bucket = `${id}:15s`
  if (typeof STATIC_CREDIT_COSTS[bucket] === "number" && isPerSecondLipSyncProvider(id)) return ` (${stated(creditsOf(bucket), bucket)} ${amountAbbreviation()}/15s)`
  const tiered =
    STATIC_CREDIT_COSTS[`${id}:8s:480p`] !== undefined || STATIC_CREDIT_COSTS[`${id}:4s:480p`] !== undefined
  if (typeof STATIC_CREDIT_COSTS[id] === "number" && !tiered) return ` (${stated(creditsOf(id), id)} ${amountAbbreviation()})`
  return " (duration-tiered)"
}

/**
 * Motion Transfer's price sentence for a tool description: every model and
 * size is charged per second of the driving video the server reads — the
 * whole run's charged price for 10 seconds at 720p on the two Kling models —
 * and Wan Animate never below its flat price for the size. Off-cloud, the
 * `list_models` pointer.
 */
export function motionTransferPriceHint(): string {
  if (!hasCredits()) return OFF_CLOUD
  const tenSeconds = (provider: string): string => {
    const rate = motionTransferRateOf(provider, "720p")
    const units = 10 / rate.rateSeconds
    return stated(rateCreditsOf(rate.rateId, units), `${rate.rateId}@${units}`)
  }
  return `Per second (10 s at 720p: ${tenSeconds("kling")} ${amountAbbreviation()} kling, ${tenSeconds("kling-3.0")} kling-3.0); Wan Animate min its flat price.`
}

/**
 * Video to Video's price sentence for the models priced by their clip's
 * length: HappyHorse Edit at 720p and Wan 2.7 VideoEdit, each the whole run's
 * charged price for a 10-second clip, and Wan 2.7 VideoEdit's least charge
 * (its flat row). Off-cloud, the `list_models` pointer.
 */
export function videoToVideoClipPriceHint(): string {
  if (!hasCredits()) return OFF_CLOUD
  const hh = videoToVideoClipRateOf("happyhorse-edit", "720p")
  const wan = videoToVideoClipRateOf("wan-videoedit", "1080p")
  if (!hh || !wan) throw new Error("Video to Video has no clip rate")
  const cr = amountAbbreviation()
  const hhUnits = 10 / hh.rateSeconds
  const wanUnits = 10 / wan.rateSeconds
  return `per 10 s: happyhorse-edit 720p ${stated(rateCreditsOf(hh.rateId, hhUnits), `${hh.rateId}@${hhUnits}`)} ${cr}, ` +
    `wan-videoedit ${stated(rateCreditsOf(wan.rateId, wanUnits), `${wan.rateId}@${wanUnits}`)}, min ${stated(creditsOf(WAN_VIDEOEDIT_FLOOR_CREDIT_ID), WAN_VIDEOEDIT_FLOOR_CREDIT_ID)}`
}

/**
 * Audio Isolation's price for a tool description: the charged price of one
 * started 10 seconds of the audio. Off-cloud, the `list_models` pointer.
 */
export function audioIsolationPriceHint(): string {
  if (!hasCredits()) return OFF_CLOUD
  return `${stated(rateCreditsOf(AUDIO_ISOLATION_RATE_ID, 1), `${AUDIO_ISOLATION_RATE_ID}@1`)} ${amountAbbreviation()} per started 10 s`
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
    if (credits !== undefined) return `≈${stated(credits, key)} ${amountWord()} typical on ${name}`
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
