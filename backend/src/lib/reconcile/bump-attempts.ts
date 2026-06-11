import { supabase } from "../supabase.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { MAX_ATTEMPTS } from "./types.js"

/**
 * Bump `jobs.reconcile_attempts` for an inflight job that's still stuck. When
 * the attempt count would meet or exceed `MAX_ATTEMPTS` (18, ≈90min), force-
 * fails the job, refunds reserved credits, and inserts a `reconcile_exhausted`
 * row in `credit_anomalies` for admin review.
 *
 * Replaces the three near-identical `bumpAttempts` copies that lived in
 * `kie.ts` / `replicate.ts` / `elevenlabs.ts` (Phase 3) so the cap + exhaust
 * path is shared. Spec refs: §5.5, §7 edge case "reconcile_attempts ≥ 18".
 *
 * Race-safe: `bumpAttemptsOrExhaust` reads then writes, so two concurrent
 * ticks could both land here. CAS-guard on `.in("status", ["pending",
 * "processing"])` in `forceFailExhausted` ensures only one tick wins the
 * terminal write — the other's UPDATE returns 0 rows and exits without
 * double-refund or double-anomaly.
 */
/**
 * Errors that are DETERMINISTIC for a given provider result — retrying them
 * across reconcile ticks can never succeed, so the job force-fails (+refund)
 * on the FIRST bump instead of zombieing at "processing" for ~90 minutes.
 *
 * Conservative by design (no-false-positive rule): ONLY patterns whose
 * inputs are immutable belong here. `upload-size-exceeded` qualifies — the
 * provider result's byte size never changes (and the image path already
 * tried the WebP recompress fallback before throwing it).
 * `storage-limit-exceeded` does NOT — the user can free quota mid-window.
 */
const DETERMINISTIC_RECONCILE_ERRORS: readonly RegExp[] = [
  /^upload-size-exceeded/,
]

export async function bumpAttemptsOrExhaust(
  jobId: string,
  err: unknown,
): Promise<void> {
  const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)

  const { data } = await supabase
    .from("jobs")
    .select("reconcile_attempts")
    .eq("id", jobId)
    .single()
  const current = ((data as { reconcile_attempts?: number } | null)?.reconcile_attempts ?? 0)
  const next = current + 1

  if (DETERMINISTIC_RECONCILE_ERRORS.some((re) => re.test(msg))) {
    await forceFailExhausted(jobId, msg, next)
    return
  }

  if (next < MAX_ATTEMPTS) {
    await supabase
      .from("jobs")
      .update({
        reconcile_attempts: next,
        reconcile_last_error: msg,
      })
      .eq("id", jobId)
    return
  }

  await forceFailExhausted(jobId, msg, next)
}

async function forceFailExhausted(
  jobId: string,
  lastError: string,
  finalAttempts: number,
): Promise<void> {
  const { data: marked } = await supabase
    .from("jobs")
    .update({
      status: "failed",
      error_message: `reconcile_exhausted: ${lastError}`.slice(0, 500),
      completed_at: new Date().toISOString(),
      reconcile_attempts: finalAttempts,
      reconcile_last_error: "exhausted",
    })
    .eq("id", jobId)
    .in("status", ["pending", "processing"])
    .select("id")

  if (!marked || marked.length === 0) {
    return
  }

  // Audit A5: capture whether the refund actually fired. 0 reserved logs
  // means the hold was already committed (e.g. a partial loop-trim commit on
  // a prior worker attempt) — the user is still charged and the anomaly note
  // must say so instead of claiming a refund happened.
  const refundedLogs = await refundReservedCreditsForJob(jobId)
  await logExhaustedAnomaly(jobId, finalAttempts, refundedLogs > 0).catch((e) =>
    console.error(`[reconcile/exhaust] anomaly log failed for job ${jobId}:`, e),
  )

  console.warn(
    `[reconcile/exhaust] force-failed job ${jobId} after ${finalAttempts} attempts ` +
    `(refunded=${refundedLogs > 0}): ${lastError.slice(0, 120)}`,
  )
}

async function logExhaustedAnomaly(
  jobId: string,
  finalAttempts: number,
  refunded: boolean,
): Promise<void> {
  const { data: job } = await supabase
    .from("jobs")
    .select("user_id, model_identifier, provider, provider_kind, provider_task_id")
    .eq("id", jobId)
    .single()
  const jobRow = job as {
    user_id?: string
    model_identifier?: string
    provider?: string
    provider_kind?: string
    provider_task_id?: string
  } | null
  if (!jobRow?.user_id) return

  const { data: log } = await supabase
    .from("usage_logs")
    .select("id, credits_used")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const logRow = log as { id?: string; credits_used?: number } | null

  const reservedCredits = logRow?.credits_used ?? 0

  await supabase.from("credit_anomalies" as "assets").insert({
    job_id: jobId,
    user_id: jobRow.user_id,
    usage_log_id: logRow?.id ?? null,
    model_identifier: jobRow.model_identifier ?? jobRow.provider_kind ?? "unknown",
    provider: jobRow.provider ?? jobRow.provider_kind ?? null,
    credits_estimated: reservedCredits,
    credits_actual: 0,
    diff: -reservedCredits,
    provider_cost_usd: 0,
    anomaly_type: "reconcile_exhausted",
    status: "pending",
    // A5: provider task id makes the row triage-able without joining jobs;
    // the refund sentence reflects what actually happened.
    admin_notes:
      `Reconcile cron exhausted after ${finalAttempts} attempts ` +
      `(kind=${jobRow.provider_kind ?? "?"}, task=${jobRow.provider_task_id ?? "none"}). Job auto-failed; ` +
      (refunded
        ? "reserved credits refunded."
        : "NO reserved hold remained to refund (likely committed earlier, e.g. partial loop-trim commit) — user may still be charged."),
  } as Record<string, unknown>)
}
