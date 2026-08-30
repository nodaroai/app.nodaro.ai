/**
 * Core app execution logic — extracted from app-runner route so the backend
 * orchestrator can call it directly for component nodes without HTTP.
 */

import { supabase } from "../lib/supabase.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import { payloadBillingContext, type BillingContext } from "../lib/billing-context.js"
import { billingPairColumns } from "../lib/insert-job.js"
import type { WorkflowExecutionJob } from "./workflow-engine/types.js"

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ExecuteAppRunParams {
  /** published_apps row ID for the version being run */
  appVersionId: string
  /** The underlying workflow ID */
  workflowId: string
  /** User who is paying / running */
  userId: string
  /** published_apps.id used for the app_runs foreign key (same as appVersionId for current version) */
  appId: string
  /** Presentation-mode input overrides (nodeId -> partial data) */
  inputOverrides?: Record<string, Record<string, unknown>>
  /** Optional subset of node IDs to execute (route-scoped preset mode) */
  nodeIds?: string[]
  /** Current component nesting depth (limit 5) */
  componentDepth?: number
  /** Ancestor component IDs for cycle detection */
  executingComponentIds?: string[]
  /** Mark the created workflow_execution as a component inner execution */
  isComponentExecution?: boolean
  /** Spend-surface flag captured at the originating route (D1 v2). */
  webFreeMode?: boolean
  /**
   * The originating lane's resolved payer (P14), carried verbatim — this
   * function never resolves. A component inner execution inherits the
   * PARENT execution's context this way; absent means personal.
   */
  billingContext?: BillingContext
}

export interface ExecuteAppRunResult {
  executionId: string
  appRunId: string
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Create a workflow_execution + app_run and enqueue the orchestration job.
 *
 * Credit / eligibility checks are NOT included here — callers must verify
 * eligibility before invoking this function.
 */
export async function executeAppRun(
  params: ExecuteAppRunParams,
): Promise<ExecuteAppRunResult> {
  const {
    appVersionId,
    workflowId,
    userId,
    appId,
    inputOverrides,
    nodeIds,
    componentDepth,
    executingComponentIds,
    webFreeMode,
    billingContext,
    isComponentExecution,
  } = params

  // 1. Create workflow_execution record
  const { data: execution, error: execError } = await supabase
    .from("workflow_executions")
    .insert({
      workflow_id: workflowId,
      user_id: userId,
      status: "pending",
      trigger_type: "app_run",
      ...(isComponentExecution ? { is_component_execution: true } : {}),
      // P14/W7: the carried payer's pair rides the row (personal adds nothing).
      ...billingPairColumns(billingContext),
    })
    .select("id")
    .single()

  if (execError || !execution) {
    throw new Error("Failed to create workflow execution")
  }

  // 2. Create app_runs record
  const { data: appRun, error: runError } = await supabase
    .from("app_runs")
    .insert({
      app_id: appId,
      execution_id: execution.id,
      runner_id: userId,
      status: "running",
      input_values: inputOverrides ?? undefined,
    })
    .select("id")
    .single()

  if (runError || !appRun) {
    throw new Error("Failed to create app run")
  }

  // 3. Enqueue orchestration job
  const jobData: WorkflowExecutionJob = {
    executionId: execution.id,
    workflowId,
    userId,
    triggerType: "app_run",
    inputOverrides,
    appVersionId,
    nodeIds,
    componentDepth,
    executingComponentIds,
    webFreeMode,
    billingContext: payloadBillingContext({ userId, billingContext }),
  }

  await orchestrationQueue.add("workflow-execution", jobData, {
    jobId: execution.id,
  })

  return {
    executionId: execution.id,
    appRunId: appRun.id,
  }
}
