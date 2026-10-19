/**
 * The transport-retry ladder: re-dial a failure that cost nothing (no usage reported).
 */

import { LlmPlatformExhaustedError, LlmStreamResponseError } from "../llm-errors.js"
import { classifyPlatformExhaustion, exhaustionSignalOf } from "../llm-platform-exhaustion.js"
import { effectiveTimeout } from "./params.js"
import type { LlmRequest } from "./types.js"

/**
 * The transport-retry ladder: the pause before each EXTRA attempt at a failure that cost
 * nothing. Its length is the number of extra attempts (so 5 entries = 6 attempts in all).
 *
 * MEASURED 2026-09-14 (round 7g) against staging, KIE `codex/v1/responses` serving
 * `gpt-6-astra`: 4 of 21 POSTs in one four-hour window — 19% — came back
 * `503 {"error":{"type":"server_error","message":"Service temporarily unavailable"}}` in one to
 * three seconds, carrying no usage, on requests that were otherwise identical to the 17 that
 * answered. It is not a property of the request: the same 503 ended the 1.8 KB table brief's
 * job (ddb9251d) AND the 257-character suitcase brief's job (48595da9), the registry's own
 * 2026-09-06 probe measured 1 failure in 6 on this lane with a TINY body, and two of round 7g's
 * own eight probes 503'd on their first POST — one at 98,683 chars (the smallest request of the
 * round) and one at 165,000 (the largest), both answered by a retry 400 ms later. A request
 * rejected for its size does not become acceptable 400 ms later.
 *
 * ONE extra attempt at 400 ms was measured to be too short: staging job a37e5a64's planner call
 * 503'd, paused the 400 ms, and 503'd again — the pair 2 s apart — and the job died having
 * already paid for the authoring pass before it. So the ladder steps out past a short flap
 * instead of hitting the same wobble twice: 400 ms clears an instant one, 2 s and 6 s clear a
 * several-second one. 8.4 s is the whole added wait in the worst case, against a caller (the
 * Scene3D planner) whose own deadline is 360 s and whose job dies outright on the first
 * unanswered call.
 *
 * MEASURED AGAIN 2026-09-14 05:04:42–05:04:57Z (round 10a), staging job 7f109f4b, the edit
 * pass of the first Basic-lane scene to author end to end: the repair planner call failed FOUR
 * times in fifteen seconds — `upstream_error` frame, `500 "The server is currently being
 * maintained"`, `503 "Service temporarily unavailable"`, then the 500 again — every one before
 * any usage, so the whole 8.4 s ladder was spent inside one burst and the job died having paid
 * for pass 0. The six bursts the ladder met between 04:43Z and 05:05Z tell the shape: five
 * ended within one or two extra attempts (2.4 s), one outran 8.4 s. The failures on this lane
 * come in BURSTS of mixed shapes, not as independent 19% coin flips (four independent misses
 * would be 0.13%; one burst in six is what was seen). So the ladder gains a 15 s and a 30 s
 * step: 53.4 s of added wait in the worst case, still bounded by the caller's own deadline
 * (the Scene3D planner's is 360 s), and still free — none of these attempts reported usage.
 *
 * It does NOT try to ride out a real outage — minutes of `server_error` still surface, which is
 * the behaviour the Scene3D loop deliberately treats as terminal rather than burning three
 * queue attempts on.
 */
const LLM_TRANSPORT_RETRY_DELAYS_MS: readonly number[] = [400, 2_000, 6_000, 15_000, 30_000]

