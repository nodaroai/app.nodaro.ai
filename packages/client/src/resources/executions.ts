import type { NodaroClient } from "../client.js"

export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "stopping"
  | "timed_out"
  | "discarded"

export type ExecutionTriggerType =
  | "manual"
  | "webhook"
  | "schedule"
  | "app_run"
  | "single-node"

/**
 * Per-node state inside an execution's `nodeStates` map. Keys are node IDs.
 *
 * Shape mirrors `services/workflow-engine/types.ts` plus the synthetic
 * single-node-job shape from `routes/workflow-execution.ts`.
 */
export interface NodeExecutionState {
  status: string
  nodeType?: string
  jobId?: string | null
  creditsUsed?: number
  error?: string | null
  startedAt?: string | null
  completedAt?: string | null
  [key: string]: unknown
}

/**
 * Workflow execution record. Returned by `get()` and `cancel()` (the cancel
 * endpoint returns `{ success: true }`, not the execution itself).
 */
export interface WorkflowExecution {
  id: string
  workflowId: string | null
  userId: string
  status: ExecutionStatus
  triggerType: ExecutionTriggerType
  triggerData?: unknown
  nodeStates: Record<string, NodeExecutionState>
  totalNodes: number
  completedNodes: number
  failedNodes: number
  totalCreditsUsed: number
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Summary returned by `listForWorkflow()`. Excludes per-row `triggerData`/`updatedAt`. */
export interface WorkflowExecutionSummary {
  id: string
  status: ExecutionStatus
  triggerType: ExecutionTriggerType
  nodeStates: Record<string, NodeExecutionState>
  totalNodes: number
  completedNodes: number
  failedNodes: number
  totalCreditsUsed: number
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export interface ListExecutionsForWorkflowParams {
  limit?: number
  cursor?: string
  /** Comma-separated list of statuses, e.g. "pending,running". */
  status?: string
  /** "editor" excludes app_run / component / webhook / schedule executions. */
  source?: "editor" | "all"
}

export interface ListExecutionsPage<T> {
  data: T[]
  nextCursor?: string
}

export interface CancelExecutionParams {
  /**
   * "after_current" sets the execution to "stopping" (let in-flight nodes
   * finish, then stop). Default behavior cancels immediately.
   */
  mode?: "after_current" | "discard"
}

export class ExecutionsResource {
  constructor(private client: NodaroClient) {}

  /** Get an execution by ID. Falls back to standalone single-node jobs server-side. */
  get(id: string): Promise<{ data: WorkflowExecution }> {
    return this.client.request(
      "GET",
      `/v1/workflow-executions/${encodeURIComponent(id)}`,
    )
  }

  /** List executions for a workflow. Merges workflow_executions + standalone single-node jobs. */
  listForWorkflow(
    workflowId: string,
    params: ListExecutionsForWorkflowParams = {},
  ): Promise<ListExecutionsPage<WorkflowExecutionSummary>> {
    return this.client.request(
      "GET",
      `/v1/workflows/${encodeURIComponent(workflowId)}/executions`,
      {
        query: {
          limit: params.limit,
          cursor: params.cursor,
          status: params.status,
          source: params.source,
        },
      },
    )
  }

  /** Cancel an execution. Returns `{ success: true }`. */
  cancel(id: string, params: CancelExecutionParams = {}): Promise<{ success: true }> {
    return this.client.request(
      "POST",
      `/v1/workflow-executions/${encodeURIComponent(id)}/cancel`,
      { body: params },
    )
  }
}
