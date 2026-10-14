/**
 * Reconcile: a use-case wrapper still `processing` whose inner run is over
 * (the worker died between the execution's terminal write and the wrapper's
 * finalize, or the run was ended outside the worker — the stale-execution
 * crons, a direct cancel of the inner id). Finalises it; a wrapper whose run
 * never started or no longer exists is failed and its fee refunded.
 *
 * A wrapper whose run cannot be READ is left alone (counted as an error, tried
 * again next tick): only a run positively known to be missing fails one.
 * Runs inside reconcileInflightJobs (every 5 minutes, every edition).
 */
import { supabase } from "../supabase.js"
import { markJobFailed } from "../job-failure.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { finalizeUseCaseWrapper } from "../use-case/finalize-wrapper.js"
import { findExecutionIdForWrapper } from "../execution-inline-graph.js"
import type { ReconcileResult } from "./cron.js"

/** A wrapper is looked at once it is this old (the worker's finally normally finalises within seconds). */
export const USE_CASE_SWEEP_GRACE_MS = 10 * 60_000
const BATCH_LIMIT = 200

async function failOrphan(id: string, message: string): Promise<boolean> {
  // Only a wrapper still `processing` — the state this sweep selected — is ours to fail.
  const flipped = await markJobFailed(id, { error_message: message, from: ["processing"] })
  if (flipped) await refundReservedCreditsForJob(id)
  return flipped
}

export async function sweepUseCaseWrappers(): Promise<ReconcileResult> {
  const result: ReconcileResult = { scanned: 0, swept: 0, recovered: 0, notStale: 0, errors: 0 }
  const cutoff = new Date(Date.now() - USE_CASE_SWEEP_GRACE_MS).toISOString()
  const { data: rows, error } = await supabase
    .from("jobs")
    .select("id, user_id, started_at, input_data")
    .eq("provider", "use-case")
    .eq("status", "processing")
    .lt("started_at", cutoff)
    .limit(BATCH_LIMIT)
  if (error) {
    console.error(`[reconcile/cron] use-case wrapper query failed:`, error.message)
    result.errors++
    return result
  }
  for (const row of rows ?? []) {
    result.scanned++
    const id = row.id as string
    try {
      const stamped = (row.input_data as Record<string, unknown> | null)?._executionId
      // The route stamps the inner id after starting the run; a crash in
      // between leaves the wrapper unstamped, so look the run up by its pointer.
      const executionId = typeof stamped === "string" ? stamped : await findExecutionIdForWrapper(id, row.user_id as string)
      if (typeof executionId !== "string") {
        if (await failOrphan(id, "The run never started")) result.swept++
        continue
      }
      // Settles THIS wrapper only: a run reporting to another wrapper reads
      // as not this one's (and this one is failed as an orphan below).
      const outcome = await finalizeUseCaseWrapper(executionId, id)
      if (outcome === "completed" || outcome === "failed") result.swept++
      else if (outcome === "not_terminal") result.notStale++
      else if (outcome === "not_use_case") {
        if (await failOrphan(id, "The run could not be found")) result.swept++
      }
    } catch (err) {
      result.errors++
      console.warn(`[reconcile/cron] use-case wrapper ${id}:`, err)
    }
  }
  return result
}
