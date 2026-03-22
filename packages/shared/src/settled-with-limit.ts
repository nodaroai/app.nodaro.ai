/**
 * Like Promise.allSettled but limits how many tasks run concurrently.
 * Uses a worker-pool pattern so a new task starts as soon as a slot frees up.
 * When `cancelledRef` is provided and becomes truthy, remaining un-started
 * tasks are skipped (already-running tasks continue to completion/rejection).
 */
export async function settledWithLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  cancelledRef?: { cancelled: boolean },
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let nextIndex = 0

  const cancelledError = new Error("Execution cancelled")

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      if (cancelledRef?.cancelled) break
      const idx = nextIndex++
      try {
        const value = await tasks[idx]()
        results[idx] = { status: "fulfilled", value }
      } catch (reason) {
        results[idx] = { status: "rejected", reason }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker(),
  )
  await Promise.all(workers)

  // Fill any un-started slots (from cancellation) with a shared rejection
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) results[i] = { status: "rejected", reason: cancelledError }
  }

  return results
}
