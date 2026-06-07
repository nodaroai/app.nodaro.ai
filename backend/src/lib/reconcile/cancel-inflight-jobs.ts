import { supabase } from "../supabase.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"

/**
 * Cancel + refund every still-in-flight (pending/processing) child job of an
 * execution. Called by the orchestrator at the start of a (re-)pick, AFTER
 * reconcileNodeStatesFromJobs + carry-forward have decided which nodes are done.
 *
 * Why this exists (the double-charge bug):
 *   When the orchestrator process dies mid-node-flight and BullMQ re-picks the
 *   stalled execution, a node whose child job was still pending/processing is
 *   intentionally NOT carried forward — it re-executes, creating a NEW job + a
 *   NEW credit reservation. The prior attempt's in-flight job, left untouched,
 *   is later recovered by the reconcile cron and COMMITTED — double-charging the
 *   user and double-spending at the provider.
 *
 *   Cancelling it here (CAS pending/processing → cancelled) closes that:
 *     - the reconcile cron only sweeps pending/processing rows, so it skips it;
 *     - finalizeJobWithMedia / the worker call markJobCompleted, whose CAS
 *       (.neq cancelled) returns false → they return BEFORE commitJobCredits;
 *     - refundReservedCreditsForJob reclaims the reservation (idempotent — a
 *       no-op if the row was already committed in the race below).
 *   The re-run then charges exactly once.
 *
 * CRITICAL — we also STRIP `input_data.node_id` from each superseded job:
 *   reconcileNodeStatesFromJobs' Path-2 maps a `cancelled` job back to its node
 *   via `input_data.node_id` and marks that node "skipped". Without stripping it,
 *   a superseded job would be mapped onto the node that is RE-RUNNING right now —
 *   wrongly marking it "skipped" and letting the periodic workflow-executions
 *   cron prematurely flip the whole execution to "completed" while the re-run is
 *   still in flight. Nulling node_id (keeping `superseded_node_id` for tracing)
 *   makes Path-2 ignore these rows (`if (!nodeId) continue`).
 *
 * Ordering invariant: MUST run AFTER reconcileNodeStatesFromJobs + carry-forward.
 * Cancelling BEFORE reconcile would make reconcile map these jobs to "skipped"
 * and carry their nodes forward as done — leaving them un-executed.
 *
 * Residual races (both narrow, both strictly better than the prior multi-minute
 * crash→cron window):
 *   1. A job that commits in the sub-ms window between the SELECT and the CAS
 *      below re-runs AND committed (one extra charge).
 *   2. If a *live* prior instance is still polling this job (BullMQ lock lapse
 *      while alive — rare), cancelling it makes that instance's poll throw and
 *      mark the execution failed. No double-charge (CAS prevents it), but a
 *      mis-reported status. A fully race-free fix needs execution-level fencing.
 *
 * No-op on a first pick (no child jobs exist yet).
 */
export async function cancelInFlightChildJobs(executionId: string): Promise<number> {
  const { data: inFlight, error: selErr } = await supabase
    .from("jobs")
    .select("id, input_data")
    .eq("workflow_execution_id", executionId)
    .in("status", ["pending", "processing"])

  if (selErr) {
    console.error(
      `[orchestrator/resume] failed to query in-flight jobs for ${executionId}:`,
      selErr.message,
    )
    return 0
  }
  if (!inFlight || inFlight.length === 0) return 0

  let cancelled = 0
  for (const row of inFlight) {
    const id = row.id as string
    const prevInput = (row.input_data as Record<string, unknown> | null) ?? {}
    const { node_id: prevNodeId, ...restInput } = prevInput
    const { data: upd, error: updErr } = await supabase
      .from("jobs")
      .update({
        status: "cancelled",
        error_message: "Superseded by orchestrator resume (stale in-flight attempt)",
        completed_at: new Date().toISOString(),
        // node_id stripped (see docstring); keep the original for traceability.
        input_data: { ...restInput, superseded_node_id: prevNodeId ?? null },
      })
      .eq("id", id)
      .in("status", ["pending", "processing"]) // CAS — don't trample a row that just finished
      .select("id")

    if (updErr || !upd || upd.length === 0) continue
    cancelled++
    await refundReservedCreditsForJob(id).catch(() => {})
  }

  if (cancelled > 0) {
    console.log(
      `[orchestrator/resume] cancelled + refunded ${cancelled} stale in-flight job(s) for execution ${executionId}`,
    )
  }
  return cancelled
}
