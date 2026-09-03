import { markJobFailed } from "../job-failure.js"
import { finalizeJobWithMedia, isFinalizeJobType, NOT_GENERIC_RECOVERABLE } from "../job-finalize.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { redactProviderDetail, logProviderFailure } from "../provider-error-detail.js"
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

/**
 * `reason` is the USER-FACING string (it lands in `jobs.error_message`, which
 * `GET /v1/jobs/:id` and the app-report sweep both read). `detail` is the raw
 * provider text — redacted by the CALLER via `redactProviderDetail` /
 * `providerDetailOf` and written to the admin-only `jobs.error_detail` (W0,
 * migration 368). Never pass raw provider text as `reason`: that is exactly
 * how vendor stack traces and signed URLs reached job owners.
 *
 * Written UNCONDITIONALLY, matching `reconcile/kie.ts:244` — one shape for
 * one column (M-2b). `null` means "this writer had no provider text", and
 * recording that null is the honest answer.
 */
async function markFailed(jobId: string, reason: string, detail: string | null = null): Promise<void> {
  // Log BEFORE the write: this module had no per-job output at all, so a
  // cron-failed job was invisible in Railway (spec §11.3).
  logProviderFailure("reconcile/fal", jobId, reason, detail)
  // The CAS lives in markJobFailed now (FAILABLE_STATUSES): never trample a job
  // a concurrent writer flipped to completed/cancelled, and never take a
  // `pending_review` row — a held job is out of every reconcile sweep's reach
  // by construction (spec D11).
  await markJobFailed(jobId, {
    error_message: reason,
    error_detail: detail,
    reconcile_last_error: "upstream_failed",
  })
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
    await markFailed(
      row.id,
      "Generation could not be recovered. Your credits were refunded.",
      "fal endpoint unresolvable (missing/unknown input_data.provider)",
    )
    await refundReservedCreditsForJob(row.id)
    return
  }

  const remote = await fetchFalRequestStatus(endpoint, row.provider_task_id)

  if (remote.status === "pending") {
    await bumpAttemptsOrExhaust(row.id, remote.error ?? "fal request still in queue")
    return
  }

  if (remote.status === "ERROR") {
    await markFailed(
      row.id,
      "Generation failed on the provider. Please try again.",
      // remote.error is raw provider text — redact it before it reaches
      // error_detail (M-2b); never pass it through as-is.
      redactProviderDetail(remote.error) ?? "fal request failed",
    )
    await refundReservedCreditsForJob(row.id)
    return
  }

  // Types with their own completion writer, and unknown/NULL types, must not
  // reach finalize (same rationale as kie.ts's twin guard, M-4a/M-4b). fal is
  // used only for lip-sync today, so this is a backstop, not a live path.
  if (NOT_GENERIC_RECOVERABLE.has(row.job_type ?? "")) {
    await bumpAttemptsOrExhaust(row.id, `not generically recoverable: ${row.job_type}`)
    return
  }
  if (!isFinalizeJobType(row.job_type)) {
    await bumpAttemptsOrExhaust(row.id, `unknown job_type for finalize: ${row.job_type ?? "null"}`)
    return
  }

  // COMPLETED — extract + finalize. B1 guard: a poll-success-but-finalize-failure
  // (R2 upload, unexpected output shape) MUST bump so a deterministic failure
  // exhausts to refund+anomaly instead of looping at every cron tick forever.
  try {
    const url = extractFalUrl(remote.output)
    await finalizeJobWithMedia({
      jobId: row.id,
      jobType: row.job_type,
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
