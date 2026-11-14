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
import { getRuntimeEnv } from "../lib/runtime-env.js"
import { payloadBillingContext, type BillingContext } from "../lib/billing-context.js"
import { billingPairColumns } from "../lib/insert-job.js"
import { insertWithIdempotencyKey } from "../lib/idempotent-insert.js"
import {
  inlineExecutionColumns,
  inlineGraphColumnAbsent,
  noteInlineGraphColumnError,
} from "../lib/execution-inline-graph.js"
import { enqueueRunOrThrow } from "../lib/enqueue-execution.js"
import { outerRunStamp } from "../lib/use-case-outer-run.js"
import type { WorkflowExecutionJob } from "./workflow-engine/types.js"
import type { ImportVia } from "../lib/content-rights.js"

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
   * The running execution whose use-case node started this run (the internal
   * lane's `PARENT_EXECUTION_HEADER`, lib/concurrency-lanes/parent-execution.ts):
   * carried onto the job, where it means "takes no run slot". Absent = top-level.
   */
  readonly parentExecutionId?: string
  /**
   * The run this inner run works for (lib/use-case-outer-run.ts), stamped on
   * its `trigger_data`: the running run whose node started it (the internal
   * lane's parent, never a caller's), or — a continuation started from
   * outside a run — the link of the run it continues. Its provider words are
   * judged by that run's workflow. Absent: a use-case job run on its own.
   */
  readonly outerRunId?: string
  /**
   * The run's spend surface and app-run flag, as the route resolved them for
   * its own balance check and fee hold: the steps of the hidden run reserve
   * under the same rules (the component lane's precedent). Required, so a new
   * caller answers them.
   */
  readonly webFreeMode: boolean
  readonly appRun: boolean
  /** How the run was started (`lib/import-via.ts`): what its imports of links are held to. */
  readonly importVia?: ImportVia
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
        runtime_env: getRuntimeEnv(),
        // The run it works for, written by the server alone (lib/use-case-outer-run.ts); none on a standalone run.
        ...(p.outerRunId ? { trigger_data: outerRunStamp(p.outerRunId) } : {}),
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
    ...(p.importVia ? { importVia: p.importVia } : {}),
    // Started by a node of a running run: no run slot of its own.
    ...(p.parentExecutionId ? { parentExecutionId: p.parentExecutionId } : {}),
  }
  // Never left `pending` with nothing queued: the never-started sweep takes
  // such a row only after 4 hours (lib/reconcile/never-started-executions.ts),
  // and until then the budget reads it as still dispatching. Failed from
  // `pending` only (a run a worker claimed meanwhile is running: answered as
  // started), its key released, through the run's own failure path, which
  // settles the wrapper it reports to. The caller unwinds a wrapper still
  // `processing` and refunds its fee on the UnqueuedRunError.
  await enqueueRunOrThrow(result.row.id, p.userId, () =>
    orchestrationQueue.add("workflow-execution", jobData, { jobId: result.row.id }),
  )
  return { executionId: result.row.id, deduped: false }
}
