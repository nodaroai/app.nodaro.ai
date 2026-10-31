// backend/src/lib/concurrency-lanes/errors.ts — what a wait for a concurrency
// slot ends in when it does not get one: the queue timeout (or an entry that
// was lost, or a live wait that ran out), an abort, and the answer a live
// request gets when it cannot wait any longer.
import { DeterministicJobError } from "../deterministic-job-error.js"
import type { QueueTimeoutHint } from "../safety-block.js"

/** The `jobs.error_hint` arm of a job that never got a slot (its home is the ErrorHint union). */
export type { QueueTimeoutHint }

const MINUTE_MS = 60_000

/** Whole minutes in `ms`, rounded down (never negative). */
export function waitedMinutesOf(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / MINUTE_MS) : 0
}

export const LANE_BUSY_MESSAGE = "Busy right now — try again in a few minutes."
export const LANE_LOST_MESSAGE = "This job lost its place in line and did not run. Your credits were refunded — please run it again."

/** The user-facing sentence of a queue timeout after `minutes` (the timeout setting). */
export function queueTimeoutMessage(minutes: number): string {
  return `Waited longer than ${minutes} min for a free slot.`
}

/**
 * A wait for a slot that ran out. Deterministic: the job is failed and
 * refunded on this attempt and never retried — a retry would only wait the
 * whole timeout again behind the same line.
 */
export class LaneWaitTimeoutError extends DeterministicJobError {
  readonly failureHint: QueueTimeoutHint

  /**
   * `waitedMs`: how long the job waited. `timeoutMinutes`: the limit it ran
   * into, for the message of a `timeout` (defaults to the minutes waited).
   */
  constructor(opts: { reason: QueueTimeoutHint["reason"]; waitedMs: number; timeoutMinutes?: number }) {
    const waitedMinutes = waitedMinutesOf(opts.waitedMs)
    const message = opts.reason === "lost"
      ? LANE_LOST_MESSAGE
      : opts.reason === "live-wait"
        ? LANE_BUSY_MESSAGE
        : queueTimeoutMessage(opts.timeoutMinutes ?? waitedMinutes)
    super(message)
    this.name = "LaneWaitTimeoutError"
    this.failureHint = { kind: "queue-timeout", reason: opts.reason, waitedMinutes }
  }
}

/** A wait for a slot ended by its caller's abort signal before it got one. */
export class LaneWaitAbortedError extends Error {
  constructor(message = "The wait for a free slot was aborted.") {
    super(message)
    this.name = "LaneWaitAbortedError"
  }
}

/** A live (sync HTTP) call that could not get a slot within its wait limit: a 503 with Retry-After. */
export class LaneBusyError extends Error {
  readonly code = "lane_busy"
  readonly retryAfterS = 60

  constructor(message = LANE_BUSY_MESSAGE) {
    super(message)
    this.name = "LaneBusyError"
  }
}

/**
 * A programming error: ensureConcurrencySlot (a slot held for the rest of the
 * scope) called under a run or coordinator hold. A coordinator holds no slot
 * of its own; each of its calls takes one through withConcurrencySlot.
 */
export class EnsureUnderCoordinatorError extends Error {
  constructor(readonly role: "run" | "coordinator") {
    super(`ensureConcurrencySlot was called under a ${role} hold: wrap the call in withConcurrencySlot instead (each call under a ${role} hold takes its own slot)`)
    this.name = "EnsureUnderCoordinatorError"
  }
}
