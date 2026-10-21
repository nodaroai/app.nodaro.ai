/**
 * Metered LLM pricing — the pure core every metered route, the DAG and the
 * estimate API share: the HOLD reserved before a call, the pre-run ESTIMATE
 * (what it typically costs), and the charge identifier.
 *
 * Both prices are BASE credits (before the feature's markup — callers apply
 * `applyServiceMarkup` with {@link llmChargeId}), priced from the per-model
 * provider rates in `lib/pricing/llm-cost.ts` on the lane the router serves the
 * call on first (`llmPrimaryLane`). A model with no rate of its own on that lane
 * is refused with {@link LlmUnpricedModelError} — never priced at 0, and never
 * from the KIE row a missing direct row falls back to for cost logging.
 *
 * D1: the hold is NOT a ceiling. It sizes ONE attempt of the main call on its
 * primary lane, at the output cap the request is really sent with. Retries,
 * re-asks and lane fallbacks are not held; the settle charges the call's actual
 * cost even above the hold (collecting the overrun from the payer's balance),
 * so a bound here only needs to be sane, not a guarantee.
 */
import { usdToCredits } from "@nodaro/shared/credits"
import { getLlmModel, supportsAdvancedMode } from "@nodaro/shared/llm-models"
import { KIE_IMAGE_ESTIMATE_CHARS } from "../../lib/llm/kie-cost.js"
import type { LlmRequest } from "../../lib/llm/types.js"
import { llmEffectiveOutputCap } from "../../lib/llm-node-output-cap.js"
import {
  calculateLlmCost,
  hasLlmRate,
  llmPossibleLanes,
  llmPrimaryLane,
  LlmRateMissingError,
  type LlmCostUsage,
  type LlmServingLane,
} from "../../lib/pricing/llm-cost.js"
import { LLM_TYPICAL_USAGE, type MeteredLlmFeature } from "./llm-typical-usage.js"

/** Characters per token for ASCII text in the input bound — conservative (real prompts run ~4). Non-ASCII counts 1 token per UTF-16 code unit. */
export const LLM_CEILING_CHARS_PER_TOKEN = 3

/** Input tokens one image stands for — the same figure as the KIE size estimate (6,400 chars at 4 per token). */
export const LLM_IMAGE_TOKENS = KIE_IMAGE_ESTIMATE_CHARS / 4

/** Input tokens one second of video or audio stands for — above Gemini's ~263/s for video with its audio track. */
export const LLM_MEDIA_TOKENS_PER_SECOND = 300

/** Seconds a media block of unknown length is held for. Under D1 any overrun is collected at settle. */
export const LLM_UNKNOWN_MEDIA_SECONDS = 60

/** The credit identifier a metered LLM call is charged (and marked up) under: `<feature>:<modelId>`. */
export function llmChargeId(feature: MeteredLlmFeature, modelId: string): string {
  return `${feature}:${modelId}`
}

/**
 * Thrown when a model has no rate on a lane it may be served on. Routes turn it
 * into `400 validation_error` with {@link LlmUnpricedModelError.code} before any
 * job row or reservation.
 */
export class LlmUnpricedModelError extends Error {
  readonly code = "llm_model_unpriced"
  readonly modelId: string
  readonly lane: LlmServingLane

  constructor(modelId: string, lane: LlmServingLane) {
    super(`LLM model "${modelId}" has no price on its ${lane} lane, so it cannot be run`)
    this.name = "LlmUnpricedModelError"
    this.modelId = modelId
    this.lane = lane
  }
}

/** What a metered call holds for, known at reserve time: the request exactly as it will be sent. */
export interface LlmHoldShape {
  request: LlmRequest
  /** Length of EACH video / audio block, when known; else {@link LLM_UNKNOWN_MEDIA_SECONDS} per block. */
  mediaSeconds?: number
  /**
   * The run is kept to the cheap lanes. Accepted for the callers' convenience
   * and inert here: it removes fallbacks only, never the primary lane a hold
   * prices (see `llmPrimaryLane`).
   */
  cheapLanesOnly?: boolean
  /**
   * ASCII text characters counted ON TOP of the request's own content, at
   * {@link LLM_CEILING_CHARS_PER_TOKEN} per token — for a pre-check that knows
   * only a body's length (`llmPrecheckBaseCredits`), so no string of that
   * length is ever built.
   */
  extraTextChars?: number
}

/**
 * {@link calculateLlmCost} on `lane`, refused with {@link LlmUnpricedModelError}
 * unless the model carries that lane's OWN rate ({@link hasLlmRate} — a direct
 * lane is never priced from the KIE row). Every other error propagates.
 */
function laneCostUsd(modelId: string, usage: LlmCostUsage, lane: LlmServingLane): number {
  if (!hasLlmRate(modelId, lane)) throw new LlmUnpricedModelError(modelId, lane)
  try {
    return calculateLlmCost(modelId, usage, lane)
  } catch (err) {
    if (err instanceof LlmRateMissingError) throw new LlmUnpricedModelError(err.modelId, err.lane)
    throw err
  }
}

function assertSize(name: string, value: number, integer: boolean): void {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new RangeError(`llmInputTokenBound: ${name} must be ${integer ? "an integer" : "a finite number"} ≥ 0, got ${value}`)
  }
}

