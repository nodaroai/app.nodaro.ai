// backend/src/lib/concurrency-lanes/within-timeout.ts — bound a promise by a
// timer that never outlives it. No imports, so a light module (a status read's
// queue-info.ts) can share it with the gate without loading the gate.

/**
 * `promise`, or a rejection with `onTimeout()` after `ms`. The timer is
 * cleared when either settles and never keeps the process alive; a late
 * rejection of the losing promise is never left unhandled.
 */
export function withinTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  promise.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
