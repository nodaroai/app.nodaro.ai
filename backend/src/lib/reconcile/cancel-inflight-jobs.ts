import { supabase } from "../supabase.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"

/** An in-flight child job a re-picked orchestrator should ADOPT (resume
 *  polling) instead of cancel+re-run — the provider call already went out
 *  and was paid for. Keyed by owning node id (audit A2). */
export interface AdoptableChildJob {
  jobId: string
  usageLogId?: string
  creditsReserved?: number
}

export interface NeutralizeResult {
  cancelled: number
  /** node_id → adoptable in-flight job (provider task already submitted). */
  adoptable: Map<string, AdoptableChildJob>
}

/**
 * Neutralize every still-in-flight (pending/processing) child job of an
 * execution. Called by the orchestrator at the start of a (re-)pick, AFTER
 * reconcileNodeStatesFromJobs + carry-forward have decided which nodes are done.
 *
 * Two classes (audit A2):
 *
 * 1. PRE-provider rows (no `provider_task_id`) — cancel + refund, exactly the
 *    original double-charge fix: without it, the prior attempt's job is later
 *    recovered by the reconcile cron and COMMITTED while the re-run charges
 *    again. Cancelling is free here — no provider work has been paid for.
 *
 * 2. POST-provider rows (`provider_task_id` set, single-shot — no fan-out
 *    `iterationIndex`) — returned as ADOPTABLE instead of cancelled. The
 *    provider is already rendering this exact node's output; cancelling +
 *    re-running paid the provider twice for the same content. The node
 *    executor polls the adopted job to completion (executeWorkerNode), and
 *    the reconcile system owns its terminal outcome if the worker never
 *    finishes it (complete via cron, or exhaust → refund + anomaly), so
 *    adoption can never strand the node: the poll sees a terminal status
 *    either way. Fan-out iterations keep the cancel+refund path — adopting
 *    them would need iteration-index matching against the re-derived fan-out
 *    (completed iterations are already reused via
 *    loadCompletedFanOutIterations; in-flight ones are rare enough to eat).
 *
 * CRITICAL — we still STRIP `input_data.node_id` from each CANCELLED job:
 *   reconcileNodeStatesFromJobs' Path-2 maps a `cancelled` job back to its node
 *   via `input_data.node_id` and marks that node "skipped". Without stripping it,
 *   a superseded job would be mapped onto the node that is RE-RUNNING right now —
 *   wrongly marking it "skipped" and letting the periodic workflow-executions
 *   cron prematurely flip the whole execution to "completed" while the re-run is
 *   still in flight. Nulling node_id (keeping `superseded_node_id` for tracing)
 *   makes Path-2 ignore these rows (`if (!nodeId) continue`). Adopted rows KEEP
 *   their node_id — they are owned by the node that is about to poll them.
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
 *      while alive — rare), the adopted path is now HARMLESS (both instances
 *      poll the same row); for the cancelled class the old mis-reported-status
 *      race remains. A fully race-free fix needs execution-level fencing.
 *
 * No-op on a first pick (no child jobs exist yet).
 */
export async function cancelInFlightChildJobs(executionId: string): Promise<NeutralizeResult> {
  const result: NeutralizeResult = { cancelled: 0, adoptable: new Map() }
  const { data: inFlight, error: selErr } = await supabase
    .from("jobs")
    .select("id, input_data, provider_task_id, usage_log_id, credits")
    .eq("workflow_execution_id", executionId)
    .in("status", ["pending", "processing"])

  if (selErr) {
    console.error(
      `[orchestrator/resume] failed to query in-flight jobs for ${executionId}:`,
      selErr.message,
    )
    return result
  }
  if (!inFlight || inFlight.length === 0) return result

  for (const row of inFlight) {
    const id = row.id as string
    const prevInput = (row.input_data as Record<string, unknown> | null) ?? {}
    const nodeId = typeof prevInput.node_id === "string" ? prevInput.node_id : null

    // Class 2 — adoptable: provider already paid, single-shot node, owning
    // node known. First-wins if multiple rows somehow point at one node.
    if (
      row.provider_task_id &&
      nodeId &&
      prevInput.iterationIndex === undefined &&
      !result.adoptable.has(nodeId)
    ) {
      result.adoptable.set(nodeId, {
        jobId: id,
        usageLogId: typeof row.usage_log_id === "string" ? row.usage_log_id : undefined,
        creditsReserved: typeof row.credits === "number" ? row.credits : undefined,
      })
      continue
    }

    // Class 1 — cancel + refund (pre-provider, fan-out iteration, or orphan).
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
    result.cancelled++
    await refundReservedCreditsForJob(id).catch(() => {})
  }

  if (result.cancelled > 0 || result.adoptable.size > 0) {
    console.log(
      `[orchestrator/resume] execution ${executionId}: cancelled+refunded ${result.cancelled} ` +
      `stale job(s), ${result.adoptable.size} in-flight provider job(s) marked for adoption`,
    )
  }
  return result
}
