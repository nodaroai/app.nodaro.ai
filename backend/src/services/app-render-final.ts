/**
 * An app run's Render final (decided 2026-10-04): a CONTINUATION of the run's
 * execution — or of its newest final, when a later render still at Preview is
 * finished (a chain, decided 2026-10-06) — outside the run. It runs the render at Final for that run only,
 * then the nodes after it; every node before the render hands on what the run
 * produced. The app run stays one row — the final is not a run of its own: it
 * does not count toward the daily cap, the app's run count or the history —
 * and it earns no creator markup (markup settles only on the execution
 * `app_runs.execution_id` names). It runs the published version the run ran
 * (`appVersionId`), so it draws on the app allowance as an app run does.
 *
 * The route checks everything first; this creates the execution, links it to
 * the run, and enqueues it. The runner's edits of what the final replaces stay
 * until it ends (the orchestrator settles them: `settleAppRunFinalEdits`).
 */
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import { payloadBillingContext, type BillingContext } from "../lib/billing-context.js"
import { billingPairColumns } from "../lib/insert-job.js"
import { insertWithIdempotencyKey } from "../lib/idempotent-insert.js"
import { appRenderFinalStamp, linkAppRunFinal } from "../lib/app-run-final-column.js"
import type { WorkflowExecutionJob } from "./workflow-engine/types.js"

export interface ExecuteAppRenderFinalParams {
  readonly runId: string
  /** The runner — who pays, and whose run it is. */
  readonly userId: string
  /** The published version the run ran (`app_runs.app_id`). */
  readonly appVersionId: string
  readonly workflowId: string
  /**
   * What the final continues: the run's execution (`app_runs.execution_id`),
   * or — a chain, decided 2026-10-06 — the run's newest final that completed.
   */
  readonly continueFromExecutionId: string
  /** The nodes the final runs (the render's Render final set), computed by the server. */
  readonly nodeIds: readonly string[]
  /** The render at Final, and any review the run's edits hold. */
  readonly inputOverrides: Record<string, Record<string, unknown>>
  /** A person in the app runner is there to review a Preview further on. */
  readonly reviewerPresent: boolean
  readonly webFreeMode?: boolean
  readonly billingContext?: BillingContext
  readonly idempotencyKey?: string
}

export interface ExecuteAppRenderFinalResult {
  readonly executionId: string
  /** False before migration 473 reaches the database: the final runs, but the run cannot find it after a reload. */
  readonly linked: boolean
  /** The idempotency key matched an existing execution — nothing new ran. */
  readonly deduped: boolean
}

export async function executeAppRenderFinal(params: ExecuteAppRenderFinalParams): Promise<ExecuteAppRenderFinalResult> {
  const { row: execution, created } = await insertWithIdempotencyKey<{ id: string }>(
    "workflow_executions",
    {
      workflow_id: params.workflowId,
      user_id: params.userId,
      status: "pending",
      // An app's execution: kept out of the editor's own run list.
      trigger_type: "app_run",
      // The run it finishes, the version, and what it continues: a later
      // final continues from this one, and a run view walks the chain back.
      trigger_data: appRenderFinalStamp({
        appRunId: params.runId,
        appVersionId: params.appVersionId,
        continuedFrom: params.continueFromExecutionId,
      }),
      ...billingPairColumns(params.billingContext),
    },
    params.idempotencyKey,
    "id",
  )
  if (!created) return { executionId: execution.id, linked: true, deduped: true }

  const linked = await linkAppRunFinal(params.runId, params.userId, execution.id)

  const jobData: WorkflowExecutionJob = {
    executionId: execution.id,
    workflowId: params.workflowId,
    userId: params.userId,
    triggerType: "app_run",
    inputOverrides: params.inputOverrides,
    appVersionId: params.appVersionId,
    nodeIds: [...params.nodeIds],
    continueFromExecutionId: params.continueFromExecutionId,
    webFreeMode: params.webFreeMode,
    billingContext: payloadBillingContext({ userId: params.userId, billingContext: params.billingContext }),
    // From the app runner's mark (`appReviewerPresent`): a person in the app
    // runner can press Render final on a Preview further on.
    reviewerPresent: params.reviewerPresent,
  }
  await orchestrationQueue.add("workflow-execution", jobData, { jobId: execution.id })

  return { executionId: execution.id, linked, deduped: false }
}
