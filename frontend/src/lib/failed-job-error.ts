/**
 * A failed job's sentence travels with the provider's own words about it.
 *
 * A poll that ends because its job failed rejects with an error. Whoever catches that error may
 * write the failure onto a node: the list fan-out's summary, a component or a sub-workflow node,
 * a scrape card. An error that carried the sentence only would leave that node without the
 * provider's words, so every such rejection is built here, and every such write reads the words
 * back with `caughtErrorWords`.
 *
 * No imports, on purpose: the polls on both sides of the engine's import cycle use it.
 */

/** What a failed job says about its failure beyond the sentence (the lean job read has both). */
export interface FailedJobFacts {
  readonly error_hint?: unknown
  readonly error_detail?: string | null
}

/** The error a poll ends with when its job failed: the sentence, with the job's hint and words on it. */
export function failedJobError(message: string, job: FailedJobFacts): Error {
  return Object.assign(
    new Error(message),
    job.error_hint ? { errorHint: job.error_hint } : {},
    job.error_detail ? { errorDetail: job.error_detail } : {},
  )
}

/**
 * The provider's words a caught error carries, as a node-data patch: the key only when the error
 * has words. Left out otherwise, so the one merge (`mergeNodeData`) decides what an earlier
 * failure's words do.
 */
export function caughtErrorWords(err: unknown): { errorDetail?: string } {
  const words = (err as { errorDetail?: unknown } | null | undefined)?.errorDetail
  return typeof words === "string" && words !== "" ? { errorDetail: words } : {}
}
