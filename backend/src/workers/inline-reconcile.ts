/**
 * Inline reconciliation for BullMQ stall-retry.
 *
 * When BullMQ re-picks a job whose `provider_task_id` is already set (the
 * original worker died mid-poll — Railway redeploy, OOM, etc.), the stall-retry
 * guard in `video-worker.ts` calls this dispatcher to recover the row IMMEDIATELY
 * via the same per-provider handler the reconcile cron uses, instead of waiting
 * up to <threshold> + <cron cadence> minutes for the cron.
 *
 * Best-effort: any thrown error is logged but swallowed so the BullMQ job exits
 * "completed" (the cron remains the safety net). Idempotency is guaranteed by
 * the underlying reconcile handlers (CAS-guarded `markJobCompleted` inside
 * `finalizeJobWithMedia`; `bumpAttemptsOrExhaust` is safe to repeat).
 */

/**
 * Field shape matches the reconcile row schemas (id, not jobId) so we can
 * pass through to `reconcileKieJob` / `reconcileReplicateJob` /
 * `reconcileElevenLabsJob` without remapping.
 */
interface InlineReconcileRow {
  id: string
  provider_kind: string | null
  provider_task_id: string
  reconcile_attempts: number
  job_type: string | null
  /** The user-submitted request config. Only the fal path reads it (to recover
   *  the fal endpoint from `input_data.provider`); other handlers ignore it.
   *  Optional so legacy callers / narrow test rows keep working. */
  input_data?: Record<string, unknown> | null
}

// Dispatch sets live in lib/reconcile/types.ts (single source of truth,
// audit M5) — shared with the cron dispatcher and the worker's
// leave-for-reconcile predicate so the three consumers can never drift.
import {
  KIE_RECOVER_KINDS as KIE_KINDS,
  REPLICATE_RECOVER_KINDS as REPLICATE_KINDS,
  ELEVENLABS_RECOVER_KINDS as ELEVENLABS_KINDS,
  FAL_RECOVER_KINDS as FAL_KINDS,
} from "../lib/reconcile/types.js"

export async function tryInlineReconcile(row: InlineReconcileRow): Promise<void> {
  const kind = row.provider_kind
  if (!kind) {
    // No provider_kind on a row with a task_id is a Phase-1 backfill artifact
    // (or a bug); leave the cron to sweep it via sync-sweep.
    console.log(
      `[worker:inline-reconcile] Stall-retry for job ${row.id} (task=${row.provider_task_id}) ` +
      `but provider_kind is null — leaving to reconcile cron`,
    )
    return
  }

  try {
    if (KIE_KINDS.has(kind)) {
      const { reconcileKieJob } = await import("../lib/reconcile/kie.js")
      console.log(
        `[worker:inline-reconcile] Stall-retry recovery for job ${row.id} ` +
        `(kind=${kind}, task=${row.provider_task_id}) — running reconcileKieJob inline`,
      )
      await reconcileKieJob(row, { claimant: "worker" })
      return
    }
    if (REPLICATE_KINDS.has(kind)) {
      const { reconcileReplicateJob } = await import("../lib/reconcile/replicate.js")
      console.log(
        `[worker:inline-reconcile] Stall-retry recovery for job ${row.id} ` +
        `(kind=${kind}, task=${row.provider_task_id}) — running reconcileReplicateJob inline`,
      )
      await reconcileReplicateJob(row, { claimant: "worker" })
      return
    }
    if (ELEVENLABS_KINDS.has(kind)) {
      const { reconcileElevenLabsJob } = await import("../lib/reconcile/elevenlabs.js")
      console.log(
        `[worker:inline-reconcile] Stall-retry recovery for job ${row.id} ` +
        `(kind=${kind}, task=${row.provider_task_id}) — running reconcileElevenLabsJob inline`,
      )
      // ElevenLabs handler accepts a wider row shape (includes input_data) but
      // ignores fields it doesn't read; passing the narrow row is safe.
      await reconcileElevenLabsJob({ ...row, input_data: null }, { claimant: "worker" })
      return
    }
    if (FAL_KINDS.has(kind)) {
      const { reconcileFalJob } = await import("../lib/reconcile/fal.js")
      console.log(
        `[worker:inline-reconcile] Stall-retry recovery for job ${row.id} ` +
        `(kind=${kind}, task=${row.provider_task_id}) — running reconcileFalJob inline`,
      )
      // reconcileFalJob recovers the fal endpoint from input_data.provider, so
      // the row must carry it (the worker's stall-retry SELECT includes input_data).
      await reconcileFalJob({ ...row, input_data: row.input_data ?? null }, { claimant: "worker" })
      return
    }
    // Unknown async kind — leave to the cron's catch-all sync sweep.
    console.log(
      `[worker:inline-reconcile] Stall-retry for job ${row.id} ` +
      `(kind=${kind}, task=${row.provider_task_id}) — unknown async kind, leaving to cron`,
    )
  } catch (err) {
    // Never throw — the BullMQ job should exit successfully so the next
    // attempt isn't retried again. The cron picks up any row we couldn't
    // recover here.
    console.error(
      `[worker:inline-reconcile] Inline reconcile threw for job ${row.id} ` +
      `(kind=${kind}, task=${row.provider_task_id}); reconcile cron will retry:`,
      err instanceof Error ? err.message : err,
    )
  }
}
