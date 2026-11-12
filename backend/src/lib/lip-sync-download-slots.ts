/**
 * How many lip-sync price-check downloads one process runs at once, per user
 * and in all (decided 2026-11-11). The price check downloads every audio file
 * it measures (decided 2026-11-12: the decoded length, never a declared one) —
 * up to `LIP_SYNC_AUDIO_SOURCE_MAX_BYTES` to this host's disk, in the API
 * process for a route call and in the orchestrator for a workflow run — and
 * decodes it, beside it, into the PCM it would be sent as (44.1 kHz stereo
 * 16-bit: ~53 MB at the 300 s maximum, removed once counted). A burst of those must not fill the disk, so each takes a slot: at most
 * {@link LIP_SYNC_MEASURE_MAX_INFLIGHT_PER_USER} for one user and
 * {@link LIP_SYNC_MEASURE_MAX_INFLIGHT_GLOBAL} in all. A call over a limit
 * waits up to {@link LIP_SYNC_MEASURE_SLOT_WAIT_MS} for one, then is refused
 * ("try again in a moment") before anything is held.
 *
 * LOCAL COPY: the same shape and constants as the shared in-flight limiter
 * (`createInflightSlots`, lib/inflight-slots.ts) that another change is adding.
 * Once it lands, this file goes and the lip-sync lane makes its set with the
 * shared function instead.
 *
 * Counted in this process only. Every acquired slot must be released exactly
 * once (a `finally`), on every way out.
 */

export const LIP_SYNC_MEASURE_MAX_INFLIGHT_PER_USER = 2
export const LIP_SYNC_MEASURE_MAX_INFLIGHT_GLOBAL = 8
export const LIP_SYNC_MEASURE_SLOT_WAIT_MS = 30_000

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

export function createLocalInflightSlots(limits: InflightLimits): InflightSlots {
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

/** The lip-sync price check's download slots in this process. */
export const lipSyncMeasureSlots: InflightSlots = createLocalInflightSlots({
  perUser: LIP_SYNC_MEASURE_MAX_INFLIGHT_PER_USER,
  global: LIP_SYNC_MEASURE_MAX_INFLIGHT_GLOBAL,
})
