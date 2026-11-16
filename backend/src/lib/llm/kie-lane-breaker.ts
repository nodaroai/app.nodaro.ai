/**
 * The KIE lane breaker: while KIE cannot serve a model, calls that have a
 * direct lane start there instead of paying the KIE wait first.
 *
 * Measured 2026-11-16: KIE answered every Claude Sonnet 5.5 and Haiku 5.5
 * request with HTTP 500 for over 16 hours (a three-word text prompt
 * included), and four other Claude models did not answer within 60 s. Each
 * call still went to KIE first, spent the whole transport-retry ladder there
 * (6 attempts, about 66 s; a model that hangs waits out the KIE timeout) and
 * was then served by the direct lane. Every call was slow by that much, and
 * the provider's log filled with six failures per call.
 *
 * The rule, per model and per process:
 * - A KIE-first call that fails because the lane could not serve it (a 5xx,
 *   in the HTTP status or KIE's in-band `code`, the lane's own timeout, or no
 *   connection) counts. Anything that says something about the REQUEST or
 *   was billed does not: a 4xx, an image that could not be prepared, a cap
 *   stop, a refusal, a caller's cancel or deadline, a drained account (which
 *   has its own latch).
 * - {@link KIE_BREAKER_TRIP_FAILURES} such calls in a row, the first and the
 *   last at least {@link KIE_BREAKER_MIN_SPAN_MS} apart, open the breaker for
 *   {@link KIE_BREAKER_SKIP_MS}. While it is open the direct lane serves
 *   first and KIE is the fallback.
 * - When the skip is over ONE call is the probe: it asks KIE first, a single
 *   attempt with no transport retries, while every other call stays on the
 *   direct lane. KIE answering closes the breaker; the lane failing again
 *   opens it for another skip.
 * - One success on KIE, at any time and in any role, resets everything.
 *
 * Why the span: the chat-completions wire (every Gemini model) has no
 * transport retry, and KIE's failures there come in bursts of a few seconds.
 * Three calls inside one burst must not move a model off KIE.
 *
 * Why the skip is short and never grows: a metered call is charged what the
 * lane that served it cost (`ee/billing/llm-metered.ts`, D1), and the direct
 * lanes cost more. During an outage that is what a per-call fallback already
 * costs; after KIE recovers, every further direct call is one KIE could have
 * served. So the breaker asks KIE again every skip, and the probe is one
 * call making one attempt.
 *
 * The breaker changes the ORDER of two lanes a call already has. It never
 * gives a call a lane it did not have: a KIE-pinned call, a run kept to the
 * cheap lanes and a model with no direct lane are not asked (the callers in
 * `lane-fallback.ts` decide that).
 */

import { LlmLaneError, LlmPlatformExhaustedError, LlmStreamResponseError } from "../llm-errors.js"

/** KIE-first calls that must fail in a row, for one model, to open its breaker. */
export const KIE_BREAKER_TRIP_FAILURES = 3
/** The least time between the first and the last of those failures. */
export const KIE_BREAKER_MIN_SPAN_MS = 60_000
/** How long a model's calls start on the direct lane before KIE is asked again. */
export const KIE_BREAKER_SKIP_MS = 2 * 60_000

/** The part a KIE call plays for the breaker. */
export type KieLaneRole =
  /** The call's first lane, breaker closed: a lane failure counts toward opening. */
  | "first"
  /** The one call that asks KIE first once a skip is over. */
  | "probe"
  /** KIE asked after the direct lane failed, while skipping: only a success says anything. */
  | "fallback"

interface BreakerState {
  /** Counted failures since the last success on KIE. */
  failures: number
  /** When the first of them happened. */
  firstFailureAt: number
  /** The breaker is open until this time; 0 = closed. */
  openUntil: number
  /** A probe is in flight. */
  probing: boolean
}

const states = new Map<string, BreakerState>()

/**
 * Did the KIE lane fail to serve — as opposed to the request being refused, or
 * answered and billed? `laneDeadline` says a timeout is the lane's own default
 * deadline: a caller that set its own (`timeoutMs`) may simply be less patient
 * than a healthy answer takes, so its timeout says nothing about the lane.
 */
