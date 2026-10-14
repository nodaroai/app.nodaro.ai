/**
 * Provider failures that REPORTED USAGE — the error half of the LLM client.
 *
 * Its own module so the direct Gemini lane (`gemini/client.ts`) can throw the
 * same classes `llm-client.ts` keys its retry and billing rules on:
 * `llm-client.ts` imports the Gemini lane, so the lane cannot import
 * `llm-client.ts` back at runtime.
 */

import {
  alertPlatformExhaustion,
  exhaustionSignalOf,
  latchDirectLaneExhausted,
  matchPlatformExhaustion,
  platformExhaustionMessage,
  type PlatformExhaustion,
} from "./llm-platform-exhaustion.js"

/**
 * How the provider said a reply ENDED. A required argument of every response
 * builder (`llm-client`'s `buildResponse` and `parseSseStream`, the Gemini
 * lane's `toResponse`), so a new adapter cannot build a response without
 * reading it: from the text alone a cut-off answer looks exactly like a
 * finished one (#1588).
 */
export interface ReplyEnd {
  /** The provider's own raw stop / finish reason, as it arrived. */
  stopReason: unknown
  /** The output cap actually sent, or undefined when the provider's default applied. */
  cap: number | undefined
}

/** What a failed call really spent — carried on the throw so the job is billed for it. */
export interface LlmFailureUsage {
  inputTokens: number
  outputTokens: number
  providerCost?: number
  /** Both token usage and cost were reported. */
  complete: boolean
}

/**
 * A provider failure that REPORTED USAGE. Two things follow from that, and they are the
 * reason this class exists rather than a plain `Error`:
 *
 * 1. the usage must survive to the caller, so the job is billed for what it actually spent;
 * 2. the call must never be retried — the provider answered and charged for answering, so a
 *    second attempt is a second bill for the same question.
 *
 * Everything that fails WITHOUT usage — a connection error, a 5xx before the stream starts, an
 * `event: error` frame that arrives before any token — is a plain `Error`, and that is what
 * `transportRetryable` (llm-client.ts) keys on. The distinction is made at the one place that
 * can see the usage (the adapter that read the provider's reply), not guessed downstream.
 */
export class LlmStreamResponseError extends Error {
  /** The full diagnostic (lane, model, provider text) — for the operator's
   *  `error_detail`, never the person's screen. */
  readonly internalDetails: string

  constructor(message: string, readonly usage: LlmFailureUsage) {
    super(message)
    this.name = "LlmStreamResponseError"
    this.internalDetails = message
  }

  /** What the person running it reads (`userFacingMessage`): no lane, vendor
   *  or internal model id. */
  get userMessage(): string {
    return "The AI model stopped partway through its answer. Please try again, or choose another model."
  }
}

/**
 * A request to a model's serving lane that failed WITHOUT usage — an HTTP
 * error, a service error inside a 200 (KIE's `{code, msg}` envelope), a
 * stream cut before it finished, a reply that could not be read. A plain
 * `Error` subclass on purpose: `transportRetryable` and lane fallback treat
 * it exactly as they treat a plain `Error`.
 *
 * `message` stays the full diagnostic, unchanged — logs and the private
 * plugins' retry classifier read it (`failed (429)`, `failed (5xx)`). The
 * person running the job reads `userMessage` instead (`userFacingMessage`),
 * which names no lane, vendor or internal model id; the diagnostic lands in
 * the job's `error_detail` (`internalDetails`). `httpStatus` and `bodyCode`
 * let a caller classify the failure by field rather than by message text.
 */
/** The person-readable sentence for a failed AI call nothing more specific
 *  describes — what a lane error with no status says, and what a route falls
 *  back to for a failure that is not even an `Error`. Names no vendor. */
export const LLM_ANSWER_UNREADABLE_MESSAGE = "The AI model's answer could not be read. Please try again, or choose another model."

export class LlmLaneError extends Error {
  readonly internalDetails: string
  readonly lane: "kie" | "direct"
  readonly httpStatus?: number
  readonly bodyCode?: number
  /** A sentence that names the actual problem when no status code can (a
   *  request's own media that could not be prepared). Takes precedence. */
  private readonly userMessageOverride?: string

  constructor(
    message: string,
    opts: {
      lane: "kie" | "direct"; httpStatus?: number; bodyCode?: number; userMessage?: string; cause?: unknown
      /** The diagnostic, when `message` itself must be user-safe (the platform-account subclass). */
      internalDetails?: string
    },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = "LlmLaneError"
    this.internalDetails = opts.internalDetails ?? message
    this.lane = opts.lane
    if (opts.httpStatus !== undefined) this.httpStatus = opts.httpStatus
    if (opts.bodyCode !== undefined) this.bodyCode = opts.bodyCode
    if (opts.userMessage !== undefined) this.userMessageOverride = opts.userMessage
  }

