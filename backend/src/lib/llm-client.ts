/**
 * Unified LLM client — routes requests through KIE.ai with Anthropic SDK fallback.
 *
 * Supports three KIE.ai API formats:
 * - chat-completions (Gemini, GPT-5.2): POST /{slug}/v1/chat/completions
 * - messages (Claude models): POST /claude/v1/messages
 * - responses (GPT family, Grok): POST /{family}/v1/responses — codex for GPT,
 *   grok for Grok (see kieResponsesUrl)
 *
 * This file is the public entry point and holds no logic of its own — the
 * implementation lives in `./llm/` (routing and fallback, the KIE and direct
 * Anthropic lanes, structured output, the SSE parser). Import from here.
 */

export type { LlmContentBlock, LlmMessage, LlmRequest, LlmServedLane, LlmResponse } from "./llm/types.js"
export { LLM_MAX_LANES_PER_CALL, llmComplete, llmStream } from "./llm/router.js"
export { LlmProviderUnavailableError, isLlmProviderUnavailable } from "./llm/provider-unavailable.js"
export { kieCanCarry, kieEquivalentOf } from "./llm/exhaustion-fallback.js"
export {
  LLM_STRUCTURED_DEFAULT_ATTEMPTS,
  LLM_STRUCTURED_DIRECT_BACKUP_ASKS,
  StructuredLlmError,
  llmCompleteStructured,
  llmStreamStructured,
  structuredJsonSchema,
  type StructuredLlmOutput,
  type StructuredStreamOptions,
} from "./llm/structured.js"
export { llmBlockToAnthropic } from "./llm/message-builders.js"
export { terminalResponseReason, reconcileResponsesStreamText } from "./llm/sse.js"

// `LlmStreamResponseError` — the usage-carrying failure every rule below keys on
// — lives in ./llm-errors.ts with its `LlmOutputTruncatedError` subclass, so the
// direct Gemini lane can throw them too.
export { LlmOutputTruncatedError } from "./llm-errors.js"
