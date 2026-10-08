/**
 * Advanced mode — the per-request opt-in that pins an LLM call to the vendor's
 * own API.
 *
 * WHY IT EXISTS: on the aggregator lane, `temperature` / `maxTokens` / the
 * upper effort levels are not reliably honoured, so exposing those controls
 * would be promising something we can't deliver. Advanced mode routes the call
 * direct (`requireLane: "direct"`), where they take effect — and bills one
 * credit tier up, because the vendor's own list price is materially higher.
 *
 * WHY THE LEVERS ARE GATED: ten of the eleven LLM nodes hardcode a tuned
 * `temperature`/`maxTokens` in their route (structured-JSON generators sit at
 * 0.3). Honouring a user-supplied temperature unconditionally would let a
 * stored value silently degrade schema adherence on nodes that never offered
 * the control. So with advanced OFF the route's own defaults are used
 * verbatim — behaviour is byte-identical to before this feature existed — and
 * only with it ON do caller values apply.
 *
 * This module is the single seam for all of it, so the 13 LLM routes each
 * change by one spread and one call rather than hand-rolling the same three
 * decisions.
 */

import { z } from "zod"
import { getLlmModel, supportsAdvancedMode, ADVANCED_MODE_UNAVAILABLE_REASON } from "@nodaro/shared"
import { config } from "./config.js"
import type { LlmServingLane } from "./pricing/llm-cost.js"

/**
 * Zod fields every LLM route accepts for advanced mode. Spread into a route's
 * body schema: `z.object({ ...LLM_ADVANCED_SHAPE, ...routeFields })`.
 *
 * All optional, so an older client that never sends them parses unchanged.
 * `maxTokens` tops out at 32768 to match the reasoning-headroom floor
 * `deriveParams` applies in llm-client.
 */
export const LLM_ADVANCED_SHAPE = {
  advancedMode: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(32768).optional(),
}

export interface LlmAdvancedInput {
  advancedMode?: boolean
  temperature?: number
  maxTokens?: number
}

/** The LLM-request slice advanced mode controls. Spread into the `llmComplete`
 *  / `llmStream` / `llmCompleteStructured` request object. */
export interface ResolvedLlmParams {
  requireLane?: LlmServingLane
  temperature?: number
  maxTokens?: number
}

/**
 * Validation error for an advanced request on a model with no direct lane, or
 * `null` when the request is fine.
 *
 * Returned rather than thrown so each route sends it with its own `reply`, and
 * worded from the shared constant so the 400 and the config panel's disabled
 * hint can't drift apart.
 */
export function advancedModeError(
  input: LlmAdvancedInput,
  llmModel: string | undefined,
): { code: string; message: string } | null {
  if (!input.advancedMode) return null
  if (!supportsAdvancedMode(llmModel)) {
    return { code: "advanced_mode_unsupported", message: ADVANCED_MODE_UNAVAILABLE_REASON }
  }
  // The model HAS a direct lane, but this install may hold no key for it (a
  // self-hosted install with no ANTHROPIC_API_KEY / GEMINI_API_KEY). Refuse up
  // front, before any credit reservation, instead of failing inside the call.
  const model = getLlmModel(llmModel!)
  const keyed = model?.directGeminiModel ? Boolean(config.GEMINI_API_KEY) : Boolean(config.ANTHROPIC_API_KEY)
  if (!keyed) {
    return {
      code: "advanced_mode_unavailable",
      message: "Advanced mode needs this provider's own API key, which this installation does not have — turn Advanced mode off to run the model.",
    }
  }
  return null
}

/**
 * Resolve the sampling levers for this call.
 *
 * `defaults` is what the route sends today — pass its existing hardcoded
 * values so the advanced-off path stays byte-identical. A field the caller
 * omits falls back to the same default even when advanced is on, so turning
 * the toggle on without touching the sliders changes only the lane.
 */
export function resolveLlmParams(
  input: LlmAdvancedInput,
  defaults: { temperature?: number; maxTokens?: number } = {},
): ResolvedLlmParams {
  if (!input.advancedMode) {
    return { temperature: defaults.temperature, maxTokens: defaults.maxTokens }
  }
  return {
    requireLane: "direct",
    temperature: input.temperature ?? defaults.temperature,
    maxTokens: input.maxTokens ?? defaults.maxTokens,
  }
}
