import type { ZodType } from "zod"
import type { LlmReasoningEffort } from "@nodaro/shared/llm-models"
import { llmCompleteStructured, StructuredLlmError } from "../llm-client.js"
import type { PluginLlmMeteredResult, PluginLlmMultimodalRequest } from "./types.js"

/**
 * No implicit serving-lane pin: the model registry decides unless requested.
 *
 * Consequence for `video_base64` blocks — the direct Google lane is the only
 * one that carries inline video bytes, and `llmComplete` REJECTS an unpinned
 * request that contains one. A caller sending bytes through this adapter must
 * therefore pass `requireLane: "direct"` itself; its sibling
 * `toolkit.llm.completeStructuredMultimodal` already defaults to it.
 */
export async function completeStructuredMetered<T>(
  req: PluginLlmMultimodalRequest,
  schema: unknown,
  opts?: { schemaName?: string; maxRetries?: number },
): Promise<PluginLlmMeteredResult<T>> {
  try {
    const result = await llmCompleteStructured({
      modelId: req.model, system: req.system ?? "", messages: req.messages,
      maxTokens: req.maxTokens, temperature: req.temperature, topP: req.topP,
      reasoningEffort: req.reasoningEffort as LlmReasoningEffort | undefined,
      timeoutMs: req.timeoutMs, requireLane: req.requireLane,
      minPromptTokens: req.minPromptTokens,
      // Transport retry stays ON unless the caller turns it off. `maxRetries: 0` below is a
      // refusal to re-PAY for a wrong answer, not a refusal to re-dial a call that reported
      // no usage and cost nothing — two different questions, two different levers.
      retryStreamOnError: req.retryStreamOnError,
    }, schema as ZodType<T>, { ...opts, maxRetries: opts?.maxRetries ?? 0 })
    return { ok: true, output: result.output, usage: {
      inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      providerCost: result.providerCost, complete: result.usageComplete === true,
      ...(result.attempts ? { attempts: result.attempts } : {}),
    }, lane: result.lane, ...(result.attempts ? { attempts: result.attempts } : {}) }
  } catch (error) {
    if (error instanceof StructuredLlmError) return { ok: false, message: error.message, usage: error.usage }
    throw error
  }
}
