import { supabase } from "../supabase.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"

export interface StuckJobRow {
  id: string
  provider_kind: string | null
  reconcile_attempts: number
}

/**
 * Mark a stale `processing` / `pending` row failed + refund reserved credits.
 * Used for: sync providers whose route handler crashed mid-call, and any job
 * past threshold with `provider_task_id IS NULL` (no upstream task to recover).
 *
 * CAS-guarded on `.in("status", ["pending", "processing"])` so ANY terminal
 * state set by a concurrent writer in the SELECT→UPDATE window is preserved —
 * not just `cancelled`. A bare `.neq("status","cancelled")` would still trample
 * a job that the worker just flipped to `completed` (committing its credits) to
 * `failed`, orphaning its output_data. Mirrors `forceFailExhausted`
 * (bump-attempts.ts). If 0 rows are updated, skip the refund
 * (`refundReservedCreditsForJob` is idempotent via its own CAS on
 * `usage_logs.status='reserved'`, but the early skip avoids a needless DB
 * roundtrip).
 */
export async function sweepStaleSyncJob(job: StuckJobRow): Promise<void> {
  const { data, error } = await supabase
    .from("jobs")
    .update({
      status: "failed",
      error_message: "Reconciliation could not recover this job. Please re-run.",
      completed_at: new Date().toISOString(),
      reconcile_attempts: job.reconcile_attempts + 1,
      reconcile_last_error: "reconcile_no_recovery",
    })
    .eq("id", job.id)
    .in("status", ["pending", "processing"])
    .select("id")

  if (error) {
    console.error(`[reconcile/sync-sweep] failed to update job ${job.id}:`, error.message)
    return
  }

  if (!data || data.length === 0) {
    console.log(`[reconcile/sync-sweep] job ${job.id} no longer in sweepable state (cancelled or completed)`)
    return
  }

  await refundReservedCreditsForJob(job.id)
  console.log(
    `[reconcile/sync-sweep] swept job ${job.id} (kind=${job.provider_kind ?? "null"}, attempts=${job.reconcile_attempts + 1})`,
  )
}
