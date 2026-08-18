/**
 * LLM provider-cost formula — CORE (not ee/): `backend/src/lib/llm-client.ts`
 * needs the real USD cost for internal cost logging regardless of edition,
 * and `ee/billing/credits.ts` needs it to price nodes. (`video-analysis-cost.ts`
 * is gone — that formula moved into the private analysis plugin in 2026-07.) The model-id enum, capabilities, and tier/feature
 * registries stay in `@nodaro/shared` (`llm-models.ts`) — this file holds
 * only the provider-$ per-token rate table and the cost formula derived
 * from it.
 *
 * Moved out of `packages/shared` (published Apache-2.0 on npm — an
 * irrevocable grant) per the 2026-07-06 public-flip IP audit, S5: keep the
 * model-id enum in the shared package; strip provider rates into this file.
 *
 * ─── Derivation notes (gemini-3-flash) ──────────────────────────────────────
 * Rates are pinned to actual provider billing. Video ingestion bills at the
 * SAME per-token rate as text.
 *
 * ─── Derivation notes (gemini-3.1-pro) ──────────────────────────────────────
 * Rates are pinned to actual provider billing on prompt/completion tokens.
 * The previous 3.50/10.50 rates (an earlier, less current price point) no
 * longer matched provider billing and mispriced the video-analysis pro
 * buckets; reconciled to the current rates via a convergence migration (see
 * `supabase/migrations/248_video_analysis_pro_reprice.sql`), which derived
 * [2,3,7,11].
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { LlmModelDef } from "@nodaro/shared"

/**
 * Which upstream actually served the call. The SAME model id bills at very
 * different rates per lane — Google's list price for Gemini runs ~3.3–4× what
 * KIE resells it for — so a rate row is meaningless without one of these.
 */
export type LlmServingLane = "kie" | "direct"

interface LlmModelRateUsd {
  /** Cost per million input tokens (USD) */
  inputPricePerM: number
  /** Cost per million output tokens (USD) */
  outputPricePerM: number
  /**
   * Some vendors step up to a second price band once the PROMPT crosses a
   * token count (Gemini 3.1 Pro doubles at 200k). When set, `longContext`
   * rates apply to the whole call as soon as `inputTokens` exceeds this.
   * Absent = one flat band, which is the common case.
   */
  longContextThresholdTokens?: number
  longContext?: { inputPricePerM: number; outputPricePerM: number }
}

/** Per-model USD/M-token provider rates, keyed by the shared LLM_MODEL_IDS enum. */
const LLM_MODEL_RATES_USD_PER_M: Record<string, LlmModelRateUsd> = {
  "gemini-3-flash":    { inputPricePerM: 0.15,  outputPricePerM: 0.90 },
  // KIE list price 90/450 KIE-credits per M ($0.005/credit) — ~30% of the
  // official vendor price (confirmed 2026-07-26). 3× the 3-flash rate.
  "gemini-3.6-flash":  { inputPricePerM: 0.45,  outputPricePerM: 2.25 },
  // KIE list price unpublished at add time (2026-08-18) — pinned to Google's
  // own INTRO rate as the margin-safe ceiling; revisit when KIE lists it.
  "gemini-3.7-flash":  { inputPricePerM: 0.75,  outputPricePerM: 3.75 },
  "claude-haiku-4.5":  { inputPricePerM: 0.80,  outputPricePerM: 4.00 },
  "claude-sonnet-4.6": { inputPricePerM: 3.00,  outputPricePerM: 15.00 },
  "gpt-5.2":           { inputPricePerM: 2.50,  outputPricePerM: 10.00 },
  "gemini-3.1-pro":    { inputPricePerM: 0.50,  outputPricePerM: 3.50 },
  // KIE-routed models below are pinned to KIE's published list prices
  // (kie.ai/claude-opus-4-7, kie.ai/gpt-5-4, kie.ai/gpt-5-5, kie.ai/gpt-5-6,
  // kie.ai/claude-sonnet-5, kie.ai/claude-opus-4-8).
  "claude-opus-4.7":   { inputPricePerM: 1.425, outputPricePerM: 7.15 },
  "gpt-5.4":           { inputPricePerM: 0.70,  outputPricePerM: 5.60 },
  "gpt-5.5":           { inputPricePerM: 1.40,  outputPricePerM: 8.40 },
  "gpt-5.6-luna":      { inputPricePerM: 0.28,  outputPricePerM: 1.68 },
  "gpt-5.6-terra":     { inputPricePerM: 0.70,  outputPricePerM: 4.20 },
  "gpt-5.6-sol":       { inputPricePerM: 1.40,  outputPricePerM: 8.40 },
  // KIE list price 160/480 KIE-credits per M ($0.005/credit) — 40% of xAI's
  // official $2/$6 (confirmed 2026-08-18, docs.kie.ai/market/grok/grok-4-6).
  // Cached input reprices to $0.20/M on KIE's side; the table models the flat
  // uncached band and `credits_consumed` capture keeps provider_cost honest.
  "grok-4.6":          { inputPricePerM: 0.80,  outputPricePerM: 2.40 },
  "claude-sonnet-5":   { inputPricePerM: 0.85,  outputPricePerM: 4.275 },
  "claude-opus-4.8":   { inputPricePerM: 2.00,  outputPricePerM: 10.00 },
  // KIE list price 400/2000 KIE-credits per M ($0.005/credit) — ~40% of the
  // official vendor price (confirmed 2026-07-27).
  "claude-opus-5":     { inputPricePerM: 2.00,  outputPricePerM: 10.00 },
  // KIE list price 800/4000 KIE-credits per M ($0.005/credit) — ~40% of the
  // official vendor price (confirmed 2026-07-26).
  "claude-fable-5":    { inputPricePerM: 4.00,  outputPricePerM: 20.00 },
}

