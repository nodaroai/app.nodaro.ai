/**
 * LLM provider-cost formula — CORE (not ee/): `backend/src/lib/llm-client.ts`
 * needs the real USD cost for internal cost logging regardless of edition,
 * and `video-analysis-cost.ts` / `ee/billing/credits.ts` need it to price the
 * video-analysis node. The model-id enum, capabilities, and tier/feature
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

interface LlmModelRateUsd {
  /** Cost per million input tokens (USD) */
  inputPricePerM: number
  /** Cost per million output tokens (USD) */
  outputPricePerM: number
}

/** Per-model USD/M-token provider rates, keyed by the shared LLM_MODEL_IDS enum. */
const LLM_MODEL_RATES_USD_PER_M: Record<string, LlmModelRateUsd> = {
  "gemini-3-flash":    { inputPricePerM: 0.15,  outputPricePerM: 0.90 },
  "claude-haiku-4.5":  { inputPricePerM: 0.80,  outputPricePerM: 4.00 },
  "claude-sonnet-4.6": { inputPricePerM: 3.00,  outputPricePerM: 15.00 },
  "gpt-5.2":           { inputPricePerM: 2.50,  outputPricePerM: 10.00 },
  "gemini-3.1-pro":    { inputPricePerM: 0.50,  outputPricePerM: 3.50 },
  "claude-opus-4.7":   { inputPricePerM: 5.00,  outputPricePerM: 25.00 },
  "gpt-5.4":           { inputPricePerM: 10.00, outputPricePerM: 40.00 },
}

/** Calculate provider cost in USD from token usage and model pricing. */
export function calculateLlmCost(
  modelOrId: string | LlmModelDef,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const id = typeof modelOrId === "string" ? modelOrId : modelOrId.id
  const rate = LLM_MODEL_RATES_USD_PER_M[id]
  if (!rate) return 0
  return (usage.inputTokens * rate.inputPricePerM + usage.outputTokens * rate.outputPricePerM) / 1_000_000
}
