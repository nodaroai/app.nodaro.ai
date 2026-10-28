/**
 * Reading the token counts KIE reports on a reply, at the one boundary they
 * enter the platform.
 *
 * KIE has sent counts no provider could have meant: a Gemini reply on its
 * chat-completions wire came back with `usage.completion_tokens: -3977` (its
 * output count, very likely derived as total minus prompt with the model's
 * thinking tokens counted somewhere else). Copied verbatim, such a count is
 * refused by `LlmSpend.add` — rightly: it is no figure a charge can be made
 * from — and the call is left unrecorded in its job's spend. Priced as it
 * stands, it would cost the answer less than nothing.
 *
 * So a count that is PRESENT but not a finite number ≥ 0 counts as not
 * reported, and is replaced by the size estimate the KIE lanes already bill
 * from when a count cannot be trusted (`kieCostUsd`): the answer's characters
 * ÷ 4 for output, the request's (`kieInputTokens`) for input. One warn line
 * names the model and the raw values so an operator can see KIE sent them. A
 * count that is ABSENT keeps its old reading (0), and a reply with no `usage`
 * at all stays without one.
 */

import { kieInputTokens } from "./kie-cost.js"
import { markInputEstimated } from "./response.js"

/** A provider-reported token count, or undefined when the value is not a finite number ≥ 0. */
export function reportedTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** The key names a KIE wire format reports its counts under. */
export interface KieUsageKeys {
  input: "prompt_tokens" | "input_tokens"
  output: "completion_tokens" | "output_tokens"
}

/** Chat-completions (`prompt_tokens` / `completion_tokens`). */
export const CHAT_COMPLETIONS_USAGE_KEYS: KieUsageKeys = { input: "prompt_tokens", output: "completion_tokens" }
/** Claude messages and the responses dialect (`input_tokens` / `output_tokens`). */
export const MESSAGES_USAGE_KEYS: KieUsageKeys = { input: "input_tokens", output: "output_tokens" }

/**
 * KIE's `usage` object as token counts, a count it got wrong replaced by its
 * size estimate (see the module note). `undefined` when `raw` is no object —
 * the reply reported no usage.
 *
 * An input count that was estimated is marked (`markInputEstimated`) so the
 * media guard (`assertMediaIngested`), which tests a REPORTED prompt count,
 * stays silent rather than judging the guess.
 */
export function kieReportedUsage(
  modelId: string,
  raw: unknown,
  keys: KieUsageKeys,
  size: { requestChars: number; answerChars: number },
): { inputTokens: number; outputTokens: number } | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const record = raw as Record<string, unknown>
  const garbage: string[] = []
  const read = (key: string, estimate: () => number): { tokens: number; estimated: boolean } => {
    if (!(key in record) || record[key] === undefined || record[key] === null) return { tokens: 0, estimated: false }
    const tokens = reportedTokenCount(record[key])
    if (tokens !== undefined) return { tokens, estimated: false }
    garbage.push(`${key}=${JSON.stringify(record[key]) ?? String(record[key])}`)
    return { tokens: estimate(), estimated: true }
  }
  const input = read(keys.input, () => kieInputTokens(size.requestChars))
  const output = read(keys.output, () => Math.ceil(size.answerChars / 4))
  if (garbage.length > 0) {
    console.warn(
      `[llm-kie-usage] ${modelId}: KIE reported an unusable token count (${garbage.join(", ")}) — ` +
        `counted as not reported and sized from the request/answer instead ` +
        `(in ${input.tokens}${input.estimated ? " estimated" : ""} / out ${output.tokens}${output.estimated ? " estimated" : ""})`,
    )
  }
  const usage = { inputTokens: input.tokens, outputTokens: output.tokens }
  if (input.estimated) markInputEstimated(usage)
  return usage
}
