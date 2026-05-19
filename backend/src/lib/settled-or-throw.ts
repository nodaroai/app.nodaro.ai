import { settledWithLimit } from "./settled-with-limit.js"

/**
 * Bounded-concurrency Promise.all that rethrows the first non-cancellation
 * rejection.
 *
 * Wraps `settledWithLimit` in failFast mode and unwraps the result array.
 * When any task rejects, finds the first rejection whose reason is NOT the
 * synthetic `"Execution cancelled"` marker that `settledWithLimit` inserts
 * for tasks it skipped after the first real rejection — that real rejection
 * is rethrown. Without this preference, a caller would see a misleading
 * "Execution cancelled" stacktrace instead of the actual failure (e.g.
 * "ffprobe failed: invalid moov atom").
 *
 * Used wherever a step is paid-for AND must be atomic — `pipeline-final-merge`
 * downloads + ffprobes every clip up front, then runs FFmpeg; either both
 * succeed or the whole step fails with a meaningful reason.
 */
export async function settledOrThrow<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const cancelRef = { cancelled: false }
  // failFast=true so a rejection cancels remaining un-started tasks.
  const results = await settledWithLimit(
    tasks as (() => Promise<T>)[],
    concurrency,
    cancelRef,
    true,
  )
  // Prefer the first REAL rejection over any synthetic
  // `"Execution cancelled"` markers that `settledWithLimit` writes for tasks
  // it skipped after the first real failure. Without this preference, a
  // race between the real failure landing in results[i] and a cancel-marker
  // landing in results[j<i] could cause the synthetic marker to win.
  const realRejection = results.find(
    (r) =>
      r.status === "rejected" &&
      !(r.reason instanceof Error && r.reason.message === "Execution cancelled"),
  )
  if (realRejection && realRejection.status === "rejected") {
    throw realRejection.reason instanceof Error
      ? realRejection.reason
      : new Error(String(realRejection.reason))
  }
  // If only cancellations remain (rare — failFast skips remaining tasks
  // after the first real failure, so the real failure should always win
  // above — but keep this as a defensive net), surface the first one.
  const anyRejection = results.find((r) => r.status === "rejected")
  if (anyRejection && anyRejection.status === "rejected") {
    throw anyRejection.reason instanceof Error
      ? anyRejection.reason
      : new Error(String(anyRejection.reason))
  }
  return results.map((r) => {
    if (r.status !== "fulfilled") throw new Error("unreachable")
    return r.value
  })
}
