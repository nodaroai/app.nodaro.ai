/**
 * Which client a Copilot turn runs on, and the rules that belong to the KIE
 * one. Its own module so the turn runner can tell a restart from a failure
 * without importing the loop itself.
 */
import Anthropic from "@anthropic-ai/sdk"
import { classifyPlatformExhaustion, exhaustionSignalOf } from "../../lib/llm-platform-exhaustion.js"
import { LlmLaneError, type LlmPlatformExhaustedError } from "../../lib/llm-errors.js"

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
 * A 429, a 5xx, KIE's 400 `api_error` "Internal error" and its
 * `no_available_account` — and, with no HTTP status, only a transport failure
 * ({@link transportFailure}). Never a refused key or balance (401/402/403,
 * "credits insufficient"): that answers the same way 20 s later. Never our own
 * bug either (a plain TypeError, a RangeError): asking again cannot fix it, so
 * it fails at once instead of after a minute of retries.
 */
export function kieRetryable(err: unknown): boolean {
  const signal = exhaustionSignalOf(err)
  if (signal && classifyPlatformExhaustion(signal)) return false
  if (/no_available_account/i.test(signal?.text ?? "")) return true
  const status = signal?.status
  if (status === undefined) return transportFailure(err)
  if (status === 429 || status >= 500) return true
  return status === 400 && (signal?.text ?? "").toLowerCase().includes("api_error")
}

/** The codes Node and undici put on a network failure (`err.code`, or the `cause` of fetch's TypeError). */
const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENOTFOUND",
  "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN",
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CLOSED",
])

/**
 * The SDK's MessageStream when the stream itself went wrong: the connection
 * closed before a whole message arrived, or its events came out of order.
 */
const SDK_STREAM_CUT = /^(request ended without sending any chunks|stream ended without producing a Message|Unexpected event order)/

/**
 * A failure with no HTTP status that is the wire's, not ours:
 * - the Anthropic SDK's connection error or timeout (the Copilot's KIE client),
 *   a stream `error` frame (an `APIError` with no status), a garbled frame
 *   (its JSON.parse failing), events out of order, or its stream closing
 *   before a whole message — never the person's own abort;
 * - an {@link LlmLaneError} with no status: a KIE wire failure that reported
 *   no usage (a stream cut mid-answer, a reply with no payload);
 * - KIE's stream `error` frame on the pipelines' wire (`lib/llm/sse.ts`
 *   throws it as a plain Error naming KIE and the frame);
 * - a network failure: fetch's `TypeError("fetch failed")`, a body cut
 *   mid-read (`TypeError("terminated")`), or an error carrying a network code.
 * The SDK's stream wraps any other error it meets as an `AnthropicError` whose
 * `cause` is the original, so that cause is what is read.
 */
function transportFailure(err: unknown, depth = 0): boolean {
  if (!(err instanceof Error) || depth > 4) return false
  if (err instanceof Anthropic.APIUserAbortError) return false
  if (err instanceof Anthropic.APIError) return true
  if (err instanceof LlmLaneError) return true
  if (err instanceof Anthropic.AnthropicError) {
    const cause = (err as { cause?: unknown }).cause
    // A garbled frame: the SDK's own JSON.parse of the frame threw, and its
    // stream wrapped that. Only here — a SyntaxError our code throws is not.
    if (cause instanceof SyntaxError) return true
    return cause instanceof Error ? transportFailure(cause, depth + 1) : SDK_STREAM_CUT.test(err.message)
  }
  if (networkCode(err) || networkCode((err as { cause?: unknown }).cause)) return true
  if (err instanceof TypeError) return err.message === "fetch failed" || err.message === "terminated"
  return err.constructor === Error && /^KIE\.ai \S+ stream \S+ returned an error event/.test(err.message)
}

function networkCode(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code
  return typeof code === "string" && NETWORK_ERROR_CODES.has(code)
}
