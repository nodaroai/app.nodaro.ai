// Beeble allows 10 concurrent jobs GLOBALLY across all users. Cap our in-flight
// startGeneration() calls below that so we never trigger CONCURRENT_LIMIT_EXCEEDED
// storms from the shared 50-slot video worker. Single-process scope (matches the
// single video worker); revisit if the worker is sharded.
const MAX = 8
let active = 0
const waiters: Array<() => void> = []

export async function withSwitchXSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX) await new Promise<void>((r) => waiters.push(r))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}
