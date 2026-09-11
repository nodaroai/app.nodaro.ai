/**
 * The `jobs`-row reads and writes the async structured-draft route needs
 * AFTER `insertJob` — the analysis child's stamp, the undo of a parent that
 * never started — and the ONE read it needs BEFORE it: the caller's own
 * finished analysis, when a run drafts from one instead of buying one.
 *
 * They live here rather than in `routes/llm-structured-jobs.ts` because the
 * route would otherwise have to import the service-role client, which
 * `scripts/check-admin-client-import.mjs` bans for new routes: a route holding
 * that client has no RLS backstop, so every ownership check must be
 * in-handler and a missed one is an IDOR. This route needs no service-role
 * reach at all — every write below is the caller's own parent row, and the
 * one read is pinned to the caller too.
 *
 * Which is the invariant this file keeps: every query is pinned with
 * `.eq("id", jobId).eq("user_id", userId)`, so an id that is not the caller's
 * touches — and reveals — nothing.
 */
import { supabase } from "./supabase.js"
import { refundReservedCreditsForJob } from "./credits-job-lifecycle.js"

/** What the parent row records about its analysis child. */
export interface AnalysisChildStamp {
  readonly analysisJobId: string
  /** The child's own price (its `credits`), when THIS run bought it — so a
   *  run list can show the whole cost from the first read, not only once the
   *  worker completes. Absent for a reused analysis: it was paid for by the
   *  run that made it. */
  readonly analysisCredits?: number | null
  /** The child was a FINISHED analysis the caller handed in, not one this
   *  route created — nothing to wait on, nothing more to pay. */
  readonly reused?: boolean
}

/**
 * Record the `video-analysis` child on its parent. The id joins the stored
 * input projection (the caller's own `analysisJobId` on the row) and
 * `output_data` opens at the stage the worker will find it in: `analyzing`
 * for a child that is still running, whose progress the worker then mirrors;
 * `drafting` for a reused one, which has nothing left to analyze. The child's
 * price rides BOTH halves — `input_data` survives every `output_data` rewrite
 * (the worker's own stage write, a failure's error), so a failed or still-
 * running row still says what its analysis cost. The projection is passed in,
 * not re-derived, so the row the insert wrote and the stamp that follows
 * cannot drift.
 */
export async function stampAnalysisChild(
  jobId: string,
  userId: string,
  inputData: Record<string, unknown>,
  stamp: AnalysisChildStamp,
): Promise<void> {
  const { analysisJobId, analysisCredits, reused } = stamp
  const credits = typeof analysisCredits === "number" ? { analysisCredits } : {}
  await supabase
    .from("jobs")
    .update({
      input_data: { ...inputData, analysisJobId, ...credits, ...(reused ? { analysisReused: true } : {}) },
      output_data: { stage: reused ? "drafting" : "analyzing", analysisJobId, ...credits },
    })
    .eq("id", jobId)
    .eq("user_id", userId)
}

/** The slice of an analysis child the route reads — to price a fresh one and
 *  to admit a reused one. */
export interface OwnAnalysisChild {
  readonly id: string
  readonly job_type: string | null
  readonly status: string
  readonly output_data: unknown
  readonly credits: number | null
}

/**
 * The caller's OWN analysis job, or `null` — for a row that does not exist
 * AND for one that belongs to someone else, spelled the same on purpose (no
 * ownership oracle: a caller never learns that a foreign id exists). A read
 * failure other than "no rows" throws, so a transient outage is never
 * reported as absence.
 */
export async function readOwnAnalysisChild(
  analysisJobId: string,
  userId: string,
): Promise<OwnAnalysisChild | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, job_type, status, output_data, credits")
    .eq("id", analysisJobId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Failed to read analysis job ${analysisJobId}: ${error.message}`, { cause: error })
  return (data as OwnAnalysisChild | null) ?? null
}

/**
 * Undo a parent whose analysis child was refused: nothing has run. The order
 * is the reserve path's own undo — refund, THEN delete — so a run that never
 * started never shows in a run list, and no `reserved` hold is orphaned
 * behind a deleted row.
 *
 * `ee/` is not imported here; the refund helper reaches it dynamically (core
 * may not import `ee/` statically, and `lib/` is not allowlisted).
 */
export async function discardUnstartedJob(jobId: string, userId: string): Promise<void> {
  await refundReservedCreditsForJob(jobId)
  await supabase.from("jobs").delete().eq("id", jobId).eq("user_id", userId)
}
