/**
 * Stop a use-case wrapper's inner execution: cancel its not-yet-started child
 * jobs (pre-provider holds refunded by that helper) and flip the execution to
 * cancelled; the orchestrator stops at its next level check, and its finally
 * finds the wrapper already final (the cancel that called this flipped it and
 * refunded its fee). The same two writes the component timeout path makes
 * (node-executor.ts executeComponentNode).
 */
import { supabase } from "../supabase.js"
import { cancelInFlightChildJobs } from "../reconcile/cancel-inflight-jobs.js"

export async function cancelUseCaseInnerExecution(innerExecutionId: string, ownerId: string, reason: string): Promise<void> {
  await cancelInFlightChildJobs(innerExecutionId, ownerId)
  const { error } = await supabase
    .from("workflow_executions")
    .update({ status: "cancelled", error_message: reason, completed_at: new Date().toISOString() })
    .eq("id", innerExecutionId)
    .eq("user_id", ownerId)
    .in("status", ["pending", "running", "stopping"])
  if (error) throw new Error(`use-case run ${innerExecutionId} not cancelled: ${error.message}`)
}
