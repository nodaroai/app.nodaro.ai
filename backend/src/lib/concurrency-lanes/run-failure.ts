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
export async function failWaitingExecution(
  executionId: string,
  errorMessage: string,
  /** More columns for the same write (a route that could not queue the run releases its `idempotency_key`). */
  extra: Readonly<Record<string, unknown>> = {},
): Promise<boolean> {
  return (await failWaitingExecutionDetailed(executionId, errorMessage, extra)).failed
}

/** What {@link failWaitingExecutionDetailed} answers. */
export interface WaitingExecutionFailure {
  /** True when this call failed the run. */
  readonly failed: boolean
  /**
   * How many times the failure write was sent. More than one means an earlier
   * write errored, and an errored write may have landed with only its answer
   * lost: a `failed: false` after it does not prove the run moved on. After a
   * single write, `failed: false` does: nothing of this call's landed.
   */
  readonly attempts: number
}

/**
 * {@link failWaitingExecution}, also answering how many times its write was
 * sent, for a caller that must tell a run that moved on from a write of its
 * own that landed with its answer lost (lib/enqueue-execution.ts). Throws as
 * `failWaitingExecution` does.
 */
export async function failWaitingExecutionDetailed(
  executionId: string,
  errorMessage: string,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<WaitingExecutionFailure> {
  const result = await updateExecutionWithRetry(
    executionId,
    { ...extra, status: "failed", error_message: errorMessage, completed_at: new Date().toISOString() },
    { fromStatuses: ["pending"] },
  )
  if (!result.ok) return { failed: false, attempts: result.attempts }
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
  return { failed: true, attempts: result.attempts }
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
