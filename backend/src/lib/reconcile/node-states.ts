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
 * Only touches node_states entries whose current status is "running" or
 * "pending" AND whose jobId(s) point to a terminal job in DB. Leaves
 * everything else alone — no false positives on actively-processing jobs.
 */
export async function reconcileNodeStatesFromJobs(
  states: Record<string, NodeExecutionState>,
): Promise<{ next: Record<string, NodeExecutionState>; changed: boolean }> {
  const jobIdToNodeId = new Map<string, string>()
  for (const [nodeId, st] of Object.entries(states)) {
    if (st?.status !== "running" && st?.status !== "pending") continue
    if (typeof st.jobId === "string" && st.jobId) jobIdToNodeId.set(st.jobId, nodeId)
    if (Array.isArray(st.jobIds)) {
      for (const jid of st.jobIds) {
        if (typeof jid === "string" && jid) jobIdToNodeId.set(jid, nodeId)
      }
    }
  }
  if (jobIdToNodeId.size === 0) return { next: states, changed: false }

  // Single batched query — cheaper than N round-trips. Index on jobs.id (PK)
  // makes the IN-list scan trivial.
  const jobIds = Array.from(jobIdToNodeId.keys())
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, status, error_message")
    .in("id", jobIds)
  if (!jobs || jobs.length === 0) return { next: states, changed: false }

  // Shallow-copy state map + entries so we don't mutate the caller's input.
  const next: Record<string, NodeExecutionState> = {}
  for (const [nodeId, st] of Object.entries(states)) {
    next[nodeId] = { ...st }
  }
  let changed = false

  for (const job of jobs) {
    const nodeId = jobIdToNodeId.get(job.id as string)
    if (!nodeId) continue
    const nodeSt = next[nodeId]
    if (!nodeSt) continue
    const jobStatus = job.status as string
    if (jobStatus === "completed" && nodeSt.status !== "completed") {
      nodeSt.status = "completed"
      changed = true
    } else if ((jobStatus === "failed" || jobStatus === "cancelled") && nodeSt.status !== "failed") {
      // `NodeExecutionStatus` has no "cancelled" — the orchestrator collapses
      // a cancelled child job into a failed node-state with the cancellation
      // reason as the error message. Mirror that here.
      nodeSt.status = "failed"
      const errMsg = job.error_message
      if (typeof errMsg === "string" && errMsg) nodeSt.error = errMsg
      else if (jobStatus === "cancelled") nodeSt.error = "Job cancelled"
      changed = true
    }
    // pending / processing → leave node_state alone; the orchestrator may
    // still pick this up via BullMQ retry. Marking it terminal here would
    // create a race against in-flight work.
  }

  return { next, changed }
}
