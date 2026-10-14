/**
 * Start the hidden execution under a use-case node (decided 2026-10-13): an
 * ordinary `workflow_executions` row with NO workflow, the built graph as its
 * immutable snapshot, and the wrapper job it reports to. The orchestrator
 * loads the snapshot (`job.data.inlineGraph`) and runs it through every wall
 * a saved workflow passes.
 *
 * Sibling of `executeAppRun`: no `app_runs` row, and never a component run —
 * a component's inner run has no Render final path, and a use-case run's
 * review needs one.
 *
 * Credit and eligibility checks are NOT here — the caller (the use-case
 * route) makes them before calling.
 */
import type { StoredInlineGraph } from "@nodaro/render-rules"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import { payloadBillingContext, type BillingContext } from "../lib/billing-context.js"
import { billingPairColumns } from "../lib/insert-job.js"
import { insertWithIdempotencyKey } from "../lib/idempotent-insert.js"
import {
  inlineExecutionColumns,
  inlineGraphColumnAbsent,
  noteInlineGraphColumnError,
} from "../lib/execution-inline-graph.js"
import { updateExecutionWithRetry } from "../lib/execution-writes.js"
import type { WorkflowExecutionJob } from "./workflow-engine/types.js"

/** The database has no snapshot columns yet: nothing was inserted or enqueued. */
export class InlineGraphUnavailableError extends Error {
  constructor() {
    super("Use-case runs are not available on this database yet")
    this.name = "InlineGraphUnavailableError"
  }
}

export interface ExecuteInlineGraphParams {
  readonly userId: string
  readonly graph: StoredInlineGraph
  readonly wrapperJobId: string
  readonly billingContext?: BillingContext
  readonly componentDepth?: number
  readonly executingComponentIds?: readonly string[]
  readonly reviewerPresent: boolean
  readonly previewStopRule?: boolean
  readonly inputOverrides?: Record<string, Record<string, unknown>>
  readonly nodeIds?: readonly string[]
  readonly continueFromExecutionId?: string
  readonly continueMode?: "from-failed"
  readonly idempotencyKey?: string
  readonly mcpClient?: string | null
  /**
   * The run's spend surface and app-run flag, as the route resolved them for
   * its own balance check and fee hold: the steps of the hidden run reserve
   * under the same rules (the component lane's precedent). Required, so a new
   * caller answers them.
   */
  readonly webFreeMode: boolean
  readonly appRun: boolean
}

export interface ExecuteInlineGraphResult {
  readonly executionId: string
  /** True when `idempotencyKey` matched an existing execution — nothing new was enqueued. */
  readonly deduped: boolean
}

/** The PostgREST error behind a failed insert: `insertWithIdempotencyKey` carries it as `cause`. */
function postgrestErrorOf(err: unknown): { code?: string; message?: string } | null {
  if (!err || typeof err !== "object") return null
  const cause = (err as { cause?: unknown }).cause
  return (cause && typeof cause === "object" ? cause : err) as { code?: string; message?: string }
}

export async function executeInlineGraph(p: ExecuteInlineGraphParams): Promise<ExecuteInlineGraphResult> {
  if (inlineGraphColumnAbsent()) throw new InlineGraphUnavailableError()

  let result: { row: { id: string }; created: boolean }
  try {
    result = await insertWithIdempotencyKey<{ id: string }>(
      "workflow_executions",
      {
        workflow_id: null,
        user_id: p.userId,
        status: "pending",
        trigger_type: "use_case",
        ...inlineExecutionColumns(p.graph, p.wrapperJobId),
        ...(p.mcpClient ? { mcp_client: p.mcpClient } : {}),
        // The carried payer's pair rides the row (personal adds nothing).
        ...billingPairColumns(p.billingContext),
      },
      p.idempotencyKey,
      "id",
    )
  } catch (err) {
    if (noteInlineGraphColumnError(postgrestErrorOf(err))) throw new InlineGraphUnavailableError()
    throw err
  }
  // A retry of the same run: it already exists and was enqueued by the first call.
  if (!result.created) return { executionId: result.row.id, deduped: true }

  const jobData: WorkflowExecutionJob = {
    executionId: result.row.id,
    workflowId: null,
    userId: p.userId,
    triggerType: "use_case",
    inlineGraph: true,
    wrapperJobId: p.wrapperJobId,
    ...(p.inputOverrides ? { inputOverrides: p.inputOverrides } : {}),
    ...(p.nodeIds ? { nodeIds: [...p.nodeIds] } : {}),
    ...(p.continueFromExecutionId ? { continueFromExecutionId: p.continueFromExecutionId } : {}),
    ...(p.continueMode ? { continueMode: p.continueMode } : {}),
    componentDepth: p.componentDepth ?? 0,
    executingComponentIds: [...(p.executingComponentIds ?? [])],
    billingContext: payloadBillingContext({ userId: p.userId, billingContext: p.billingContext }),
    reviewerPresent: p.reviewerPresent,
    ...(p.previewStopRule !== undefined ? { previewStopRule: p.previewStopRule } : {}),
    webFreeMode: p.webFreeMode,
    ...(p.appRun ? { appRun: true } : {}),
  }
  try {
    await orchestrationQueue.add("workflow-execution", jobData, { jobId: result.row.id })
  } catch (err) {
    // Never left `pending` with nothing queued: no reaper takes a pending row
    // and the budget reads it as still dispatching. The caller fails the
    // wrapper and refunds its fee on the rethrow.
    await updateExecutionWithRetry(result.row.id, {
      status: "failed",
      error_message: "The run could not be queued",
      completed_at: new Date().toISOString(),
    }).catch((writeErr: unknown) => {
      console.error(`[use-case-execution] execution ${result.row.id} left pending after a failed enqueue: ${(writeErr as Error).message}`)
    })
    throw err
  }
  return { executionId: result.row.id, deduped: false }
}
