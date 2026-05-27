import { supabase } from "../supabase.js"
import type { NodeExecutionState } from "../../services/workflow-engine/types.js"

/**
 * Reconcile a workflow_executions.node_states map against the actual `jobs`
 * table. The orchestrator process may die AFTER a child job reaches a
 * terminal state but BEFORE persisting the matching node_state update.
 * Without reconciliation, the workflow row sits at status='running'
 * indefinitely with stale "running"/"pending" entries in node_states.
 *
 * Shared by:
 *   - boot-time `cleanupStaleExecutions` in `orchestrator-worker.ts`
 *   - periodic `reconcileWorkflowExecutionsCron()` in `workflow-executions-cron.ts`
 *
 * Returns the reconciled states + a `changed` flag so the caller can decide
 * whether to persist the new map.
 *
 * Recovery paths:
 *  1. `node_states[X].jobId` → `jobs.id` lookup. Fast path; only works when
 *     the orchestrator persisted the jobId before dying.
 *  2. `executionId` → `jobs.workflow_execution_id` scan, mapping back via
 *     `jobs.input_data.node_id`. Catches the race where the orchestrator
 *     inserted the job row but died before `onJobCreated` flushed its
 *     `updateExecution()` (fire-and-forget). Without this fallback, the
 *     reconciler can't recover crashes between `INSERT INTO jobs` and the
 *     matching `UPDATE workflow_executions` — the cron eventually marks
 *     the row "orphaned" even though the child job finished successfully.
 *
 * Multi-job-per-node determinism: a single node can legitimately have many
 * jobs (fan-out / list-iteration / retries). We aggregate per-node first,
 * then apply ONE terminal status using a precedence (failed > cancelled >
 * completed) so the final state doesn't depend on Supabase's row order.
 *
 * User-cancellation preservation: jobs with status='cancelled' are mapped to
 * NodeExecutionStatus 'skipped' (not 'failed'), so when the orchestrator
 * dies after marking child jobs cancelled but before writing
 * execution.status='cancelled', the cron won't surface that as a "failed"
 * execution — the caller's allCompleted check treats 'skipped' as benign.
 *
 * Only touches node_states entries whose current status is "running" or
 * "pending". Leaves everything else alone — no false positives on
 * actively-processing jobs.
 */
export async function reconcileNodeStatesFromJobs(
  states: Record<string, NodeExecutionState>,
  executionId?: string,
): Promise<{ next: Record<string, NodeExecutionState>; changed: boolean }> {
  const stillActive = new Set<string>()
  const jobIdToNodeId = new Map<string, string>()
  for (const [nodeId, st] of Object.entries(states)) {
    if (st?.status !== "running" && st?.status !== "pending") continue
    stillActive.add(nodeId)
    if (typeof st.jobId === "string" && st.jobId) jobIdToNodeId.set(st.jobId, nodeId)
    if (Array.isArray(st.jobIds)) {
      for (const jid of st.jobIds) {
        if (typeof jid === "string" && jid) jobIdToNodeId.set(jid, nodeId)
      }
    }
  }
  if (stillActive.size === 0) return { next: states, changed: false }

  // Shallow-copy state map + entries so we don't mutate the caller's input.
  const next: Record<string, NodeExecutionState> = {}
  for (const [nodeId, st] of Object.entries(states)) {
    next[nodeId] = { ...st }
  }
  let changed = false

  // Aggregate per-node terminal evidence across BOTH paths so we apply ONE
  // deterministic transition per node. Without this, two jobs that map to
  // the same node (Path-1 jobIds[] OR Path-2 multi-row) could ping-pong the
  // status based on Supabase row order.
  type Agg = {
    completed?: { jobId: string }
    cancelled?: { jobId: string; error?: string }
    failed?: { jobId: string; error?: string }
  }
  const agg = new Map<string, Agg>()
  const recordJob = (
    nodeId: string,
    jobId: string,
    jobStatus: string,
    errorMessage: unknown,
  ): void => {
    let a = agg.get(nodeId)
    if (!a) {
      a = {}
      agg.set(nodeId, a)
    }
    if (jobStatus === "completed") {
      a.completed ??= { jobId }
    } else if (jobStatus === "failed") {
      const err = typeof errorMessage === "string" && errorMessage ? errorMessage : undefined
      a.failed ??= { jobId, error: err }
    } else if (jobStatus === "cancelled") {
      const err = typeof errorMessage === "string" && errorMessage ? errorMessage : "Job cancelled"
      a.cancelled ??= { jobId, error: err }
    }
    // pending / processing → not terminal; ignore.
  }

  // Path 1: jobId-keyed lookup (fast path when node_states.jobId is present).
  if (jobIdToNodeId.size > 0) {
    const jobIds = Array.from(jobIdToNodeId.keys())
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, status, error_message")
      .in("id", jobIds)
    if (jobs) {
      for (const job of jobs) {
        const nodeId = jobIdToNodeId.get(job.id as string)
        if (!nodeId) continue
        recordJob(nodeId, job.id as string, job.status as string, job.error_message)
      }
    }
  }

  // Path 2: execution-scoped scan via input_data.node_id. Picks up jobs the
  // orchestrator never managed to wire into node_states.jobId (crash between
  // INSERT and the fire-and-forget updateExecution). Project only the
  // node_id we actually need from input_data to avoid pulling multi-KB
  // payloads across the wire.
  if (executionId) {
    const { data: scopedJobs } = await supabase
      .from("jobs")
      .select("id, status, error_message, node_id:input_data->>node_id")
      .eq("workflow_execution_id", executionId)
      .in("status", ["completed", "failed", "cancelled"])
    if (scopedJobs && scopedJobs.length > 0) {
      for (const job of scopedJobs) {
        const nodeId = typeof (job as Record<string, unknown>).node_id === "string"
          ? ((job as Record<string, unknown>).node_id as string)
          : null
        if (!nodeId) continue
        if (!stillActive.has(nodeId)) continue
        recordJob(nodeId, job.id as string, job.status as string, job.error_message)
      }
    }
  }

  // Apply the aggregated transitions. Precedence: failed > cancelled > completed.
  // Backfill jobId so downstream tools (e.g. reopenWorkflowExecutionIfSoleCause
  // in lib/job-finalize.ts) can trace the recovered node back to its job.
  for (const [nodeId, a] of agg) {
    const nodeSt = next[nodeId]
    if (!nodeSt) continue
    if (a.failed) {
      if (nodeSt.status !== "failed") {
        nodeSt.status = "failed"
        if (a.failed.error) nodeSt.error = a.failed.error
        if (!nodeSt.jobId) nodeSt.jobId = a.failed.jobId
        changed = true
      }
    } else if (a.cancelled) {
      // Map cancelled child jobs to "skipped" — preserves user cancellation
      // semantics. `allCompleted` in the cron treats 'skipped' as benign,
      // so a deliberate cancel doesn't surface as "failed".
      // `NodeExecutionStatus` lacks a "cancelled" literal; "skipped" is the
      // closest existing terminal that doesn't imply user-visible failure.
      if (nodeSt.status !== "skipped" && nodeSt.status !== "completed") {
        nodeSt.status = "skipped"
        if (a.cancelled.error) nodeSt.error = a.cancelled.error
        if (!nodeSt.jobId) nodeSt.jobId = a.cancelled.jobId
        changed = true
      }
    } else if (a.completed) {
      if (nodeSt.status !== "completed") {
        nodeSt.status = "completed"
        if (!nodeSt.jobId) nodeSt.jobId = a.completed.jobId
        changed = true
      }
    }
  }

  return { next, changed }
}
