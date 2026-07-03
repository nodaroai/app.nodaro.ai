/**
 * Await a fixed delay. A single shared helper (rather than an inline
 * `new Promise(r => setTimeout(r, ms))`) gives every caller ONE mockable seam:
 * unit tests `vi.mock("../lib/sleep.js")` to resolve immediately, so a backoff
 * schedule never inflates test wall-clock and never fights fake timers that a
 * long-running heartbeat interval would otherwise re-trigger forever.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
