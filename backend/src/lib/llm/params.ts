/**
 * Model resolution and per-request derived params (timeout, effort, sampling, output cap).
 */

import {
  getLlmModel,
  LLM_FEATURE_DEFAULTS,
  effectiveReasoningEffort,
  type LlmModelDef,
  type LlmFeature,
  type LlmReasoningEffort,
} from "@nodaro/shared/llm-models"
import { raiseToReasoningFloor } from "../llm-node-output-cap.js"
import type { LlmRequest } from "./types.js"

const LLM_TIMEOUT_MS = 120_000

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

export function resolveModel(req: LlmRequest): LlmModelDef {
  let modelId = req.modelId
  if (!modelId && req.feature) {
    modelId = LLM_FEATURE_DEFAULTS[req.feature as LlmFeature] ?? "claude-sonnet-5.5"
  }
  const model = getLlmModel(modelId)
  if (!model) {
    throw new Error(`Unknown LLM model: ${modelId}`)
  }
  return model
}

/** Effective request timeout — per-request override, else the 120s default. */
export function effectiveTimeout(req: LlmRequest): number {
  return req.timeoutMs ?? LLM_TIMEOUT_MS
}

/** Per-request derived params: clamped effort, temperature (stripped for
 *  models that reject it), and the output-token cap (raised to the model's
 *  reasoning floor — 32768 unless a lane caps it lower — whenever reasoning
 *  tokens share the budget: at xhigh/max, or on ANY call to a
 *  `thinkingDefaultOn` model — so thinking doesn't truncate the answer). */
export function deriveParams(model: LlmModelDef, req: LlmRequest): {
  eff: LlmReasoningEffort | undefined
  temperature: number | undefined
  topP: number | undefined
  maxTokens: number
} {
  // The direct lane accepts a WIDER effort ladder than the aggregator, so the
  // clamp has to know which lane this call is pinned to. Without this, Advanced
  // mode unlocked temperature/maxTokens but silently kept clamping effort
  // against the aggregator's set — the headline capability was inert, and on
  // gemini-3-flash (which declares no KIE levels at all) every level the picker
  // offered was discarded before it reached the wire.
  const eff = effectiveReasoningEffort(model.id, req.reasoningEffort, req.requireLane === "direct")
  const temperature = model.supportsTemperature === false ? undefined : req.temperature
  // top_p rides the same support gate as temperature — a reasoning model that
  // rejects sampling params gets neither.
  const topP = model.supportsTemperature === false ? undefined : req.topP
  let maxTokens = req.maxTokens ?? model.maxOutputTokens
  // Reasoning tokens share the output budget. Two ways that happens:
  //   - an xhigh/max effort was requested (any reasoning model), or
  //   - the model reasons with no thinking param sent at all
  //     (`thinkingDefaultOn` — Claude Opus 5 flipped this default, so even
  //     Effort=Auto reasons and a 2048 cap is shared with the answer).
  // Floor the cap even when the caller sent an explicit maxTokens — node data
  // persists the old 2048 default, and hardcoded 2048s live in several routes
  // (after-effects/motion-graphics/lottie-overlay); such a call must never
  // truncate its answer because thinking consumed a small legacy cap. The cap
  // is a ceiling, not spend: billing is flat per call, so raising it costs
  // nothing unless the model actually generates that much.
  //
  // The floor is the model's own (`reasoningOutputFloor`), not a flat 32768:
  // it rides every lane the model can be served on, and the Gemini flash KIE
  // endpoints are only known to take 8192. Issue #1588 is what a missing floor
  // costs — gemini-3.6-flash reasons by default and was sent a node's 1,100.
  maxTokens = raiseToReasoningFloor(model, eff, maxTokens)
  return { eff, temperature, topP, maxTokens }
}
