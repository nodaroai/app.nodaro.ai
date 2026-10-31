// backend/src/lib/concurrency-lanes/history-hooks.ts — what the live call path
// reports to the daily lane history. The history itself is admin code
// (ee/concurrency-lanes/history.ts) and registers its recorder here at boot,
// under hasAdmin(); core never imports it. Until one is registered (Community,
// or a process that keeps no history) a report is dropped.
import { warnLaneRateLimited } from "./hold.js"
import type { PayerKey } from "./types.js"

/** A live (sync HTTP) call that gave up waiting for a slot after the live-wait limit. */
export interface LiveWaitExpiry {
  userId: string
  payer: PayerKey
  /** How long it waited before giving up. */
  waitedMs: number
}

let recordLiveWaitExpiry: (e: LiveWaitExpiry) => void = () => {}

/** Who counts live-wait expiries into the history (the history module). */
export function registerLiveWaitExpiryRecorder(fn: (e: LiveWaitExpiry) => void): void {
  recordLiveWaitExpiry = fn
}

/** Count one live-wait expiry into the day's history. Never throws, never waits. */
export function countLiveWaitExpiry(e: LiveWaitExpiry): void {
  try {
    recordLiveWaitExpiry(e)
  } catch (err) {
    warnLaneRateLimited("could not count a live-wait expiry into the history", err)
  }
}

/** For tests: no recorder. */
export function resetHistoryHooksForTests(): void {
  recordLiveWaitExpiry = () => {}
}
