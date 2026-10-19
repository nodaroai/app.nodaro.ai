/**
 * Building an `LlmResponse` from a provider reply: cost, media-ingestion floor, cap stop, KIE envelope.
 */

import type { LlmModelDef } from "@nodaro/shared/llm-models"
import { calculateLlmCost, type LlmServingLane } from "../pricing/llm-cost.js"
import { LlmLaneError, assertNotContentRefusal, assertNotOutputCapped, type ReplyEnd } from "../llm-errors.js"
import type { LlmRequest, LlmResponse } from "./types.js"

/**
 * KIE's replies carry `credits_consumed` (KIE credits) — the ACTUAL provider
 * charge for that call, which can drift from our per-token rate table as KIE
 * reprices models. The non-stream bodies carry it, and so do KIE's Claude
 * streams on whichever event states it (`parseSseStream` reads every event;
 * the Copilot reads the `/anthropic` wire's `message_delta` through
 * `kieCreditsUsdOf`). Returns undefined when the field is absent,
 * non-positive or non-numeric, so callers fall back to an estimate.
 */
const KIE_CREDIT_USD = 0.005

export function extractActualUsd(data: unknown): number | undefined {
  const kieCredits = (data as { credits_consumed?: unknown }).credits_consumed
  return typeof kieCredits === "number" && Number.isFinite(kieCredits) && kieCredits > 0
    ? kieCredits * KIE_CREDIT_USD
    : undefined
}

/**
 * Build LlmResponse with computed provider cost from token usage. When
 * `actualUsd` is supplied (real KIE `credits_consumed` billing — see
 * {@link extractActualUsd}), it wins over the per-token table estimate; the
 * table estimate is still computed (when usage is available) so it can be
 * compared against the actual for drift detection. A >25% divergence between
 * the two logs an ops signal — KIE's real price moved and the rate table in
 * `pricing/llm-cost.ts` needs a manual reprice.
 */
/**
 * The media fail-open guard. Throws when the provider reports fewer prompt
 * tokens than the caller's floor — i.e. it answered without ingesting the media
 * it was sent. See {@link LlmRequest.minPromptTokens} for the measurement that
 * motivated it; the failure mode is a confident analysis of a video that was
 * never delivered, which is strictly worse than an error.
 *
 * Silent when the caller sets no floor, or when the provider reports no usage
 * at all (streams) — this must never turn a working call into a failure.
 */
export function assertMediaIngested(model: LlmModelDef, req: LlmRequest, usage?: { inputTokens: number }): void {
  const floor = req.minPromptTokens
  if (floor === undefined || !usage || usage.inputTokens <= 0) return
  if (usage.inputTokens < floor) {
    throw new Error(
      `media_not_ingested:${model.id} — provider reported ${usage.inputTokens} prompt tokens, below the ${floor} floor for this request's media. ` +
        `The response describes content the model was not shown; discarding it.`,
    )
  }
}

export function buildResponse(
  model: LlmModelDef,
  text: string,
  end: ReplyEnd,
  usage?: { inputTokens: number; outputTokens: number },
  actualUsd?: number,
  lane: LlmServingLane = "kie",
  req?: LlmRequest,
): LlmResponse {
  if (req) assertMediaIngested(model, req, usage)
  const tableEstimate = usage ? calculateLlmCost(model, usage, lane) : undefined
  if (actualUsd !== undefined && tableEstimate !== undefined && tableEstimate > 0) {
    const drift = Math.abs(actualUsd - tableEstimate) / tableEstimate
    if (drift > 0.25) {
      console.warn(
        `[llm-cost-drift] model=${model.id} estimated=$${tableEstimate.toFixed(6)} actual=$${actualUsd.toFixed(6)}`,
      )
    }
  }
  const providerCost = actualUsd ?? tableEstimate
  // Only the KIE formats and the direct Anthropic SDK build through here (the
  // Gemini lane has its own builder), so "direct" names Anthropic.
  // A structured call's refusal first (`end.refusalFails`): it is an answer
  // about the request, and must never read as a malformed one the structured
  // loop would re-ask. A plain call keeps the refusal's text as its answer.
  if (end.refusalFails) {
    assertNotContentRefusal({
      modelId: model.id, lane: lane === "direct" ? "direct-anthropic" : "kie", stopReason: end.stopReason, usage, providerCost,
    })
  }
  assertNotOutputCapped({
    modelId: model.id, lane: lane === "direct" ? "direct-anthropic" : "kie",
    stopReason: end.stopReason, cap: end.cap, usage, providerCost,
  })
  return {
    text,
    usage,
    model: model.id,
    providerCost,
    ...(actualUsd !== undefined ? { creditsUsd: actualUsd } : {}),
    lane: lane === "direct" ? "direct-anthropic" : "kie",
  }
}

/**
 * KIE returns HTTP 200 with a `{code: <non-zero>, msg: "..."}` envelope for
 * service errors (e.g. "maintenance") and validation errors (e.g. unsupported
 * model). Without this guard the downstream parser silently produces empty
 * text, the job is marked completed, and credits are committed.
 *
 * Success bodies have no `code` field (chat-completions / responses) or use
 * `code: 0|200` (legacy task client).
 */
export function assertKieEnvelope(data: unknown, modelId: string, context: string): void {
  if (!data || typeof data !== "object") return
  const code = (data as { code?: number }).code
  if (code === undefined || code === 0 || code === 200) return
  const msg =
    (data as { msg?: string }).msg ??
    (data as { message?: string }).message ??
    JSON.stringify(data)
  throw new LlmLaneError(`KIE.ai ${context} ${modelId} failed (code ${code}): ${msg}`, { lane: "kie", bodyCode: code })
}
