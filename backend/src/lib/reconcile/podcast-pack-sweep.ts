/**
 * Reconcile: a podcast pack still `processing` (lib/use-case/pack-cover.ts).
 * Its route completes it within seconds, once its tools started; one left
 * behind — the process died while starting them, or its completion was not
 * written — is closed here by what became of its tools:
 *
 * - a tool run names it (`input_data._coveredBy`): a tool started, so the
 *   pack keeps its charge — committed (a hold the route already committed is
 *   not moved again) and the pack completed, listing those runs;
 * - none does: nothing ran, so the pack fails and its hold is returned.
 *
 * A pack whose tool runs cannot be READ is left alone (an error, tried again
 * next tick). Runs inside reconcileInflightJobs (every 5 minutes).
 */
import { supabase } from "../supabase.js"
import { markJobFailed } from "../job-failure.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { WRAPPER_COVERED_BY_KEY } from "../covered-step.js"
import { PODCAST_PACK_JOB_TYPE } from "../use-case/pack-job-type.js"
import type { ReconcileResult } from "./cron.js"

/** A pack is looked at once it is this old (its route closes it within seconds of its tools starting). */
export const PODCAST_PACK_SWEEP_GRACE_MS = 30 * 60_000
const BATCH_LIMIT = 200

export async function sweepPodcastPacks(): Promise<ReconcileResult> {
  const result: ReconcileResult = { scanned: 0, swept: 0, recovered: 0, notStale: 0, errors: 0 }
  const cutoff = new Date(Date.now() - PODCAST_PACK_SWEEP_GRACE_MS).toISOString()
  const { data: rows, error } = await supabase
    // trash-read: a pack in the Trash is closed and settled like any other.
    .from("jobs")
    .select("id, user_id, input_data")
    .eq("provider", PODCAST_PACK_JOB_TYPE)
    .eq("status", "processing")
    .lt("started_at", cutoff)
    .limit(BATCH_LIMIT)
  if (error) {
    console.error(`[reconcile/cron] podcast pack query failed:`, error.message)
    result.errors++
    return result
  }
  const { markJobCompleted } = await import("../../workers/shared.js")
  for (const row of rows ?? []) {
    result.scanned++
    const id = row.id as string
    try {
      const { data: runs, error: runsError } = await supabase
        // trash-read: a tool run in the Trash still ran under its pack.
        .from("jobs")
        .select("id, job_type")
        .eq("user_id", row.user_id as string)
        .eq(`input_data->>${WRAPPER_COVERED_BY_KEY}`, id)
        .limit(50)
      if (runsError) {
        console.error(`[reconcile/cron] podcast pack ${id}: its tool runs could not be read:`, runsError.message)
        result.errors++
        continue
      }
      if ((runs ?? []).length === 0) {
        // Nothing ran: the pack fails and its hold is returned.
        if (await markJobFailed(id, { error_message: "No tool of the pack started", from: ["processing"], extra: { idempotency_key: null } })) {
          await refundReservedCreditsForJob(id)
          result.swept++
        }
        continue
      }
      // A tool started: the pack keeps its charge.
      await commitReservedCreditsForJob(id)
      const input = (row.input_data ?? {}) as Record<string, unknown>
      const output = {
        tools: (runs ?? []).map((r) => ({ tool: r.job_type as string, jobId: r.id as string, executionId: null })),
        ...(typeof input.durationSec === "number" ? { durationSec: input.durationSec } : {}),
        ...(typeof input.units === "number" ? { units: input.units } : {}),
      }
      if (await markJobCompleted(id, { output_data: output, completed_at: new Date().toISOString() })) result.swept++
    } catch (err) {
      console.error(`[reconcile/cron] podcast pack ${id}: sweep failed:`, err)
      result.errors++
    }
  }
  return result
}
