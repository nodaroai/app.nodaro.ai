import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Per-job cancellation context for the generation worker.
 *
 * The worker wraps each job's handler in `runWithJobCancellation(jobId, …)`.
 * Provider poll loops (KIE `pollKieTask` / `pollVeoTask`, …) call
 * `throwIfJobCancelled()` on every iteration — if the user cancelled the job
 * (`jobs.status = 'cancelled'`, set by `/v1/jobs/:id/cancel`), it throws
 * `JobCancelledError`, which unwinds the handler so the worker stops polling
 * immediately instead of waiting for the upstream provider to finish.
 *
 * This restores the early-abort behaviour that the original cancel feature
 * (PR "feat(jobs): add cancel functionality") had via `shouldSaveJobResult`,
 * which was dropped when the monolithic video-worker was split into handler
 * modules. The result-overwrite race is still separately guarded by
 * `markJobCompleted`'s `.neq("status","cancelled")` CAS.
 *
 * AsyncLocalStorage propagates across `await` boundaries, so poll loops deep in
 * the provider layer see the context without threading a param through every
 * provider method. Outside a context (e.g. orchestrator path, tests), the
 * checks are no-ops.
 */
interface JobCancelStore {
  readonly jobId: string
  /** Last time we hit the DB for this job's status (throttle). */
  lastCheckMs: number
  /** Sticky once observed cancelled — avoids re-querying after the first hit. */
  cancelled: boolean
  /** Sticky once a graceful stop was observed (`stop_requested_at` stamped). */
  stopRequested?: boolean
}

const storage = new AsyncLocalStorage<JobCancelStore>()

/** One DB status read per job per this window, max — poll loops call the check
 *  every iteration but the provider sleeps 2–10s between polls anyway. */
const CANCEL_CHECK_THROTTLE_MS = 4000

/** Thrown when a job is cancelled mid-poll. The worker catches it and leaves
 *  the row at `status='cancelled'` (no "failed" mark, no double refund). */
export class JobCancelledError extends Error {
  constructor(public readonly jobId: string) {
    super(`Job ${jobId} was cancelled`)
    this.name = "JobCancelledError"
  }
}

/**
 * Thrown when a GRACEFUL STOP was requested (`jobs.stop_requested_at`, set by
 * the gvp stop route via `requestJobStop`) — distinct from cancellation on
 * purpose: the row's status stays `processing`, and the checkpointed handler
 * (generate-video-pro) CATCHES this error to deliver the stitched-so-far
 * prefix as the job's final result with an honest partial settle. It must
 * never reach the worker's generic failure path from a handler that supports
 * stopping; a handler that doesn't support it simply fails+refunds (the flag
 * is only ever stamped on job types whose routes expose a stop endpoint).
 * Cancellation WINS when both flags are set (checked first, both here and in
 * the sticky short-circuit).
 */
export class JobStopRequestedError extends Error {
  constructor(public readonly jobId: string) {
    super(`Job ${jobId} stop requested`)
    this.name = "JobStopRequestedError"
  }
}

/** Run `fn` inside a cancellation context bound to `jobId`. */
export function runWithJobCancellation<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ jobId, lastCheckMs: 0, cancelled: false }, fn)
}

/**
 * Throw `JobCancelledError` if the surrounding job was cancelled. No-op when
 * called outside a `runWithJobCancellation` context. Throttled so a tight poll
 * loop doesn't hammer the DB.
 */
export async function throwIfJobCancelled(): Promise<void> {
  const store = storage.getStore()
  if (!store) return
  if (store.cancelled) throw new JobCancelledError(store.jobId)
  if (store.stopRequested) throw new JobStopRequestedError(store.jobId)

  const now = Date.now()
  if (now - store.lastCheckMs < CANCEL_CHECK_THROTTLE_MS) return
  store.lastCheckMs = now

  // Lazy import so merely importing this module (e.g. from the KIE client) does
  // NOT construct the Supabase client at load time — only the worker, inside an
  // active cancellation context, ever reaches this.
  const { supabase } = await import("./supabase.js")
  const { data } = await supabase
    .from("jobs")
    .select("status,stop_requested_at")
    .eq("id", store.jobId)
    .single()
  if (data?.status === "cancelled") {
    store.cancelled = true
    throw new JobCancelledError(store.jobId)
  }
  // Graceful stop (same throttled read — zero extra queries): only ever
  // stamped by job types whose routes expose a stop endpoint (gvp).
  if ((data as { stop_requested_at?: string | null } | null)?.stop_requested_at) {
    store.stopRequested = true
    throw new JobStopRequestedError(store.jobId)
  }
}
