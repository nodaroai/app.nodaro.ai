/**
 * A stopped stream, as the error that bills it (D2).
 *
 * When the caller of `llmStream` aborts AFTER the request was dispatched, the
 * provider has already read the prompt and written part of an answer — and it
 * bills both — but the frame that would report that usage never arrives. Every
 * stream lane turns such an abort into {@link LlmStreamAbortedError} through
 * {@link asStoppedStream}, so the three lanes cannot price it differently:
 *
 * - input `ceil(requestChars ÷ 4)` and output `ceil(streamedChars ÷ 4)`, or the
 *   lane's own reported counts when it reported any before the stop (the direct
 *   Gemini lane reports usage on every chunk);
 * - priced at the SERVING lane's rate with the throwing `calculateLlmCost`, so
 *   a model with no rate fails loudly rather than costing the stop $0.
 *
 * "Dispatched" means the transport call (fetch, the SDK stream) was issued
 * while the signal was still live. An abort before that spent nothing: each
 * lane checks the signal first and throws its plain abort error, which carries
 * no usage and is refunded. A TIMEOUT is not an abort — a signal whose reason
 * is a `TimeoutError` (a caller's deadline, often combined with its cancel)
 * keeps today's plain error.
 */

import { calculateLlmCost } from "../pricing/llm-cost.js"
import { LlmStreamAbortedError, LlmStreamResponseError } from "../llm-errors.js"
import type { LlmServedLane } from "./types.js"

/** What a lane needs to bill a stop: the caller's signal and the request's size (`requestChars`). */
export interface StreamAbortContext {
  signal: AbortSignal
  requestChars: number
}

/** The caller stopped the call: its signal fired, and not because a deadline ran out. */
export function callerStopped(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false
  const reason = signal.reason as { name?: unknown } | null | undefined
  return !(reason !== null && typeof reason === "object" && reason.name === "TimeoutError")
}

/**
 * `err` as the error a stopped stream throws, when the caller stopped it;
 * otherwise `err` unchanged. A failure that already carries usage (an error
 * frame, a refusal, a cap stop racing the abort) keeps its own class: what it
 * reports beats an estimate.
 */
export function asStoppedStream(
  err: unknown,
  ctx: StreamAbortContext & {
    /** The registry id (never a lane's own vendor id): the rate tables are keyed by it. */
    modelId: string
    lane: LlmServedLane
    /** Characters of answer that reached the caller before the stop. */
    streamedChars: number
    /** The lane's own counts, when it reported any before the stop. */
    reported?: { inputTokens: number; outputTokens: number }
  },
): unknown {
  if (err instanceof LlmStreamResponseError || !callerStopped(ctx.signal)) return err
  const tokens = ctx.reported ?? {
    inputTokens: Math.ceil(ctx.requestChars / 4),
    outputTokens: Math.ceil(ctx.streamedChars / 4),
  }
  const providerCost = calculateLlmCost(ctx.modelId, tokens, ctx.lane === "kie" ? "kie" : "direct")
  const stopped = new LlmStreamAbortedError(
    `${ctx.lane} stream ${ctx.modelId} stopped by the caller after ${ctx.streamedChars} streamed chars ` +
      `(in ${tokens.inputTokens} / out ${tokens.outputTokens} tokens, ${ctx.reported ? "as reported" : "estimated"})`,
    { ...tokens, providerCost, complete: false, estimated: true },
    ctx.lane,
  )
  stopped.cause = err
  return stopped
}
