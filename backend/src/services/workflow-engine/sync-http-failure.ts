/**
 * A sync-HTTP node's failed call → the sentence the node fails with.
 *
 * A sync-HTTP node runs by POSTing to this container's own route, and the
 * orchestrator shows the thrown error's `message` to the person: on the node,
 * in the execution's `error_message`, in every client that reads the run. The
 * route's raw reply is diagnostic, not a sentence — it can be a JSON envelope,
 * a provider's echoed request, a stack, or a framework 404 naming the route
 * path — so it must never be the message.
 *
 * The split follows the sanitized provider errors (`KieError` and friends):
 *  - `message` — short and human. A route's own `{ error: { message } }` (or a
 *    plain `{ error: "…" }` / top-level `{ message }`) when it reads as a
 *    sentence, otherwise a generic sentence for the status.
 *  - `internalDetails` — the raw status and body, for logs and
 *    `providerDetailOf`. Never on the wire.
 *
 * Which route messages pass:
 *  - A 500 never does: the API's sanitizer already flattens an internal error's
 *    body, and any other 500 text is a crash, not a sentence.
 *  - A 404 without a route error `code` is the router's (the route is not
 *    registered here) → the generic "not available" sentence. A route's own
 *    404 names a code and keeps its message.
 *  - Every other status passes a message that reads as a sentence: more than
 *    one word, no JSON, no URL, no stack, one line, bounded length, and not a
 *    bare HTTP reason phrase ("Bad Request") or code ("insufficient_credits").
 */
import { STATUS_CODES } from "node:http"
import { redactProviderDetail } from "../../lib/provider-error-detail.js"

/** Longest route message shown as-is; anything longer is a diagnostic. */
const MAX_USER_MESSAGE = 300
/** Cap on the raw body kept in `internalDetails`. */
const MAX_INTERNAL_DETAILS = 2000

const REASON_PHRASES: ReadonlySet<string> = new Set(
  Object.values(STATUS_CODES).filter((p): p is string => typeof p === "string").map((p) => p.toLowerCase()),
)

export class SyncHttpCallError extends Error {
  /** The route's HTTP status. */
  readonly status: number
  /** The route's own error code, when its body named one. */
  readonly routeCode?: string
  /** The raw status and body — logs and `providerDetailOf` only, never the person. */
  readonly internalDetails: string

  constructor(message: string, opts: { status: number; routeCode?: string; internalDetails: string }) {
    super(message)
    this.name = "SyncHttpCallError"
    this.status = opts.status
    this.routeCode = opts.routeCode
    this.internalDetails = opts.internalDetails
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function filled(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/** The route's `{ error: { code, message } }`, `{ error: "…" }`, or a top-level `{ message }`. */
function routeErrorOf(body: string): { code?: string; message?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return {}
  }
  if (!isObject(parsed)) return {}
  const error = parsed.error
  if (isObject(error)) {
    const code = filled(error.code)
    // One level deeper for an envelope that nests its own `{ error: { message } }`.
    const nested = isObject(error.error) ? filled(error.error.message) : undefined
    return { code, message: filled(error.message) ?? nested }
  }
  // Fastify's own replies put the reason phrase in `error` and the detail in
  // `message`; a route's plain `{ error: "…" }` puts the sentence in `error`.
  // A route that answers `{ error: "insufficient_credits" }` names a code, not
  // a sentence.
  const errorText = filled(error)
  const topMessage = filled(parsed.message)
  if (errorText && isCodeToken(errorText)) return { code: errorText, message: topMessage }
  if (errorText && !REASON_PHRASES.has(errorText.toLowerCase())) return { message: errorText }
  return { message: topMessage }
}

/** One identifier-like word (`insufficient_credits`, `NOT_FOUND`, `llm.error`) — a code, not a sentence. */
function isCodeToken(text: string): boolean {
  return /^[A-Za-z0-9]+(?:[_.:-][A-Za-z0-9]+)+$/.test(text)
}

/** True when `text` reads as a sentence a person can be shown. */
function isHumanSentence(text: string): boolean {
  if (text.length > MAX_USER_MESSAGE) return false
  if (/[\r\n]/.test(text)) return false
  if (/[{}]/.test(text)) return false
  if (/"[^"]*"\s*:/.test(text)) return false
  if (/\bhttps?:\/\//i.test(text)) return false
  if (/\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(text)) return false
  if (REASON_PHRASES.has(text.toLowerCase())) return false
  // A sentence has more than one word; a lone token is a code or a fragment.
  if (!/\s/.test(text)) return false
  return true
}

/** The generic sentence for a status whose body carries no usable message. */
export function genericSyncHttpFailureMessage(status: number): string {
  if (status === 401 || status === 403) return `This step was not authorized to run (${status}).`
  if (status === 402) return "Not enough credits to run this step."
  if (status === 404) return "This step is not available on this deployment (404)."
  if (status === 408 || status === 504) return `This step timed out (${status}). Try again.`
  if (status === 413) return "The input is too large for this step (413)."
  if (status === 429) return "Too many requests right now (429). Try again in a moment."
  if (status >= 500) return `This step failed on the server (${status}). Try again in a moment.`
  if (status >= 400) return `This step's request was rejected (${status}).`
  return `This step failed (${status}).`
}

/** The user-facing sentence for a failed sync-HTTP call. Never contains the raw body. */
export function syncHttpFailureMessage(status: number, body: string): string {
  const error = routeErrorOf(body)
  if (status === 500) return genericSyncHttpFailureMessage(status)
  if (status === 404 && error.code === undefined) return genericSyncHttpFailureMessage(status)
  if (error.message && isHumanSentence(error.message)) return error.message
  return genericSyncHttpFailureMessage(status)
}

/**
 * The error a failed sync-HTTP call throws: the user-facing sentence as its
 * message, the raw reply in `internalDetails`, and ONE redacted log line so the
 * reply is recoverable from the server logs (the orchestrator logs only the
 * message).
 */
export function syncHttpCallError(
  label: string,
  status: number,
  body: string,
  context: { nodeId?: string; nodeType?: string; executionId?: string } = {},
): SyncHttpCallError {
  const message = syncHttpFailureMessage(status, body)
  const internalDetails = `${label} failed (${status}): ${body.slice(0, MAX_INTERNAL_DETAILS)}`
  const where = [
    context.executionId ? `execution ${context.executionId}` : null,
    context.nodeId ? `node ${context.nodeId}${context.nodeType ? ` (${context.nodeType})` : ""}` : null,
  ].filter(Boolean).join(" ")
  console.error(
    `[orchestrator] ${label} failed (${status})${where ? ` — ${where}` : ""}: ${message} | body: ${redactProviderDetail(body) ?? "<empty>"}`,
  )
  return new SyncHttpCallError(message, { status, routeCode: routeErrorOf(body).code, internalDetails })
}