/**
 * Google list prices for the DIRECT lane (`GEMINI_API_KEY` →
 * generativelanguage), keyed by our model id — NOT by the `-preview`-suffixed
 * Google id, so callers never have to translate. Verified against
 * ai.google.dev/gemini-api/docs/pricing on 2026-07-28.
 *
 * These sit 3.3–4× above the KIE rows above, which is the whole reason lane
 * routing is a per-model decision (`preferDirect` in the shared registry)
 * rather than a global switch.
 *
 * The Anthropic rows below cover the direct-SDK lane (`ANTHROPIC_API_KEY` →
 * api.anthropic.com), which every model carrying `directFallbackModel` can
 * reach. Two of them — `claude-haiku-4.5` and `claude-sonnet-4.6` — declare no
 * `preferKie`, so they are served DIRECT by default whenever the key is set,
 * not just on fallback. Anthropic list prices verified 2026-07-28.
 *
 * `claude-sonnet-5` is pinned to its standard $3/$15 rather than the
 * introductory $2/$10 running through 2026-08-31: the intro rate would make
 * this table silently wrong the day it lapses, and over-reporting cost during
 * the promo is the safe direction to be wrong in.
 */
const LLM_DIRECT_RATES_USD_PER_M: Record<string, LlmModelRateUsd> = {
  "gemini-3-flash": { inputPricePerM: 0.50, outputPricePerM: 3.00 },
  "gemini-3.6-flash": { inputPricePerM: 1.50, outputPricePerM: 7.50 },
  // INTRO pricing through 2026-12-31 ($0.75/$3.75); standard $1.50/$7.50
  // applies 2027-01-01 — bump this row then (Google launch pricing,
  // verified 2026-08-18).
  "gemini-3.7-flash": { inputPricePerM: 0.75, outputPricePerM: 3.75 },
  "gemini-3.1-pro": {
    inputPricePerM: 2.00,
    outputPricePerM: 12.00,
    // Google doubles the input band and steps output to $18 once the prompt
    // clears 200k. Video-analysis on long inputs reaches this routinely, so
    // it is modelled rather than averaged away.
    longContextThresholdTokens: 200_000,
    longContext: { inputPricePerM: 4.00, outputPricePerM: 18.00 },
  },
  // Anthropic direct-SDK lane.
  "claude-haiku-4.5": { inputPricePerM: 1.00, outputPricePerM: 5.00 },
  "claude-sonnet-4.6": { inputPricePerM: 3.00, outputPricePerM: 15.00 },
  "claude-opus-4.7": { inputPricePerM: 5.00, outputPricePerM: 25.00 },
  "claude-sonnet-5": { inputPricePerM: 3.00, outputPricePerM: 15.00 },
  "claude-opus-4.8": { inputPricePerM: 5.00, outputPricePerM: 25.00 },
  "claude-opus-5": { inputPricePerM: 5.00, outputPricePerM: 25.00 },
  "claude-fable-5": { inputPricePerM: 10.00, outputPricePerM: 50.00 },
}

/**
 * Calculate provider cost in USD from token usage and model pricing.
 *
 * `lane` selects the rate table — it defaults to `"kie"` so every pre-existing
 * call site keeps its exact previous behaviour. Pass `"direct"` only when the
 * vendor's own API served the call.
 */
export function calculateLlmCost(
  modelOrId: string | LlmModelDef,
  usage: { inputTokens: number; outputTokens: number },
  lane: LlmServingLane = "kie",
): number {
  const id = typeof modelOrId === "string" ? modelOrId : modelOrId.id
  // A missing direct row falls back to the KIE row rather than to $0 — an
  // under-report of a real spend is worse than a stale-but-nonzero estimate.
  const rate = (lane === "direct" ? LLM_DIRECT_RATES_USD_PER_M[id] : undefined) ?? LLM_MODEL_RATES_USD_PER_M[id]
  if (!rate) return 0
  const band =
    rate.longContext && rate.longContextThresholdTokens !== undefined &&
    usage.inputTokens > rate.longContextThresholdTokens
      ? rate.longContext
      : rate
  return (usage.inputTokens * band.inputPricePerM + usage.outputTokens * band.outputPricePerM) / 1_000_000
}

/** Test/introspection hook: model ids carrying a direct-lane rate row. */
export function directRatedModelIds(): string[] {
  return Object.keys(LLM_DIRECT_RATES_USD_PER_M)
}
