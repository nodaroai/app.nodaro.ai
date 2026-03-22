/**
 * Like Promise.allSettled but limits how many tasks run concurrently.
 * Uses a worker-pool pattern so a new task starts as soon as a slot frees up.
 *
 * When `cancelledRef` is provided and becomes truthy, remaining un-started
 * tasks are skipped (already-running tasks continue to completion/rejection).
 *
 * When `failFast` is true (default), the first rejection sets
 * `cancelledRef.cancelled = true` so remaining un-started tasks are skipped.
 */
export async function settledWithLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  cancelledRef?: { cancelled: boolean },
  failFast = true,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      // Skip remaining tasks if execution was cancelled
      if (cancelledRef?.cancelled) {
        const idx = nextIndex++
        results[idx] = { status: "rejected", reason: new Error("Execution cancelled") }
        continue
      }
      const idx = nextIndex++
      try {
        const value = await tasks[idx]()
        results[idx] = { status: "fulfilled", value }
      } catch (reason) {
        results[idx] = { status: "rejected", reason }
        // Fail-fast: signal remaining un-started tasks to skip.
        // Already-running tasks continue to completion — we only prevent
        // NEW tasks from starting to avoid wasting credits after a failure.
        if (failFast && cancelledRef && !cancelledRef.cancelled) {
          cancelledRef.cancelled = true
        }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}
