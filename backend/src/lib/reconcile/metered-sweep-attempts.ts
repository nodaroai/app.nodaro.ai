import { supabase } from "../supabase.js"
import { FAILABLE_STATUSES } from "../job-failure.js"

/**
 * After this many sync-sweep attempts on a stale METERED LLM job, the sweep
 * stops retrying (D10): a billed metered hold whose metered commit still has
 * no receipt is charged through the plain commit, and a job whose metered or
 * billed state could never be confirmed (a read that keeps failing) falls
 * back to today's fail + refund.
 */
export const METERED_SWEEP_MAX_ATTEMPTS = 5

/**
 * The `reconcile_last_error` prefix that REMEMBERS, across sweep ticks, that a
 * job was confirmed to hold a BILLED metered LLM reservation. Once written, a
 * later tick whose reads fail never falls back to a refund at the cap (D10 or
 * stay sweepable): an earlier confirmation is never forgotten.
 */
export const METERED_BILLED_MARKER = "metered_settle_retry:billed: "

const METERED_RETRY_MARKER = "metered_settle_retry: "

/** The `reconcile_last_error` a metered sweep retry writes. */
export function meteredSweepMarker(why: string, billed: boolean): string {
  return `${billed ? METERED_BILLED_MARKER : METERED_RETRY_MARKER}${why}`.slice(0, 500)
}

/** Did an earlier sweep tick confirm this job metered + billed? */
export function meteredBilledConfirmed(reconcileLastError: string | null | undefined): boolean {
  return typeof reconcileLastError === "string" && reconcileLastError.startsWith(METERED_BILLED_MARKER)
}

/**
 * Bump a sweepable job's `reconcile_attempts` (CAS on `FAILABLE_STATUSES`, so
 * a job another writer finished is left alone — or on `statuses` when the
 * caller sweeps another state: the cancelled-hold sweep passes `cancelled`,
 * R38, without which its counter would never reach the cap) — what makes every retry
 * advance toward {@link METERED_SWEEP_MAX_ATTEMPTS}. Core and impl-free, so a
 * caller whose Cloud implementation could not even load can still bump.
 * `billed` writes the {@link METERED_BILLED_MARKER}, which later ticks read.
 * Never throws.
 */
export async function bumpMeteredSweepAttempts(
  jobId: string,
  attempts: number,
  why: string,
  billed = false,
  statuses: readonly string[] = FAILABLE_STATUSES,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("jobs")
      .update({ reconcile_attempts: attempts, reconcile_last_error: meteredSweepMarker(why, billed) })
      .eq("id", jobId)
      .in("status", [...statuses])
    if (error) console.error(`[llm-billing] sweep: could not bump reconcile_attempts on job ${jobId}: ${error.message}`)
  } catch (err) {
    console.error(`[llm-billing] sweep: could not bump reconcile_attempts on job ${jobId}:`, err)
  }
}
