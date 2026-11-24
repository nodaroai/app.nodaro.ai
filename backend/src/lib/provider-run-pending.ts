/**
 * A provider run given up for now with its request id saved on the job: the
 * worker's wait ran out (or its status reads kept failing) while the run may
 * still be going upstream. NOT final, and never a reason to start the run
 * again: on a non-final queue attempt the re-pick goes to the recovery (the row
 * holds the request id); on the final attempt the worker leaves the row for
 * the reconcile cron instead of failing it (workers/video-worker.ts), as it
 * does for a house-model run or an alternate route left pending.
 */
export class ProviderRunPendingError extends Error {
  readonly providerRunPending = true as const
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "ProviderRunPendingError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isProviderRunPending(err: unknown): boolean {
  return err instanceof ProviderRunPendingError || (typeof err === "object" && err !== null && (err as { providerRunPending?: unknown }).providerRunPending === true)
}
