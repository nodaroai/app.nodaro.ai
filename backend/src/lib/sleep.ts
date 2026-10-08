/**
 * Await a fixed delay. A single shared helper (rather than an inline
 * `new Promise(r => setTimeout(r, ms))`) gives every caller ONE mockable seam:
 * unit tests `vi.mock("../lib/sleep.js")` to resolve immediately, so a backoff
 * schedule never inflates test wall-clock and never fights fake timers that a
 * long-running heartbeat interval would otherwise re-trigger forever.
 *
 * With a `signal`, the delay is abortable: it rejects with the signal's reason
 * the moment the signal aborts (at once if it already has), the same way a
 * fetch on that signal would — so a caller's deadline also bounds the pauses
 * between its attempts, not only the attempts.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}
