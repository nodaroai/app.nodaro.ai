/**
 * Cooperative drain signal for worker processes.
 *
 * Why this exists (incident 2026-07-15): Railway deploys stop the old
 * container while provider poll loops are mid-flight. If the process dies
 * with BullMQ jobs still active, their locks stay held by a dead process and
 * the jobs are invisible to stall recovery until `lockDuration` expires —
 * users watched `processing` rows freeze for 15–20 minutes while the
 * provider had long finished.
 *
 * The worker entrypoint calls `beginWorkerDrain()` on SIGTERM/SIGINT, BEFORE
 * `worker.close()`. Provider wait points (the shared poll `sleep` in
 * `providers/kie/client.ts`) then throw `DrainAbortError`, the handler exits
 * fast, the video-worker catch RETHROWS it (never mark-failed, never refund),
 * and BullMQ moves the job back to the queue with its lock released — so the
 * replacement process re-picks it seconds after boot and the stall guard's
 * inline reconcile recovers it immediately.
 *
 * Only worker entrypoints ever set the flag; the API server and cron paths
 * share these modules but never drain, so their behavior is unchanged.
 */

export class DrainAbortError extends Error {
  constructor(message = "worker draining (deploy restart) — provider wait aborted") {
    super(message)
    this.name = "DrainAbortError"
  }
}

let draining = false

/** Idempotent: flip the process-wide drain flag. Called from the worker
 *  entrypoint's SIGTERM handler before `worker.close()`. */
export function beginWorkerDrain(): void {
  draining = true
}

export function isWorkerDraining(): boolean {
  return draining
}

/** Test helper — drain state is process-global, reset between tests. */
export function _resetWorkerDrainForTests(): void {
  draining = false
}
