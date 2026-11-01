/**
 * A counting limiter shared by every node call of one workflow run: at most
 * `width` calls run at once, the rest start in arrival order as calls finish.
 *
 * Used only while concurrency lanes are enforced, where a run dispatches up to
 * `ORCHESTRATOR_DISPATCH_WIDTH` and a list fan-out inside a level must share
 * that one width instead of nesting a second limiter under it (width²). Only
 * LEAF calls take a slot — a fan-out node's own task never does, so a level
 * full of fan-outs cannot hold every slot while its items wait for one.
 */
export interface DispatchSlots {
  run<T>(fn: () => Promise<T>): Promise<T>
}

export function dispatchSlots(width: number): DispatchSlots {
  if (!Number.isInteger(width) || width < 1) throw new Error(`dispatchSlots: width must be a positive integer, got ${width}`)
  let running = 0
  const queue: Array<() => void> = []

  const release = () => {
    const next = queue.shift()
    // Hand the slot straight to the next waiter: the count stays as it is.
    if (next) next()
    else running--
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (running < width) running++
      else await new Promise<void>((resolve) => queue.push(resolve))
      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}
