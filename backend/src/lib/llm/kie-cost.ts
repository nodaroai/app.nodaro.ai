/**
 * What a Claude call served by KIE cost: KIE's own charge when the reply
 * stated it, else an estimate from the SIZE of the request and the answer at
 * the KIE rate table. Never from KIE's reported `input_tokens`: on its Claude
 * wires that count leaves out the caller's own prompt (a few tokens for a
 * long request), so a cost read from it is close to nothing whatever was sent.
 */
import { calculateLlmCost } from "../pricing/llm-cost.js"
import type { LlmFailureUsage } from "../llm-errors.js"
import { extractActualUsd } from "./response.js"
import type { LlmRequest } from "./types.js"

/** Characters one image stands for in the size estimate — about 1,600 tokens at 4 characters a token. */
export const KIE_IMAGE_ESTIMATE_CHARS = 6_400

/** The request's size in characters: system prompt, schema, text, and {@link KIE_IMAGE_ESTIMATE_CHARS} per media block. */
export function requestChars(req: LlmRequest): number {
  let chars = req.system.length + (req.jsonSchema ? JSON.stringify(req.jsonSchema.schema).length : 0)
  for (const message of req.messages) {
    if (typeof message.content === "string") {
      chars += message.content.length
      continue
    }
    for (const block of message.content) chars += block.type === "text" ? block.text.length : KIE_IMAGE_ESTIMATE_CHARS
  }
  return chars
}

/**
 * The input token count recorded for a KIE Claude call (`llm_calls`,
 * `copilot_turns`): the size estimate (chars ÷ 4, rounded up) — KIE's own
 * count leaves out the caller's prompt.
 */
export function kieInputTokens(promptChars: number): number {
  return Math.ceil(promptChars / 4)
}

/** KIE's charge (`creditsUsd`) when known, else the size estimate (chars ÷ 4) at the KIE rates of `modelId` (a registry id). */
export function kieCostUsd(modelId: string, opts: { creditsUsd?: number; promptChars: number; answerChars: number }): number {
  if (opts.creditsUsd !== undefined) return opts.creditsUsd
  return calculateLlmCost(
    modelId,
    { inputTokens: kieInputTokens(opts.promptChars), outputTokens: Math.ceil(opts.answerChars / 4) },
    "kie",
  )
}

/**
 * What a KIE Claude call that failed AFTER it was billed (a refusal, a cut-off
 * answer, an error after usage) cost: KIE's stated charge when the failure
 * carried one, else the size estimate — the prompt's size, and the answer
 * sized from KIE's reported output count (that count is sound; only its input
 * count is not). Never the failure's `providerCost` alone, which without a
 * stated charge is the rate-table figure from KIE's input count.
 */
export function kieFailureCostUsd(modelId: string, usage: LlmFailureUsage, promptChars: number): number {
  return kieCostUsd(modelId, { creditsUsd: usage.creditsUsd, promptChars, answerChars: usage.outputTokens * 4 })
}

/**
 * KIE's charge (USD) from one SSE event of its Anthropic-compatible
 * `/anthropic` wire. The field arrives on `message_delta`; it is read at the
 * event's top level first (where the `/claude` wire puts it), then inside
 * `usage`, then inside `delta`.
 */
export function kieCreditsUsdOf(event: unknown): number | undefined {
  if (!event || typeof event !== "object") return undefined
  const e = event as { usage?: unknown; delta?: unknown }
  const nested = (value: unknown): number | undefined =>
    value && typeof value === "object" ? extractActualUsd(value) : undefined
  return extractActualUsd(e) ?? nested(e.usage) ?? nested(e.delta)
}
