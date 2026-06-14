import { supabase } from "../supabase.js"
import { finalizeJobWithMedia, type FinalizeJobType } from "../job-finalize.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { bumpAttemptsOrExhaust } from "./bump-attempts.js"
import { fetchFalRequestStatus, extractFalUrl } from "../../providers/fal/client.js"
import { FAL_LIP_SYNC_CONFIGS } from "../../providers/fal/lip-sync.js"
import type { ReconcileOpts } from "./kie.js"

export interface FalJobRow {
  id: string
  provider_kind: string | null
  provider_task_id: string | null
  reconcile_attempts: number
  job_type: string | null
  /** The user-submitted request config (see `lib/job-input-data.ts`). Read here
   *  to recover the fal `endpoint`: the row stores the fal request_id in
   *  `provider_task_id`, but `fal.queue.status/result` ALSO need the endpoint,
   *  which isn't a column — it's derivable from `input_data.provider`. */
  input_data?: Record<string, unknown> | null
}

/**
 * Resolve the fal `endpoint` for a stored fal job. The job row persists the fal
 * request_id (`provider_task_id`) but the queue API needs the endpoint too, and
 * there's no endpoint column. We recover it from the user-submitted
 * `input_data.provider` (the Nodaro model id, e.g. "sync-lipsync-v3") via the
 * SAME `FAL_LIP_SYNC_CONFIGS` registry the live dispatch used — single source of
 * truth, so a new fal lip-sync model that adds an endpoint there is recoverable
 * here for free.
 *
 * Returns null when no provider/endpoint is recoverable (legacy row, corrupted
 * input_data, or a fal model not in any endpoint registry) — the caller then
 * fails+refunds the row rather than retrying a poll it can never issue.
 *
 * NOTE: fal is currently used ONLY for lip-sync, so `FAL_LIP_SYNC_CONFIGS` is the
 * one registry consulted. When fal gains a second capability (image/video), add
 * its `{ providerId → endpoint }` lookup here so every fal kind stays recoverable.
 */
function resolveFalEndpoint(inputData: Record<string, unknown> | null | undefined): string | null {
  const provider = inputData?.provider
  if (typeof provider !== "string") return null
  const cfg = FAL_LIP_SYNC_CONFIGS[provider]
  return cfg?.endpoint ?? null
}

async function markFailed(jobId: string, reason: string): Promise<void> {
  // CAS on the live (non-terminal) states only — never trample a job the worker
  // concurrently flipped to `completed`. Matches kie.ts / replicate.ts.
  await supabase
    .from("jobs")
    .update({
      status: "failed",
      error_message: reason.slice(0, 500),
      completed_at: new Date().toISOString(),
      reconcile_last_error: "upstream_failed",
    })
    .eq("id", jobId)
    .in("status", ["pending", "processing"])
}

/**
 * Reconcile a stuck fal.ai queue job (`provider_kind="fal-request"`). Mirrors
 * `reconcileReplicateJob`: resolve the fal endpoint from the row, check the
 * queue status ONCE via `fetchFalRequestStatus`, then:
 *   - COMPLETED → finalize with the extracted output URL (output_data written,
 *     credits commit, asset row created, workflow execution reopens if sole-cause).
 *   - ERROR (terminal queue failure, or COMPLETED-but-result-unfetchable) →
 *     markFailed + refund reserved credits.
 *   - pending (IN_QUEUE/IN_PROGRESS, or a transient status-fetch blip) →
 *     bumpAttemptsOrExhaust (re-check next tick; force-fail+refund at MAX_ATTEMPTS).
 *
 * Endpoint-unresolvable (legacy/corrupt input_data) → markFailed + refund: there
 * is no way to re-poll the queue without the endpoint, so we don't loop forever.
 *
 * The terminal/finalize phase is wrapped in try/catch → `bumpAttemptsOrExhaust`
 * (per the Replicate/KIE twins) so a deterministic finalize failure (R2 upload,
 * bad output shape) exhausts to refund+anomaly instead of looping every tick.
 */
export async function reconcileFalJob(row: FalJobRow, opts?: ReconcileOpts): Promise<void> {
  if (!row.provider_task_id) return

  const endpoint = resolveFalEndpoint(row.input_data)
  if (!endpoint) {
    // No endpoint recoverable → the queue can't be re-polled. Fail+refund rather
    // than bump toward a 90-min exhaustion that would never succeed.
    await markFailed(row.id, "fal endpoint unresolvable (missing/unknown input_data.provider)")
    await refundReservedCreditsForJob(row.id)
    return
  }

  const remote = await fetchFalRequestStatus(endpoint, row.provider_task_id)

  if (remote.status === "pending") {
    await bumpAttemptsOrExhaust(row.id, remote.error ?? "fal request still in queue")
    return
  }

  if (remote.status === "ERROR") {
    await markFailed(row.id, remote.error ?? "fal request failed")
    await refundReservedCreditsForJob(row.id)
    return
  }

  // COMPLETED — extract + finalize. B1 guard: a poll-success-but-finalize-failure
  // (R2 upload, unexpected output shape) MUST bump so a deterministic failure
  // exhausts to refund+anomaly instead of looping at every cron tick forever.
  try {
    const url = extractFalUrl(remote.output)
    await finalizeJobWithMedia({
      jobId: row.id,
      jobType: (row.job_type ?? "lip-sync") as FinalizeJobType,
      claimant: opts?.claimant ?? "cron",
      result: {
        url,
        cost: null, // committed at reservation; actual cost is unknown post-reconcile
        providerUsed: "fal",
      },
    })
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err)
  }
}
