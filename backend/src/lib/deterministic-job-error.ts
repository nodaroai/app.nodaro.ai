/**
 * DeterministicJobError — "this job will fail the same way on every attempt".
 *
 * The video worker's queue retries a failed job (`attempts: 3`), and on a
 * non-final attempt it deliberately does NOT fail the row or refund (a
 * successful retry must still be able to commit — see `isFinalJobAttempt`).
 * That is right for transient failures and wrong for a refusal that depends
 * only on the job's own inputs: apply-edl's window check (a segment runs past
 * the end of the media it reads, measured from the downloaded file) fails
 * identically on the retry, after re-downloading and re-probing every source,
 * and the user waits through three attempts for the same message.
 *
 * A handler throws this for such a refusal. The worker treats the attempt as
 * FINAL — fails the row and refunds now, with the handler's message — and then
 * throws BullMQ's `UnrecoverableError` so no further attempt runs (the same
 * path a content-policy block takes).
 *
 * Only for refusals that are a pure function of the job's inputs. Anything
 * that could succeed on a retry (network, provider, storage, a probe that
 * timed out) must NOT use it.
 *
 * Two deliberate exceptions:
 * - A wait for a concurrency slot that ran past the queue timeout
 *   (`LaneWaitTimeoutError`, lib/concurrency-lanes/errors.ts) is a subclass.
 *   A retry would only stand in the same line for the whole timeout again, so
 *   the job is failed and refunded on this attempt.
 * - An extend whose generated extension is too short or has no picture
 *   (`extensionTooShort`, lib/extend-recipe.ts) throws it, although a new
 *   generation might come back longer. It is a product decision: the run is
 *   final on its first attempt so no further paid generations run while the
 *   user's credits are held, and the user can run it again. Do not turn it
 *   back into a retry. A probe of the extension that FAILED is not this case:
 *   it stays a plain, retryable error (`extensionPictureSeconds`).
 *
 * WHY A MARKER PROPERTY (not just `instanceof`): same reason as
 * `PostProcessingError` — a re-thrown or wrapped error can lose its prototype
 * but keep own properties; `isDeterministicJobError` also walks the `cause`
 * chain so a wrapper (`new Error("…", { cause })`) still classifies.
 *
 * No imports by design, so any layer can depend on it without cycles.
 */
export class DeterministicJobError extends Error {
  /** Stable discriminator that survives prototype loss across boundaries. */
  readonly deterministic = true as const

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "DeterministicJobError"
    // `new.target`, not `DeterministicJobError`: pinning the base prototype
    // made every subclass instance fail its own `instanceof`.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** True iff `err`, or anything on its `cause` chain, is a DeterministicJobError. */
export function isDeterministicJobError(err: unknown): boolean {
  let cur: unknown = err
  for (let depth = 0; depth < 8 && typeof cur === "object" && cur !== null; depth++) {
    if (cur instanceof DeterministicJobError) return true
    if ((cur as { deterministic?: unknown }).deterministic === true) return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}