export function kieLaneDownFailure(err: unknown, laneDeadline: boolean = true): boolean {
  // Reported usage: the provider answered. A drained account: its own latch.
  if (err instanceof LlmStreamResponseError || err instanceof LlmPlatformExhaustedError) return false
  if (err instanceof LlmLaneError) {
    if (err.lane !== "kie") return false
    const status = err.httpStatus ?? err.bodyCode
    // A lane error with no status is ours (an image that could not be
    // inlined) or a cut stream; neither says the lane is down for the model.
    return status !== undefined && status >= 500
  }
  if (!(err instanceof Error)) return false
  // A caller's cancel is an AbortError and never counts.
  if (err.name === "TimeoutError") return laneDeadline
  // Node's fetch could not connect or the connection dropped before a response.
  return err instanceof TypeError && err.message === "fetch failed"
}

/**
 * Is this model off KIE-first now (open, or waiting on its probe)? A pure
 * read, for whoever needs to know which provider a call made now reaches
 * first without making the call (`laneForCallNow`).
 */
export function kieLaneSkipped(modelId: string): boolean {
  const state = states.get(modelId)
  return state !== undefined && state.openUntil > 0
}

/**
 * How a KIE-first call that has a direct lane runs now: KIE first as always
 * (`first`), direct first with KIE as the fallback (`fallback`), or as the
 * probe. Answering `probe` CLAIMS it: the caller must run the call through
 * {@link trackKieLane} with that role, which releases the claim.
 */
export function claimKieLaneRole(modelId: string, now: number = Date.now()): KieLaneRole {
  const state = states.get(modelId)
  if (!state || state.openUntil === 0) return "first"
  if (state.openUntil > now || state.probing) return "fallback"
  state.probing = true
  return "probe"
}

function open(modelId: string, state: BreakerState, now: number, why: string): void {
  state.openUntil = now + KIE_BREAKER_SKIP_MS
  console.warn(
    `[llm-kie-breaker] ${modelId}: ${why} — calls start on the direct lane for ${Math.round(KIE_BREAKER_SKIP_MS / 60_000)} min`,
  )
}

/** A call was answered by KIE: the lane serves this model. */
export function noteKieLaneSuccess(modelId: string): void {
  const state = states.get(modelId)
  if (!state) return
  if (state.openUntil > 0) console.warn(`[llm-kie-breaker] ${modelId}: KIE answered — calls start on KIE again`)
  states.delete(modelId)
}

/** A call failed on KIE in `role`. */
export function noteKieLaneFailure(
  modelId: string, role: KieLaneRole, err: unknown, opts: { laneDeadline?: boolean; now?: number } = {},
): void {
  const now = opts.now ?? Date.now()
  const down = kieLaneDownFailure(err, opts.laneDeadline ?? true)
  if (role === "probe") {
    const state = states.get(modelId)
    if (!state) return
    state.probing = false
    // Still down: another skip. Anything else said nothing about the lane, so
    // the next call is the probe.
    if (down) open(modelId, state, now, "KIE still fails")
    return
  }
  if (role === "fallback" || !down) return
  const state = states.get(modelId) ?? { failures: 0, firstFailureAt: now, openUntil: 0, probing: false }
  // Opened by another call while this one was in flight.
  if (state.openUntil > 0) return
  state.failures += 1
  states.set(modelId, state)
  if (state.failures < KIE_BREAKER_TRIP_FAILURES || now - state.firstFailureAt < KIE_BREAKER_MIN_SPAN_MS) return
  open(modelId, state, now, `${state.failures} KIE-first calls failed in a row`)
}

/** Run a KIE call in `role` and record what it says about the lane. The error is rethrown as it is. */
export async function trackKieLane<T>(
  modelId: string, role: KieLaneRole, call: () => Promise<T>, opts: { laneDeadline?: boolean } = {},
): Promise<T> {
  let result: T
  try {
    result = await call()
  } catch (err) {
    noteKieLaneFailure(modelId, role, err, opts)
    throw err
  }
  noteKieLaneSuccess(modelId)
  return result
}

/** Test seam: forget every breaker. */
export function __resetKieLaneBreaker(): void {
  states.clear()
}