  get userMessage(): string {
    if (this.userMessageOverride !== undefined) return this.userMessageOverride
    const status = this.httpStatus ?? this.bodyCode
    if (status === 429) return "The AI model is busy right now. Please try again in a moment."
    if (status !== undefined && (status >= 500 || this.bodyCode !== undefined)) {
      return "The AI model's service is unavailable right now. Please try again later, or choose another model."
    }
    if (status !== undefined) {
      return `The AI model's service rejected the request (${status}). Please try again, or choose another model.`
    }
    return LLM_ANSWER_UNREADABLE_MESSAGE
  }
}

/**
 * The platform's own provider account refused the call — its balance or quota
 * is gone, or its key was refused (`lib/llm-platform-exhaustion.ts` decides
 * which failures are this). Thrown by every lane adapter in place of the raw
 * SDK / wire error, which rides along as `cause`.
 *
 * - `message` AND `userMessage`: the edition-aware capacity sentence — no
 *   vendor, no request id, and the credits promise only where credits exist.
 *   Unlike its parent class, `message` is user-safe too, because it is the one
 *   failure whose raw text is certain to name the vendor and its billing page,
 *   and not every surface that shows an error reads `userMessage` (a worker or
 *   route writing `err.message`, a plugin storing it).
 * - `internalDetails`: the full diagnostic, vendor reply included — the job's
 *   `error_detail` (`providerDetailOf`) and logs only. The raw SDK error also
 *   rides along as `cause`.
 * - Never transport-retried (re-dialling a drained account fails the same
 *   way); a direct lane that hits it is retried once on KIE serving the same
 *   registry model (`llm-client.ts`).
 */
export class LlmPlatformExhaustedError extends LlmLaneError {
  readonly code = "platform_account_exhausted"
  readonly exhaustion: PlatformExhaustion
  readonly provider: string

  constructor(
    diagnostic: string,
    opts: { lane: "kie" | "direct"; provider: string; exhaustion: PlatformExhaustion; httpStatus?: number; cause?: unknown },
  ) {
    super(platformExhaustionMessage(), {
      lane: opts.lane, httpStatus: opts.httpStatus, cause: opts.cause, internalDetails: diagnostic,
    })
    this.name = "LlmPlatformExhaustedError"
    this.exhaustion = opts.exhaustion
    this.provider = opts.provider
  }

  override get userMessage(): string {
    return platformExhaustionMessage()
  }
}

/**
 * The provider stopped because it reached the output-token cap: what it sent
 * back is a fragment, not an answer.
 *
 * No dialect reports this as an error. It arrives as a normal 200 carrying
 * `finish_reason: "length"` (chat-completions), `stop_reason: "max_tokens"`
 * (Claude), `finishReason: "MAX_TOKENS"` (Google) or `status: "incomplete"` with
 * `max_output_tokens` (responses). Returned as it is, the fragment becomes a
 * completed job. Issue #1588: a scheduled Generate Text node on
 * gemini-3.6-flash, capped at 1,100 tokens, was served by the direct Google
 * lane after KIE failed. It spent ~1,060 of those tokens reasoning, then saved
 * a 120-character answer cut off mid-URL as `completed`, and the next node
 * posted it to an external webhook. It happened on roughly every other run.
 *
 * A usage-carrying failure, because the provider answered and billed for it:
 * it is never transport-retried, never re-asked on the other serving lane
 * (`laneFallbackAllowed` in llm-client — the cap is the request's, not the
 * lane's), and the usage rides the throw so the failed job can still record
 * the provider cost (`billedProviderCost`).
 */
export class LlmOutputTruncatedError extends LlmStreamResponseError {
  readonly code = "output_truncated"
  constructor(message: string, usage: LlmFailureUsage) {
    super(message, usage)
    this.name = "LlmOutputTruncatedError"
  }

  /** The sentence that says what to change — without the lane's parenthesis. */
  override get userMessage(): string {
    return outputCappedMessage()
  }
}

/**
 * Every dialect's spelling of "stopped at the output cap". Matched on the
 * provider's own raw value, never on the text: a short answer and a cut-off
 * one are indistinguishable from the outside.
 */
const OUTPUT_CAP_STOP_REASONS: ReadonlySet<string> = new Set([
  "length", // chat-completions — KIE's Gemini and GPT-5.2 endpoints
  "max_tokens", // Claude messages — KIE and the direct Anthropic SDK
  "MAX_TOKENS", // Google generateContent — the direct Gemini lane
  "max_output_tokens", // responses — `incomplete_details.reason`
])

export function isOutputCapStop(reason: unknown): boolean {
  return typeof reason === "string" && OUTPUT_CAP_STOP_REASONS.has(reason)
}

/**
 * The sentence every lane's truncation error opens with — what happened and
 * what the person running it can change. It names no number on purpose: the
 * cap sent is often the reasoning floor, not the Max Tokens the node shows, so
 * quoting it reads as a contradiction. The lane's own diagnostic (cap included)
 * follows in parentheses, so the stored error still says which lane and why.
 */
export function outputCappedMessage(): string {
  return "The answer was cut off: the model reached its output limit before finishing " +
    "(its reasoning counts toward that limit). Ask for a shorter answer, lower Effort, or raise Max Tokens."
}

