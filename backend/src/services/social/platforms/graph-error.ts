import { BadBodyError, NotPublishedError } from "../providers/types.js"

/**
 * Meta Graph API refusals, read once for Facebook and Instagram.
 *
 * A Graph call Meta refuses answers HTTP 4xx with
 * `{ "error": { "message", "type", "code", "error_user_title", "error_user_msg", "fbtrace_id" } }`.
 * `error_user_msg` is Meta's own sentence for the person ("Your photos couldn't
 * be uploaded. Photos should be less than 10 MB ..."), so it is what the node
 * shows; `message` is the developer text ("Invalid parameter") and only the
 * fallback. A body that is not JSON keeps its text.
 */

/** The longest sentence carried into an error message. */
const MAX_SENTENCE_CHARS = 500

/** Graph's codes for a request refused for its rate: the app's, the user's, the Page's, a custom limit. */
const RATE_LIMIT_CODES: ReadonlySet<number> = new Set([4, 17, 32, 613])

/** What a refusal says beyond its sentence: kept on the error for the logs. */
export interface GraphErrorDetails {
  readonly status: number
  readonly code?: number
  readonly type?: string
  readonly traceId?: string
}

/**
 * Meta refused the request, so nothing was posted: a definite failure (a
 * `BadBodyError`, never retried), worded in Meta's sentence for the person.
 */
export class GraphRefusedError extends BadBodyError {
  constructor(
    message: string,
    readonly graph: GraphErrorDetails,
  ) {
    super(message)
  }
}

/**
 * Meta refused the request for now (a rate limit, or an error it marks
 * transient): nothing was posted and a later try may succeed, so it is a
 * `NotPublishedError` (definite, and retried).
 */
export class GraphRetryLaterError extends NotPublishedError {
  constructor(
    message: string,
    readonly graph: GraphErrorDetails,
  ) {
    super(message)
  }
}

interface GraphErrorBody {
  readonly message?: unknown
  readonly type?: unknown
  readonly code?: unknown
  readonly is_transient?: unknown
  readonly error_user_msg?: unknown
  readonly fbtrace_id?: unknown
}

function errorBodyOf(text: string): GraphErrorBody | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    return parsed?.error && typeof parsed.error === "object" ? (parsed.error as GraphErrorBody) : undefined
  } catch {
    return undefined
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

/** The sentence a refusal gives the person: Meta's own, else its message, else the body's text. */
export function graphErrorSentence(text: string): string {
  const body = errorBodyOf(text)
  const sentence = nonEmpty(body?.error_user_msg) ?? nonEmpty(body?.message) ?? nonEmpty(text) ?? "no details given"
  return sentence.length > MAX_SENTENCE_CHARS ? `${sentence.slice(0, MAX_SENTENCE_CHARS)}…` : sentence
}

/** The error for a request Meta refused with HTTP `status` (4xx) and body `text`. */
export function graphRefusal(label: string, status: number, text: string): GraphRefusedError | GraphRetryLaterError {
  const body = errorBodyOf(text)
  const code = typeof body?.code === "number" ? body.code : undefined
  const type = nonEmpty(body?.type)
  const traceId = nonEmpty(body?.fbtrace_id)
  const details: GraphErrorDetails = {
    status,
    ...(code !== undefined ? { code } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(traceId !== undefined ? { traceId } : {}),
  }
  const sentence = `${label}: ${graphErrorSentence(text)}`
  const later = status === 429 || body?.is_transient === true || (code !== undefined && RATE_LIMIT_CODES.has(code))
  return later
    ? new GraphRetryLaterError(`${sentence} The post was NOT published — retrying later is safe.`, details)
    : new GraphRefusedError(sentence, details)
}
