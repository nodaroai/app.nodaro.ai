import { markJobFailed } from "../job-failure.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { settleSweptMeteredLlmJob } from "../llm-billing.js"

export interface StuckJobRow {
  id: string
  provider_kind: string | null
  reconcile_attempts: number
  /**
   * The row's `reconcile_last_error`: carries the metered sweep's billed marker
   * across ticks. REQUIRED — every scan that sweeps a row reads the column, so
   * a lane that forgot it cannot quietly drop the marker (and refund a job an
   * earlier tick confirmed billed). `null` only when the row has none.
   */
  reconcile_last_error: string | null
}

/**
 * Mark a stale `processing` / `pending` row failed + refund reserved credits.
 * Used for: sync providers whose route handler crashed mid-call, and any job
 * past threshold with `provider_task_id IS NULL` (no upstream task to recover).
 *
 * CAS-guarded by `markJobFailed` on `FAILABLE_STATUSES` so ANY terminal state
 * set by a concurrent writer in the SELECT→UPDATE window is preserved — not
 * just `cancelled`. A bare `.neq("status","cancelled")` would still trample a
 * job that the worker just flipped to `completed` (committing its credits) to
 * `failed`, orphaning its output_data. The same guard is now what keeps this
 * sweep — the 30-minute "no provider task" one, the sweep that would otherwise
 * kill a held job — off a `pending_review` row (spec D11). If 0 rows are
 * updated, skip the refund (`refundReservedCreditsForJob` is idempotent via its
 * own CAS on `usage_logs.status='reserved'`, but the early skip avoids a
 * needless DB roundtrip).
 */
export async function sweepStaleSyncJob(job: StuckJobRow): Promise<void> {
  // R59 / R60 / D10: a billed METERED LLM hold is settled — at its actual,
  // from the row's ledger — BEFORE the terminal flip, so a failed commit
  // leaves the job sweepable (attempts bumped) rather than a failed job whose
  // hold nothing ever revisits; a call that started with nothing billed
  // recorded keeps its hold to the D10 cap. Every other job (and every job
  // without credits) goes on exactly as before.
  const metered = await settleSweptMeteredLlmJob(job)
  if (metered === "retry") {
    console.log(`[reconcile/sync-sweep] job ${job.id}: metered settle pending — kept sweepable (attempt ${job.reconcile_attempts + 1})`)
    return
  }

  const flipped = await markJobFailed(job.id, {
    error_message: "Reconciliation could not recover this job. Please re-run.",
    reconcile_attempts: job.reconcile_attempts + 1,
    reconcile_last_error: "reconcile_no_recovery",
  })

  if (!flipped) {
    console.log(`[reconcile/sync-sweep] job ${job.id} no longer in sweepable state (cancelled, completed or held)`)
    return
  }

  // A settled job's metered holds are committed already, so this refunds only
  // what is still reserved — for every non-metered job, exactly as before.
  await refundReservedCreditsForJob(job.id)
  console.log(
    `[reconcile/sync-sweep] swept job ${job.id} (kind=${job.provider_kind ?? "null"}, attempts=${job.reconcile_attempts + 1})`,
  )
}