/**
 * May this failure be retried at the TRANSPORT level — i.e. did it cost nothing?
 *
 * The rule is one line and it is the whole safety property: **a call that reported usage is
 * never retried.** A failure that reported none (connection error, 5xx, an `event: error` frame
 * or a silent close before any usage arrived) spent nothing, so one more attempt is free; a
 * failure carrying usage is an {@link LlmStreamResponseError} and re-asking would double-pay.
 *
 * This is deliberately INDEPENDENT of `llmCompleteStructured`'s `maxRetries`, which counts
 * VALIDATION retries — re-asking a provider that already answered, and paying again for a
 * better-shaped answer. A caller that sets `maxRetries: 0` (the plugin host's structured calls
 * do, on purpose) is refusing to pay twice for a wrong answer; it is not asking to fail on a
 * 503 that cost nothing. Coupling the two, as this file did between 2026-09-08 and now, is
 * what left the Scene3D planner with no retry at all: measured 2026-09-13, a
 * `503 {"type":"server_error"}` and an `upstream_error … "The server is currently being
 * maintained"` frame, both with NO usage, each ending a paid job outright.
 *
 * `retryStreamOnError: false` is the explicit opt-out, for a caller that must see the first
 * failure immediately.
 */
function transportRetryable(err: unknown, req: LlmRequest): boolean {
  if (err instanceof LlmStreamResponseError) return false
  // A drained or refused platform account answers the same way 400 ms later.
  if (err instanceof LlmPlatformExhaustedError) return false
  const signal = exhaustionSignalOf(err)
  if (signal && classifyPlatformExhaustion(signal)) return false
  return req.retryStreamOnError !== false
}

/**
 * Run `once`, and on a failure that cost nothing run it again — up to
 * {@link LLM_TRANSPORT_RETRY_DELAYS_MS}`.length` more times, pausing longer before each.
 *
 * Bounded on purpose, and bounded TWICE: by the ladder's length, and by the caller's own
 * `timeoutMs` — no further attempt is STARTED once the elapsed time plus the next pause would
 * pass the deadline this call entered with. That second bound is the one that makes a longer
 * ladder safe on the lanes whose `once()` arms its own per-attempt `AbortSignal.timeout`: a
 * slow failure spends the caller's budget and then stops, instead of buying itself another full
 * timeout per attempt the way a fixed count alone would.
 *
 * The LAST attempt's error propagates unchanged — no retry-exhausted wrapper, so the provider's
 * own reason is what the caller and the logs see.
 *
 * `abandoned` lets a lane that shares ONE deadline across every attempt (the responses lane)
 * stop rather than start an attempt the caller no longer has time for.
 *
 * `signal` is a caller's cancel: a pause it fires during ends at once, throwing the signal's
 * reason (an `AbortError` when the reason is not an Error) so the caller can tell a cancel from
 * a transport failure — instead of sleeping out a pause of up to 30 s first.
 */
export async function withTransportRetry<T>(
  modelId: string,
  req: LlmRequest,
  once: () => Promise<T>,
  abandoned: () => boolean = () => false,
  signal?: AbortSignal,
): Promise<T> {
  // Read once, at entry: the ladder is bounded by the budget the CALL was given, not by a
  // fresh budget per attempt.
  const deadline = Date.now() + effectiveTimeout(req)
  const total = LLM_TRANSPORT_RETRY_DELAYS_MS.length + 1
  for (let attempt = 1; ; attempt++) {
    try {
      return await once()
    } catch (err) {
      if (attempt > LLM_TRANSPORT_RETRY_DELAYS_MS.length || !transportRetryable(err, req) || abandoned()) throw err
      const pause = LLM_TRANSPORT_RETRY_DELAYS_MS[attempt - 1]
      if (Date.now() + pause >= deadline) throw err
      console.warn(
        `[llm-kie-stream-retry] ${modelId} attempt ${attempt + 1}/${total} in ${pause} ms — ` +
          `attempt ${attempt} failed before any usage was reported: ${String(err).slice(0, 160)}`,
      )
      if (signal) await pauseUnlessAborted(pause, signal)
      else await new Promise((resolve) => setTimeout(resolve, pause))
      if (abandoned()) throw err
    }
  }
}

/** The reason a fired signal stands for, as something a caller can recognise as a cancel. */
function abortReasonOf(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("This operation was aborted"), { name: "AbortError" })
}

/** Wait `ms`, or reject the moment `signal` fires (at once if it already has). */
function pauseUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReasonOf(signal))
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortReasonOf(signal))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}
