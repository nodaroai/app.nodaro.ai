/**
 * How many tokens an LLM node's run may write — the one place that answers it.
 *
 * Three readers share this file so they cannot drift apart:
 *  - the orchestrator (`buildSyncHttpBody`) sends `data.maxTokens ?? <the node's
 *    default>` into the route (`llmNodeMaxTokens`);
 *  - the request layer (`llm-client.ts :: deriveParams`) raises that cap to the
 *    model's reasoning floor when thinking shares the budget
 *    (`raiseToReasoningFloor`);
 *  - the listing (`llmNodeOutputTokenCap`), which bounds a generated voice's
 *    script by what the LLM node feeding it can write, reads both.
 *
 * Pure: it imports only `@nodaro/shared`, so the billing code can use it
 * without reaching an SDK or the database.
 */
import { LLM_FEATURE_DEFAULTS, effectiveReasoningEffort, getLlmModel, reasoningOutputFloor } from "@nodaro/shared"
import type { LlmFeature, LlmModelDef, LlmReasoningEffort } from "@nodaro/shared"

/**
 * What the orchestrator sends when the node has no `maxTokens` of its own.
 * Prompt (llm-chat) is `LLM_CHAT_SAMPLING_DEFAULTS` on the canvas side; AI Writer
 * runs at 4096 in an orchestrated run (its route's own default is 8192, which
 * an orchestrated run never reaches: the executor always sends a value).
 */
export const LLM_NODE_MAX_TOKENS_DEFAULTS: Readonly<Record<string, number>> = { "llm-chat": 8192, "ai-writer": 4096 }

/** The route's own ceiling on `maxTokens` (`LLM_ADVANCED_SHAPE`, the routes' Zod). */
export const LLM_MAX_TOKENS_LIMIT = 32768

/** The LLM nodes whose text output can feed another node and whose `maxTokens` the run reads from node data. */
export const LLM_TEXT_NODE_TYPES: ReadonlySet<string> = new Set(Object.keys(LLM_NODE_MAX_TOKENS_DEFAULTS))

/** `data.maxTokens` as the orchestrator sends it: the node's value, else its default. */
export function llmNodeMaxTokens(type: string, data: Record<string, unknown>): number {
  const own = data.maxTokens
  if (typeof own === "number" && Number.isFinite(own) && own > 0) return own
  return LLM_NODE_MAX_TOKENS_DEFAULTS[type] ?? LLM_NODE_MAX_TOKENS_DEFAULTS["llm-chat"]!
}

/**
 * Reasoning tokens share the output budget when an xhigh/max effort was
 * requested (any reasoning model), or when the model reasons with no thinking
 * param sent at all (`thinkingDefaultOn`). Then the cap is raised to the model's
 * own floor, even above what the node asked for.
 */
export function raiseToReasoningFloor(model: LlmModelDef, eff: LlmReasoningEffort | undefined, maxTokens: number): number {
  if (eff === "xhigh" || eff === "max" || model.thinkingDefaultOn) return Math.max(maxTokens, reasoningOutputFloor(model))
  return maxTokens
}

/**
 * The most tokens an LLM node's run can write, as the request layer will cap it
 * (`deriveParams`): the node's `maxTokens` (or `maxTokensOverride`, the largest
 * value an exposed app input lets the user pick), raised to the reasoning floor
 * where the node's model and effort share the budget with thinking. The model is
 * the route's own pick (`data.llmModel ?? LLM_FEATURE_DEFAULTS[type]`); an
 * Advanced-mode node reads its effort on the direct lane's wider ladder. A model
 * no registry knows runs nowhere (the route 400s), so it has no floor.
 */
export function llmNodeOutputTokenCap(type: string, data: Record<string, unknown>, maxTokensOverride?: number): number {
  const asked = maxTokensOverride ?? llmNodeMaxTokens(type, data)
  const modelId = typeof data.llmModel === "string" && data.llmModel ? data.llmModel : LLM_FEATURE_DEFAULTS[type as LlmFeature]
  const model = modelId ? getLlmModel(modelId) : undefined
  if (!model) return asked
  const effort = typeof data.reasoningEffort === "string" ? data.reasoningEffort : undefined
  return raiseToReasoningFloor(model, effectiveReasoningEffort(model.id, effort, data.advancedMode === true), asked)
}
