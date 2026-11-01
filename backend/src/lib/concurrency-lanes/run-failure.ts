// backend/src/lib/concurrency-lanes/run-failure.ts — ending a run that waited
// for its run slot and never started (its queue timeout, or its place in line
// lost with nothing to add it again from), through the run's OWN failure path:
//
//   - a workflow execution: the orchestrator's failure write (the retrying
//     terminal write, here a CAS from `pending` so a worker that admitted it
//     meanwhile wins), its `execution:failed` event for the editor and MCP
//     listeners, and the use-case wrapper it reports to settled (its fee
//     refunded). A component's wrapper is settled by the component route
//     watching the execution, or by its sweep. A waiting execution has
//     reserved nothing itself: its nodes reserve when they run;
//   - a pipeline: ee/pipelines/queue-failure.ts on Cloud (stages, pipeline,
//     SSE, refund). Pipelines run only on Cloud; elsewhere the CAS alone.
//
// Each answers whether this call ended the run; only then does the caller
// count it.
import { hasCredits } from "../config.js"
import { executionEvents } from "../execution-events.js"
import { updateExecutionWithRetry } from "../execution-writes.js"
import { supabase } from "../supabase.js"
import { warnLaneRateLimited } from "./hold.js"

/**
 * Fail a workflow execution still waiting (`pending`) for its run slot. True
 * when this call failed it. Throws when the failure write fails after its
 * retries (the row stays waiting; the next sweep tries again).
 */
export async function failWaitingExecution(executionId: string, errorMessage: string): Promise<boolean> {
  const result = await updateExecutionWithRetry(
    executionId,
    { status: "failed", error_message: errorMessage, completed_at: new Date().toISOString() },
    { fromStatuses: ["pending"] },
  )
  if (!result.ok) return false
  try {
    executionEvents.emit(executionId, { type: "execution:failed", executionId, nodeStates: {}, errorMessage })
  } catch {
    // Never let event emission break a failure path (the orchestrator's rule).
  }
  try {
    // A use-case node's hidden run reports to its wrapper job (and refunds its fee). Does nothing for any other run.
    const { finalizeUseCaseWrapper } = await import("../use-case/finalize-wrapper.js")
    await finalizeUseCaseWrapper(executionId)
  } catch (err) {
    // The use-case wrapper sweep catches a wrapper left open.
    warnLaneRateLimited(`could not settle the use-case wrapper of execution ${executionId}`, err)
  }
  return true
}

/**
 * Fail a pipeline still waiting (`queued`) for its run slot, with its failure
 * reason. True when this call failed it. Throws when its own write fails.
 */
export async function failWaitingPipeline(pipelineId: string, userId: string | null, reason: "queue_timeout" | "queue_lost"): Promise<boolean> {
  if (hasCredits()) {
    const { failWaitingPipeline: failOnCloud } = await import("../../ee/pipelines/queue-failure.js")
    return failOnCloud({ supabase, pipelineId, userId, reason })
  }
  const { data, error } = (await supabase
    .from("pipelines")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", pipelineId)
    .eq("status", "queued")
    .select("id")) ?? {}
  if (error) throw new Error(`could not fail waiting pipeline ${pipelineId}: ${error.message ?? error.code}`)
  return Array.isArray(data) && data.length > 0
}