/**
 * The provider cost a failed call already incurred, for the failed job row's
 * `provider_cost` — `null` when the failure reported none (a transport error
 * spent nothing). Read by shape, not class, so it covers both usage-carrying
 * throws: {@link LlmStreamResponseError} (and its truncation subclass) and
 * llm-client's `StructuredLlmError`, which sums every attempt.
 *
 * Why the routes need it: a cut-off reply used to complete WITH its cost
 * recorded; since #1588 it fails, and a failed row without this would drop a
 * real provider charge from every cost report.
 */
export function billedProviderCost(err: unknown): number | null {
  const cost = (err as { usage?: { providerCost?: unknown } } | null | undefined)?.usage?.providerCost
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null
}

/**
 * Throw {@link LlmOutputTruncatedError} when the provider says it stopped at the
 * output cap. Every adapter calls this with the provider's own stop reason —
 * the only point where a cut-off answer can still be told apart from a
 * finished one.
 *
 * `cap` is the cap actually SENT (after the reasoning floor), or undefined when
 * the provider's own default applied; the message names it only when known.
 */
export function assertNotOutputCapped(opts: {
  modelId: string
  lane: string
  stopReason: unknown
  cap: number | undefined
  usage: { inputTokens: number; outputTokens: number } | undefined
  providerCost: number | undefined
}): void {
  const { modelId, lane, stopReason, cap, usage, providerCost } = opts
  if (!isOutputCapStop(stopReason)) return
  const detail = `${lane} ${modelId} stopped with ${String(stopReason)} at cap ${cap ?? "provider default"} ` +
    `(in ${usage?.inputTokens ?? "?"} / out ${usage?.outputTokens ?? "?"} tokens)`
  // Logged as well as thrown: a caller that rewrites the message (the Scene3D
  // planner once did) would otherwise leave no record of why the call ended.
  console.warn(`[llm-output-truncated] ${detail}`)
  throw new LlmOutputTruncatedError(`${outputCappedMessage()} (${detail})`, {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    providerCost,
    complete: usage !== undefined && providerCost !== undefined,
  })
}

/** How many links of a `cause` chain a log line carries, and how much of each. */
const ERROR_CHAIN_MAX_LINKS = 6
const ERROR_CHAIN_MAX_CHARS_PER_LINK = 600

/**
 * An error and every `cause` beneath it as one log line, outermost first: each
 * link's class name and message. Name and message only, on purpose — an SDK
 * error object also carries the request it failed on, and that is never
 * logged. Bounded, because a provider's message is not a log budget.
 */
export function describeErrorChain(err: unknown): string {
  const links: string[] = []
  let current: unknown = err
  for (let depth = 0; current !== null && current !== undefined && depth < ERROR_CHAIN_MAX_LINKS; depth++) {
    const message = (current as { message?: unknown }).message
    const text = current instanceof Error
      ? `${current.name}: ${current.message}`
      : typeof message === "string" ? message : String(current)
    links.push(text.length > ERROR_CHAIN_MAX_CHARS_PER_LINK ? `${text.slice(0, ERROR_CHAIN_MAX_CHARS_PER_LINK)}…` : text)
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined
  }
  return links.join(" | caused by ")
}

/**
 * A lane adapter's failure, re-thrown as {@link LlmPlatformExhaustedError}
 * when it is the platform's own account refusing (`classifyPlatformExhaustion`),
 * else unchanged. A usage-carrying failure is never re-typed — the provider
 * answered and billed, so it was not an account refusal. The first time a
 * provider's account is seen refusing, an `[ALERT]` line goes to the logs.
 */
export function toPlatformExhausted(
  err: unknown,
  ctx: { lane: "kie" | "direct"; provider: string; modelId: string },
): unknown {
  if (err instanceof LlmPlatformExhaustedError || err instanceof LlmStreamResponseError) return err
  const signal = exhaustionSignalOf(err)
  const rule = signal ? matchPlatformExhaustion(signal) : null
  if (!signal || !rule) return err
  const raw = err instanceof Error ? err.message : String(err)
  alertPlatformExhaustion({ provider: ctx.provider, kind: rule.kind, lane: ctx.lane, modelId: ctx.modelId, detail: raw })
  // A drained DIRECT balance is skipped for a short window (DIRECT_LANE_LATCH_MS). Never a refused key: 401/403
  // can be a transient permission blip, and never the KIE lane, which has no other lane to move to.
  if (ctx.lane === "direct" && rule.kind === "billing") latchDirectLaneExhausted({ provider: ctx.provider, kind: rule.kind, detail: raw })
  return new LlmPlatformExhaustedError(
    `${ctx.provider} ${ctx.lane} lane ${ctx.modelId}: platform account ${rule.kind === "billing" ? "out of credit/quota" : "key refused"} — ${raw}`,
    { lane: ctx.lane, provider: ctx.provider, exhaustion: rule.kind, httpStatus: signal.status, cause: err },
  )
}

/** Run one lane adapter call, re-typing a platform-account refusal ({@link toPlatformExhausted}). */
export async function guardLaneAccount<T>(
  ctx: { lane: "kie" | "direct"; provider: string; modelId: string },
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call()
  } catch (err) {
    throw toPlatformExhausted(err, ctx)
  }
}
