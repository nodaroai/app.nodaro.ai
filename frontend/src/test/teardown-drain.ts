/**
 * One real macrotask turn after every jsdom test, so the timers a component
 * schedules while it unmounts fire while the jsdom window is still alive.
 * setup.ts registers it as an `afterEach` for every jsdom file.
 *
 * Why: Radix's Dialog, Popover, DropdownMenu and FocusScope do not restore
 * focus at once when they unmount. Their effect cleanup schedules a
 * `setTimeout(0)` that creates a `CustomEvent` and dispatches it on the
 * overlay's container. A synchronous test gives that timer no turn, so the
 * timers Testing Library's `cleanup()` triggers are still pending when the
 * file's last hook returns. If Vitest tears the jsdom environment down first,
 * the global `CustomEvent` is Node's own again, jsdom's `dispatchEvent` throws
 * "parameter 1 is not of type 'Event'", and the shard ends with an unhandled
 * error (#2328: review-player.state, shard 4, 2026-10-15/16). Between tests,
 * the same pending timers fire at the next test's first `await` and move focus
 * in the middle of that test. Measured 2026-10-18: 56 of 1,472 frontend files
 * ended with such zero-delay Radix timers pending; 0 with this drain. (Two
 * more keep Tooltip's 300 ms skip-delay timer, which only writes a ref and
 * which one zero-delay turn does not wait for.)
 *
 * Ordering, not a guessed sleep:
 *  - It runs after cleanup. Vitest runs `afterEach` hooks in reverse order of
 *    registration (`sequence.hooks: "stack"`, set explicitly in
 *    vitest.config.ts). setup.ts registers this before the test file is
 *    imported, and therefore before Testing Library registers its auto-cleanup
 *    (shared-worker-setup.ts registers its cleanup after setup.ts too), so
 *    every cleanup runs first, and every `afterEach` the test file declares
 *    runs before that.
 *  - One turn is enough. `cleanup()` unmounts inside `act()`, so Radix
 *    schedules its timers synchronously before this one, and Node fires timers
 *    of equal delay in the order they were scheduled.
 *
 * Fake timers: the wait uses `node:timers`' `setTimeout`, which
 * `vi.useFakeTimers()` does not replace (it patches `globalThis` only), so a
 * test that ends with fake timers installed cannot hang this hook. In that case
 * the timers Radix scheduled sit on the fake clock, which only fires when a
 * test advances it and is discarded by `vi.useRealTimers()` or teardown, so
 * they can never run against a torn-down window and need no drain. Running
 * them instead (`vi.runOnlyPendingTimers()`) would also run every pending
 * callback the test itself left (debounces, polls) after the test is over,
 * and running them before cleanup could not reach the timers cleanup itself
 * schedules. The real turn still drains any real timer pending at that point.
 */
import { setTimeout as realSetTimeout } from "node:timers"

export function settleAfterCleanup(): Promise<void> {
  return new Promise<void>((resolve) => {
    realSetTimeout(resolve, 0)
  })
}
