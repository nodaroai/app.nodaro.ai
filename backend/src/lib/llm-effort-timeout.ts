import type { LlmReasoningEffort } from "@nodaro/shared"

/**
 * Per-effort LLM timeout for one picker analysis — describe-to-picker's image
 * read and text-to-picker's text twin, which run the same analyzer.
 *
 * The client's 120 s default fits every model at default effort, but high and
 * above routinely outlast it (on an image read, GPT-6 Astra never finished
 * inside it; Opus 5.5 at max averaged ~155 s). The ceiling is the workflow
 * engine's own call to describe-to-picker: it goes through the default fetch,
 * whose 300 s headers timeout would drop the answer before the LLM returned —
 * so the longest effort stops at 285 s and the route still answers (even with
 * a timeout error) inside the engine's window.
 */
const EFFORT_TIMEOUT_MS: Partial<Record<LlmReasoningEffort, number>> = {
  high: 240_000,
  xhigh: 285_000,
  max: 285_000,
}

/**
 * The LLM timeout for a call at `effort`: `undefined` for the default efforts,
 * so those requests stay byte-identical and keep the client's own default.
 * Pass the effort the call RESOLVES to (a route's default effort included),
 * not the one the body sent — a default read runs at high and needs high's.
 */
export function effortTimeoutMs(effort?: LlmReasoningEffort): number | undefined {
  return effort === undefined ? undefined : EFFORT_TIMEOUT_MS[effort]
}
