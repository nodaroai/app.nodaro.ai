/**
 * The hold a metered LLM call set reserves — its charge id and its credits,
 * sized from the calls alone. A leaf: it reaches neither `credits.ts` nor the
 * credit guard, so a price surface (the UGC quote) can size a hold without
 * joining `llm-billing-impl.ts`'s import cycle. `llm-billing-impl.ts`
 * re-exports it; the reservation reads it there.
 */
import { getAppSettings } from "../../lib/app-settings.js"
import type { LlmPlannedCall } from "../../lib/llm-billing.js"
import { llmChargeId, llmHoldBaseCredits } from "./llm-metered.js"
import { parseMeteredLlmId } from "./metered-llm-id.js"
import type { MeteredLlmFeature } from "./llm-typical-usage.js"
import { applyServiceMarkup } from "./service-margin.js"

/**
 * The ONE hold formula (D1) — what `reserveLlmCallImpl` reserves through the
 * route guard and what the workflow engine reserves for a worker-queued
 * metered node (`computeLlmMeteredHold`, node-executor): Σ one attempt of each
 * planned call on its primary lane, at least 1 base credit, marked up once at
 * `llmChargeId(feature, calls[0].modelId)`. Throws `LlmUnpricedModelError` for
 * a model with no rate on a lane it may be served on, and a plain Error for a
 * feature that does not bill metered (a plugin's loose string), whose id no
 * settle or price surface would understand.
 */
export async function llmHoldForCalls(
  feature: MeteredLlmFeature,
  calls: readonly [LlmPlannedCall, ...LlmPlannedCall[]],
): Promise<{ chargeId: string; holdCredits: number }> {
  const chargeId = llmChargeId(feature, calls[0].modelId)
  let holdBase = 0
  for (const call of calls) {
    holdBase += llmHoldBaseCredits(call.modelId, {
      request: call.request,
      mediaSeconds: call.mediaSeconds,
      cheapLanesOnly: call.cheapLanesOnly,
    })
  }
  if (!parseMeteredLlmId(chargeId)) throw new Error(`reserveLlmCall: "${feature}" is not a metered LLM feature`)
  // At least one credit, so a metered job always holds something (the settle charges at least the floor).
  const holdCredits = applyServiceMarkup(Math.max(1, holdBase), await getAppSettings(), chargeId)
  return { chargeId, holdCredits }
}
