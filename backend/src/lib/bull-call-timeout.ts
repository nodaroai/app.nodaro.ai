/**
 * A BullMQ call that cannot stall a sweep.
 *
 * The queue connections here are opened with `maxRetriesPerRequest: null`
 * (`orchestration-queue.ts`), so while Redis is unreachable a command waits
 * for it to come back instead of failing. A sweep awaiting such a call would
 * stop there, and every later tick would stop behind it. `bounded` ends the
 * wait after `BULL_CALL_TIMEOUT_MS` with a `BullCallTimeoutError`, which a
 * sweep reads as "Redis is down for this pass": it leaves the row it was
 * judging as it is and does no more Redis work until its next tick.
 *
 * Shared by the lanes' queued sweep (`concurrency-lanes/queued-sweep.ts`) and
 * the never-started sweep (`reconcile/never-started-executions.ts`).
 */

/** The most one BullMQ call may take before the pass reads Redis as down. */
export const BULL_CALL_TIMEOUT_MS = 5_000

/** BullMQ did not answer in time: Redis is unreachable for this pass. */
export class BullCallTimeoutError extends Error {
  constructor(what: string) {
    super(`BullMQ did not answer "${what}" within ${BULL_CALL_TIMEOUT_MS} ms`)
    this.name = "BullCallTimeoutError"
  }
}

/** `promise`, or a BullCallTimeoutError after BULL_CALL_TIMEOUT_MS (the BullMQ connection queues commands while Redis is down). */
export function bounded<T>(promise: Promise<T>, what: string): Promise<T> {
  promise.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BullCallTimeoutError(what)), BULL_CALL_TIMEOUT_MS)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
