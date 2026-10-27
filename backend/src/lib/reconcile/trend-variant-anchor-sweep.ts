/**
 * Reconcile: a trend person mask's own job (`trend-face-mask-variant`,
 * ee/routes/admin-trends-face-mask-variants.ts) left `processing` with nobody
 * advancing it. The job is an anchor an admin route writes and never queues:
 * its steps (a mask erase as its child, then a fill) are asked for by the
 * trend editor's advance, which only runs while an admin has the trend open.
 * So "old" is not "stuck": an admin may come back hours later and every paid
 * step must still count. Each advance touches the anchor's `started_at`
 * (`touchTrendVariantAnchor`), and this sweep only closes one idle for
 * `TREND_VARIANT_ANCHOR_IDLE_MS` (a day) whose child erase is not still
 * running. No credits of its own (its children bill themselves), so failing
 * it refunds nothing; the editor then shows it failed, to be made again.
 * Runs inside reconcileInflightJobs (every 5 minutes, every edition).
 */
import { supabase } from "../supabase.js"
import { markJobFailed } from "../job-failure.js"
import type { ReconcileResult } from "./cron.js"

/** A person mask's own job type (`input_data.type`). */
export const TREND_VARIANT_ANCHOR_TYPE = "trend-face-mask-variant"
/** An anchor nobody advanced for this long is closed. */
export const TREND_VARIANT_ANCHOR_IDLE_MS = 24 * 60 * 60_000
export const TREND_VARIANT_ANCHOR_IDLE_MESSAGE = "Nobody advanced this person mask for a day: make the person masks again."
const BATCH_LIMIT = 200

/**
 * Mark the anchor `jobId` as advanced now (its `started_at`, the idle clock
 * this sweep reads), while it is still `processing`. Best effort: a failed
 * touch only shortens the time to the sweep.
 */
export async function touchTrendVariantAnchor(jobId: string): Promise<void> {
  const { error } = await supabase.from("jobs").update({ started_at: new Date().toISOString() }).eq("id", jobId).eq("status", "processing")
  if (error) console.warn(`[reconcile/trend-variant] could not touch ${jobId}: ${error.message}`)
}

export async function sweepIdleTrendVariantAnchors(result: ReconcileResult): Promise<void> {
  const cutoff = new Date(Date.now() - TREND_VARIANT_ANCHOR_IDLE_MS).toISOString()
  const { data, error } = await supabase
    .from("jobs")
    .select("id, user_id")
    .eq("status", "processing")
    .eq("input_data->>type", TREND_VARIANT_ANCHOR_TYPE)
    .lt("started_at", cutoff)
    .limit(BATCH_LIMIT)
  if (error) {
    console.error(`[reconcile/trend-variant] query failed:`, error.message)
    result.errors++
    return
  }
  for (const row of (data ?? []) as Array<{ id: string; user_id: string }>) {
    result.scanned++
    try {
      // Its child erase still running: not idle, whatever the clock says. A child is always its
      // parent's owner's (migration 480's trigger); asked so, as every pointer read is.
      const { data: running, error: childError } = await supabase
        .from("jobs")
        .select("id")
        .eq("parent_job_id", row.id)
        .eq("user_id", row.user_id)
        .in("status", ["pending", "processing"])
        .limit(1)
      if (childError) throw new Error(childError.message)
      if ((running ?? []).length > 0) {
        result.notStale++
        continue
      }
      if (await markJobFailed(row.id, { error_message: TREND_VARIANT_ANCHOR_IDLE_MESSAGE, from: ["processing"] })) result.swept++
    } catch (err) {
      console.error(`[reconcile/trend-variant] sweep failed for job ${row.id}:`, err)
      result.errors++
    }
  }
}