/**
 * An input-token bound from a request's parts: ASCII text at
 * {@link LLM_CEILING_CHARS_PER_TOKEN} characters per token (rounded up), every
 * other UTF-16 code unit at one token (Hebrew, Japanese and Korean run near 1:1),
 * {@link LLM_IMAGE_TOKENS} per image and {@link LLM_MEDIA_TOKENS_PER_SECOND} per
 * second of video/audio (rounded up). `text` is text only — images and media
 * are counted through their own fields, never also as characters.
 */
export function llmInputTokenBound(input: { text: string; imageCount: number; mediaSeconds: number }): number {
  assertSize("imageCount", input.imageCount, true)
  assertSize("mediaSeconds", input.mediaSeconds, false)
  let ascii = 0
  let nonAscii = 0
  for (let i = 0; i < input.text.length; i++) {
    if (input.text.charCodeAt(i) < 0x80) ascii++
    else nonAscii++
  }
  return (
    Math.ceil(ascii / LLM_CEILING_CHARS_PER_TOKEN) +
    nonAscii +
    input.imageCount * LLM_IMAGE_TOKENS +
    Math.ceil(input.mediaSeconds * LLM_MEDIA_TOKENS_PER_SECOND)
  )
}

/**
 * {@link llmInputTokenBound} of a built request: the text is the system prompt,
 * the structured schema (`JSON.stringify(jsonSchema.schema)`) and every text
 * message or block; each `image` / `image_base64` block is one image; each
 * `video` / `video_base64` / `audio` block adds `opts.mediaSeconds` (else
 * {@link LLM_UNKNOWN_MEDIA_SECONDS}).
 */
export function llmRequestInputBound(req: LlmRequest, opts?: { mediaSeconds?: number }): number {
  const perMediaSeconds = opts?.mediaSeconds ?? LLM_UNKNOWN_MEDIA_SECONDS
  let text = req.system + (req.jsonSchema ? JSON.stringify(req.jsonSchema.schema) : "")
  let imageCount = 0
  let mediaSeconds = 0
  for (const message of req.messages) {
    if (typeof message.content === "string") {
      text += message.content
      continue
    }
    for (const block of message.content) {
      if (block.type === "text") text += block.text
      else if (block.type === "image" || block.type === "image_base64") imageCount++
      else mediaSeconds += perMediaSeconds
    }
  }
  return llmInputTokenBound({ text, imageCount, mediaSeconds })
}

/**
 * The hold for one metered call, in base credits (D1): the main call, ONE
 * attempt, on its primary lane (`llmPrimaryLane`), at
 * {@link llmRequestInputBound} input tokens and the output cap the request is
 * really sent with (`llmEffectiveOutputCap` — what `deriveParams` returns).
 * Retries and fallbacks are not held: the settle collects them.
 */
export function llmHoldBaseCredits(modelId: string, shape: LlmHoldShape): number {
  const model = getLlmModel(modelId)
  if (!model) throw new LlmUnpricedModelError(modelId, shape.request.requireLane ?? "kie")
  // No model runs without a rate on EVERY lane it may be served — and so
  // billed — on: the hold prices the primary lane only, but a fallback lane
  // with no rate would leave the settle with a cost it cannot compute.
  for (const lane of llmPossibleLanes(model, shape.request.reasoningEffort, shape.request.requireLane === "direct" || shape.request.advancedMode === true)) {
    if (!hasLlmRate(model.id, lane)) throw new LlmUnpricedModelError(model.id, lane)
  }
  const extra = shape.extraTextChars ?? 0
  assertSize("extraTextChars", extra, true)
  const usage: LlmCostUsage = {
    inputTokens: llmRequestInputBound(shape.request, { mediaSeconds: shape.mediaSeconds }) + Math.ceil(extra / LLM_CEILING_CHARS_PER_TOKEN),
    outputTokens: llmEffectiveOutputCap(model, shape.request),
  }
  return usdToCredits(laneCostUsd(model.id, usage, llmPrimaryLane(model, { ...shape.request, cheapLanesOnly: shape.cheapLanesOnly })))
}

/**
 * What a call of `feature` on `modelId` typically costs, in base credits: the
 * feature's {@link LLM_TYPICAL_USAGE} on the model's primary lane
 * (`llmPrimaryLane`; Advanced mode is the direct pin the route sends), at least 1.
 */
export function llmEstimateBaseCredits(
  feature: MeteredLlmFeature,
  modelId: string,
  reasoningEffort?: string,
  advancedMode?: boolean,
): number {
  const typical = LLM_TYPICAL_USAGE[feature]
  if (!typical) throw new Error(`No typical usage declared for metered LLM feature "${feature}" — add it to llm-typical-usage.ts`)
  const model = getLlmModel(modelId)
  if (!model) throw new LlmUnpricedModelError(modelId, advancedMode ? "direct" : "kie")
  // Advanced mode pins direct only on a model that has it, as the routes do
  // (`supportsAdvancedMode`); on any other model it does not apply, and the
  // call is priced on its primary lane rather than refused.
  const primary = llmPrimaryLane(model, {
    reasoningEffort: reasoningEffort as LlmRequest["reasoningEffort"],
    requireLane: advancedMode && supportsAdvancedMode(model.id) ? "direct" : undefined,
  })
  return Math.max(1, usdToCredits(laneCostUsd(model.id, { ...typical }, primary)))
}
