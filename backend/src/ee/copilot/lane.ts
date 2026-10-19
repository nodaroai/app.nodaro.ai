/**
 * Which client a Copilot turn runs on, and the rules that belong to the KIE
 * one. Its own module so the turn runner can tell a restart from a failure
 * without importing the loop itself.
 */
import { classifyPlatformExhaustion, exhaustionSignalOf } from "../../lib/llm-platform-exhaustion.js"
import type { LlmPlatformExhaustedError } from "../../lib/llm-errors.js"

/** The platform's Anthropic account, or KIE's Anthropic-compatible endpoint. */
export type CopilotLane = "direct" | "kie"

/** Extra attempts at a KIE model call that failed before any token or charge (K13). */
export const KIE_COPILOT_RETRIES = 4

/** The pause before each of them — KIE's failure bursts last a minute or two. */
export const KIE_COPILOT_RETRY_DELAY_MS = 20_000

/**
 * The Anthropic account refused the turn's FIRST model call before any token
 * reached the person: nothing was spent and no tool ran, so the turn runner
 * runs the whole turn again on KIE. The refusal is already typed, alerted and
 * latched (`toPlatformExhausted`).
 */
export class CopilotDirectRefusedError extends Error {
  readonly refusal: LlmPlatformExhaustedError
  constructor(refusal: LlmPlatformExhaustedError) {
    super(refusal.message, { cause: refusal })
    this.name = "CopilotDirectRefusedError"
    this.refusal = refusal
  }
}

/**
 * May a KIE model call that failed before any token or charge be asked again?
 * A connection error or a stream `error` frame (no HTTP status), a 429, a 5xx,
 * and KIE's 400 `api_error` "Internal error" — all transient. Never a refused
 * key or balance (401/402/403, "credits insufficient"): that answers the same
 * way 20 s later.
 */
export function kieRetryable(err: unknown): boolean {
  const signal = exhaustionSignalOf(err)
  if (signal && classifyPlatformExhaustion(signal)) return false
  const status = signal?.status
  if (status === undefined) return true
  if (status === 429 || status >= 500) return true
  return status === 400 && (signal?.text ?? "").toLowerCase().includes("api_error")
}
