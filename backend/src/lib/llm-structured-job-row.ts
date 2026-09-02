/**
 * The two `jobs`-row writes the async structured-draft route needs AFTER
 * `insertJob` — the analysis child's stamp and the undo of a parent that
 * never started.
 *
 * They live here rather than in `routes/llm-structured-jobs.ts` because the
 * route would otherwise have to import the service-role client, which
 * `scripts/check-admin-client-import.mjs` bans for new routes: a route holding
 * that client has no RLS backstop, so every ownership check must be
 * in-handler and a missed one is an IDOR. This route needs no service-role
 * reach at all — both writes below are the caller's own parent row.
 *
 * Which is the invariant this file keeps: every write is pinned with
 * `.eq("id", jobId).eq("user_id", userId)`, so an id that is not the caller's
 * touches nothing.
 */
import { supabase } from "./supabase.js"
import { refundReservedCreditsForJob } from "./credits-job-lifecycle.js"

/**
 * Record the `video-analysis` child on its parent. The id joins the stored
 * input projection (the caller's own `analysisJobId` on the row) and
 * `output_data` opens at the `analyzing` stage whose progress the worker then
 * mirrors. The projection is passed in, not re-derived, so the row the insert
 * wrote and the stamp that follows cannot drift.
 */
export async function stampAnalysisChild(
  jobId: string,
  userId: string,
  inputData: Record<string, unknown>,
  analysisJobId: string,
): Promise<void> {
  await supabase
    .from("jobs")
    .update({
      input_data: { ...inputData, analysisJobId },
      output_data: { stage: "analyzing", analysisJobId },
    })
    .eq("id", jobId)
    .eq("user_id", userId)
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
