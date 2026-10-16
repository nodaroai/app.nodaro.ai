/**
 * Serving-lane fallback: the one way every routing site reaches its second lane.
 */

import type { LlmModelDef } from "@nodaro/shared/llm-models"
import { config } from "../config.js"
import {
  LlmContentRefusalError,
  LlmLaneError,
  LlmOutputTruncatedError,
  LlmPlatformExhaustedError,
  LlmStreamResponseError,
  describeErrorChain,
} from "../llm-errors.js"
import { callKie } from "./kie-lane.js"
import type { LlmRequest, LlmResponse } from "./types.js"

/** KIE as a fallback leg, or `undefined` when it isn't configured (in which
 *  case the primary lane's error must surface rather than be swallowed). */
export function kieFallback(model: LlmModelDef, req: LlmRequest): (() => Promise<LlmResponse>) | undefined {
  return config.KIE_API_KEY ? () => callKie(model, req) : undefined
}

/** Which lane failed and which one is about to serve — for the fallback warn. */
export interface LaneFallbackCtx {
  modelId: string
  primary: string
  fallback: string
}

/**
 * Serve a call from its fallback lane once `primaryErr` ended the primary one —
 * the ONE way every fallback site in this file reaches its second lane, so
 * none can skip either log line.
 *
 * The primary failure is one greppable warn line. Without it a chronic
 * primary-lane outage is invisible: every unpinned call quietly serves from the
 * other lane (at that lane's cost profile) and only lane-PINNED calls ever
 * surface the error — which is exactly how the 2026-08-14 direct-Gemini
 * `403 PERMISSION_DENIED` blip was diagnosable only through a pinned
 * video-analysis job. Warn, not error: the request may still succeed.
 *
 * A fallback that fails too is an error line, with its whole cause chain. Its
 * error is what the caller gets, and it often reaches the person as the
 * provider's own sentence — which a route logs only when it rewrote it — so
 * without this line a broken fallback lane left no trace at all. The error is
 * rethrown AS IS: `instanceof` decides billing and retries downstream
 * (`failureWithSpend`, `transportRetryable`, `userFacingMessage`).
 */
export async function serveFromFallback<T>(ctx: LaneFallbackCtx, primaryErr: unknown, fallback: () => Promise<T>): Promise<T> {
  const msg = primaryErr instanceof LlmLaneError
    ? primaryErr.internalDetails
    : primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
  const head = msg.length > 300 ? `${msg.slice(0, 300)}…` : msg
  console.warn(
    `[llm-lane-fallback] ${ctx.modelId}: ${ctx.primary} lane failed, serving from ${ctx.fallback} — ${head}`,
  )
  try {
    return await fallback()
  } catch (err) {
    console.error(
      `[llm-lane-fallback] ${ctx.modelId}: ${ctx.fallback} lane also failed (after the ${ctx.primary} lane) — ` +
        describeErrorChain(err),
    )
    // The primary's account was the reason this lane was asked at all: when the
    // fallback fails too WITHOUT answering, the person reads the capacity
    // sentence (not the second lane's own), and both diagnostics stay in the
    // operator detail. A usage-carrying failure keeps its class — it was
    // billed, and billing reads it.
    // The primary's failure rides as the fallback's `cause` when it has none of
    // its own, so a reader of the chain can still tell why the second lane was
    // asked — describe-to-picker must not send a request the direct lane
    // REFUSED as malformed (a 400) on to another vendor just because KIE then
    // failed too. Non-enumerable, like a native `cause`.
    attachCause(err, primaryErr)
    if (primaryErr instanceof LlmPlatformExhaustedError && !(err instanceof LlmStreamResponseError) &&
      !(err instanceof LlmPlatformExhaustedError)) {
      const second = err instanceof LlmLaneError ? err.internalDetails : err instanceof Error ? err.message : String(err)
      throw new LlmPlatformExhaustedError(`${primaryErr.internalDetails} | ${ctx.fallback} fallback failed: ${second}`, {
        lane: primaryErr.lane,
        provider: primaryErr.provider,
        exhaustion: primaryErr.exhaustion,
        httpStatus: primaryErr.httpStatus,
        cause: err,
      })
    }
    throw err
  }
}

/**
 * May a failure on one lane be re-asked on the other? Not a cap stop: the
 * reply ran to the output cap, and that cap is the request's, not the lane's —
 * the other lane gets the SAME cap for the same prompt, so a fallback buys a
 * second billed full-length reply that most likely stops at the same place
 * (the direct Gemini lane reasons MORE than KIE's on the same input, #1588).
 * Every other failure keeps the fallback.
 */
export function laneFallbackAllowed(err: unknown): boolean {
  // Nor a content refusal: it is the model's answer to the request, and the
  // other lane serves the same model the same request (LlmContentRefusalError).
  return !(err instanceof LlmOutputTruncatedError) && !(err instanceof LlmContentRefusalError)
}

/** Run `primary`, falling back to `secondary` on failure (warn-logged). With no
 *  secondary the original error propagates untouched. */
export async function withFallback(
  ctx: LaneFallbackCtx,
  primary: () => Promise<LlmResponse>,
  secondary: (() => Promise<LlmResponse>) | undefined,
): Promise<LlmResponse> {
  if (!secondary) return primary()
  try {
    return await primary()
  } catch (err) {
    if (!laneFallbackAllowed(err)) throw err
    return serveFromFallback(ctx, err, secondary)
  }
}

/**
 * Streaming twin of {@link withFallback}. The extra rule: once a token has
 * reached the caller the stream is TAINTED — restarting on the other lane
 * would duplicate everything already emitted — so a mid-stream failure always
 * surfaces. Only a failure before the first token is recoverable.
 */
export async function streamWithFallback(
  ctx: LaneFallbackCtx,
  primary: (onToken: (chunk: string) => void) => Promise<LlmResponse>,
  secondary: ((onToken: (chunk: string) => void) => Promise<LlmResponse>) | undefined,
  onToken: (chunk: string) => void,
): Promise<LlmResponse> {
  if (!secondary) return primary(onToken)
  let emitted = false
  try {
    return await primary((chunk) => { emitted = true; onToken(chunk) })
  } catch (err) {
    // A cap stop with no visible token (all of it reasoning) is still a cap stop.
    if (emitted || !laneFallbackAllowed(err)) throw err
    return serveFromFallback(ctx, err, () => secondary(onToken))
  }
}

/** Set `cause` on an error that has none (never on itself). Best-effort: a frozen error keeps its shape. */
function attachCause(err: unknown, cause: unknown): void {
  if (!(err instanceof Error) || err === cause || err.cause !== undefined) return
  try {
    Object.defineProperty(err, "cause", { value: cause, configurable: true, writable: true, enumerable: false })
  } catch {
    // ignore
  }
}
