import { cleanup } from "@testing-library/react"

/**
 * Unmount what the test rendered, then let Radix finish unmounting while the
 * jsdom window is still alive. Every edl-review test file whose components
 * open a Radix overlay (the inspector's Dialog, a DropdownMenu, a Popover)
 * calls this from its `afterEach` in place of a bare `cleanup()`.
 *
 * Why: Radix FocusScope's effect cleanup does not restore focus at once. It
 * schedules a `setTimeout(0)` that creates a `CustomEvent` and dispatches it on
 * the overlay's container. A synchronous test gives that timer no macrotask
 * turn, so the timers from `cleanup()` are still pending when the file's last
 * hook returns. If Vitest tears the jsdom environment down first, the global
 * `CustomEvent` is Node's own again, and jsdom's `dispatchEvent` throws
 * "parameter 1 is not of type 'Event'". That surfaces as an unhandled error
 * that fails the whole CI shard (review-player.state, shard 4, 2026-10-15/16).
 * Between tests the same pending timers fire at the next test's first `await`
 * and move focus in the middle of that test.
 *
 * The one `setTimeout(0)` turn is ordered, not a guessed sleep. `cleanup()`
 * runs the unmount inside `act()`, so Radix schedules its timers synchronously
 * before this one, and Node fires timers of equal delay in the order they were
 * scheduled. That holds only with real timers, so a file that fakes timers
 * calls `vi.useRealTimers()` before this.
 */
export async function unmountAndSettle(): Promise<void> {
  cleanup()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
