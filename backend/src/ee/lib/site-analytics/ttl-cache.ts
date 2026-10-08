/**
 * A small in-process cache for Google's answers: a value is served until it
 * is older than the TTL; callers asking at once share one load; a failed load
 * is never kept; the oldest entry goes when the cache is full. One replica's
 * cache is not another's — at worst Google is asked once more.
 */
export interface Cached<T> {
  readonly value: T
  readonly fetchedAt: number
}

export interface TtlCache<T> {
  get(key: string, load: () => Promise<T>, opts?: { fresh?: boolean }): Promise<Cached<T>>
}

export function createTtlCache<T>(opts: {
  ttlMs: number
  maxEntries: number
  /** A `fresh` ask still gets the stored value when it is younger than this: a held-down Refresh cannot spend Google's quota. */
  minFreshMs?: number
  /** A stored value's own lifetime, when it decides — the realtime snapshot is kept longer once Google's allowance runs low. */
  ttlOf?: (value: T) => number
  now?: () => number
}): TtlCache<T> {
  const now = opts.now ?? Date.now
  const minFreshMs = opts.minFreshMs ?? 0
  const entries = new Map<string, Cached<T>>()
  const inflight = new Map<string, Promise<Cached<T>>>()

  function keep(key: string, entry: Cached<T>): void {
    entries.delete(key)
    entries.set(key, entry)
    const oldest = entries.keys().next()
    if (entries.size > opts.maxEntries && !oldest.done) entries.delete(oldest.value)
  }

  return {
    async get(key, load, getOpts = {}) {
      const stored = entries.get(key)
      const age = stored ? now() - stored.fetchedAt : Infinity
      const ttl = stored && opts.ttlOf ? opts.ttlOf(stored.value) : opts.ttlMs
      if (stored && age < (getOpts.fresh ? minFreshMs : ttl)) return stored
      const pending = inflight.get(key)
      if (pending) return pending
      const loading = load().then((value) => {
        const entry = { value, fetchedAt: now() }
        keep(key, entry)
        return entry
      })
      inflight.set(key, loading)
      try {
        return await loading
      } finally {
        inflight.delete(key)
      }
    },
  }
}
