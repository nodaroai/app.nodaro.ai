/**
 * Limits on how many downloads one process runs at once, per user and in all:
 * a lane that streams a caller's file to this host's disk bounds its fan-out,
 * so a burst cannot fill the disk (ENOSPC takes the whole process down).
 *
 * Each lane makes its OWN set (`createInflightSlots`), with its own limits:
 * the counts are never shared between lanes. Counted in this process only —
 * the API, the orchestrator and each worker process hold their own.
 *
 * Every acquired slot must be released exactly once (a `finally`), on every
 * way out: success, refusal, a throw, a cancellation.
 */

export interface InflightLimits {
  /** At most this many at once for one user. */
  readonly perUser: number
  /** At most this many at once in this process. */
  readonly global: number
}

export interface InflightSlots {
  /** Take a slot now, or false when a limit is reached. No user: only the global limit applies. */
  tryAcquire(userId: string | undefined): boolean
  /**
   * Take a slot, waiting up to `waitMs` for one to free; false when none did.
   * Rejects with the signal's reason when `signal` aborts while waiting.
   */
  acquire(userId: string | undefined, opts: { readonly waitMs: number; readonly signal?: AbortSignal }): Promise<boolean>
  /** Give back a slot `tryAcquire` / `acquire` took. */
  release(userId: string | undefined): void
  /** How many slots are held, in all and for one user (for tests and logs). */
  held(userId?: string): number
}

export function createInflightSlots(limits: InflightLimits): InflightSlots {
  const byUser = new Map<string, number>()
  let global = 0
  const waiters = new Set<() => void>()

  const tryAcquire = (userId: string | undefined): boolean => {
    if (global >= limits.global) return false
    if (userId !== undefined) {
      const n = byUser.get(userId) ?? 0
      if (n >= limits.perUser) return false
      byUser.set(userId, n + 1)
    }
    global++
    return true
  }

  return {
    tryAcquire,
    acquire(userId, { waitMs, signal }) {
      if (signal?.aborted) return Promise.reject(signal.reason)
      if (tryAcquire(userId)) return Promise.resolve(true)
      if (waitMs <= 0) return Promise.resolve(false)
      return new Promise<boolean>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer)
          waiters.delete(wake)
          signal?.removeEventListener("abort", onAbort)
        }
        const wake = () => {
          if (tryAcquire(userId)) { done(); resolve(true) }
        }
        const onAbort = () => { done(); reject(signal!.reason) }
        const timer = setTimeout(() => { done(); resolve(false) }, waitMs)
        waiters.add(wake)
        signal?.addEventListener("abort", onAbort, { once: true })
      })
    },
    release(userId) {
      global = Math.max(0, global - 1)
      if (userId !== undefined) {
        const n = (byUser.get(userId) ?? 1) - 1
        if (n <= 0) byUser.delete(userId)
        else byUser.set(userId, n)
      }
      // Oldest waiter first; each takes a slot only if one is free for it.
      for (const wake of [...waiters]) wake()
    },
    held(userId) {
      return userId === undefined ? global : byUser.get(userId) ?? 0
    },
  }
}
