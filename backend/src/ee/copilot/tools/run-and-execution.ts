/**
 * `run_workflow` (proposal) and `get_execution`.
 *
 * The copilot never STARTS a run. The browser does, through the editor's own
 * Run path — which keeps the manual trigger type, the existing confirm dialog
 * and estimate, the on-canvas progress and the reload-restore behavior, and
 * makes "auto" a client-side setting the user can bound in credits. This tool
 * therefore records a proposal, emits it to the panel, and ends the model's
 * turn; the run's outcome comes back as the user's next message.
 */
import { supabase } from "../../../lib/supabase.js"
import { classifyFailure } from "../../../lib/mcp/tools/diagnose.js"
import type { CopilotToolContext, RunProposal } from "./types.js"

export interface RunWorkflowArgs {
  /** One line the panel shows on the Run card. */
  note?: string
}

/**
 * NO input overrides. The run route merges an override object straight onto a
 * node's data at execution time (`applyInputOverrides`), which would be a
 * second write path around every `edit_workflow` guard — including the
 * destination lock. The model configures nodes through `edit_workflow`, or
 * not at all.
 */
export function proposeRun(ctx: CopilotToolContext, args: RunWorkflowArgs, addedNodeTypes: string[]): { proposal: RunProposal; message: string } {
  const proposal: RunProposal = {
    addedNodeTypes,
    note: args.note,
  }
  ctx.emit({
    type: "run_proposed",
    data: {
      workflowId: ctx.workflowId,
      addedNodeTypes: proposal.addedNodeTypes,
      note: proposal.note ?? null,
    },
  })
  return {
    proposal,
    message:
      "Run proposed. The user decides whether to start it — summarize what will run and stop; you'll get the outcome in their next message.",
  }
}

export interface GetExecutionArgs {
  execution_id?: string
}

interface NodeState {
  status?: string
  nodeType?: string
  jobId?: string
  error?: string
}

/** Compact per-node status for the latest (or a named) execution of this workflow. */
export async function runGetExecution(ctx: CopilotToolContext, args: GetExecutionArgs): Promise<string> {
  let query = supabase
    .from("workflow_executions")
    .select("id, status, node_states, total_nodes, completed_nodes, failed_nodes, error_message, created_at, completed_at")
    .eq("workflow_id", ctx.workflowId)
    .eq("user_id", ctx.userId)
  query = args.execution_id
    ? query.eq("id", args.execution_id)
    : query.order("created_at", { ascending: false }).limit(1)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`get_execution: ${error.message}`)
  if (!data) return JSON.stringify({ execution: null, note: "This workflow has no runs yet." })

  const row = data as {
    id: string
    status: string
    node_states: Record<string, NodeState> | null
    total_nodes: number | null
    completed_nodes: number | null
    failed_nodes: number | null
    error_message: string | null
    created_at: string
    completed_at: string | null
  }

  const nodes = Object.entries(row.node_states ?? {}).map(([nodeId, state]) => {
    const failed = state.status === "failed"
    return {
      nodeId,
      nodeType: state.nodeType ?? null,
      status: state.status ?? "unknown",
      ...(state.jobId ? { jobId: state.jobId } : {}),
      ...(failed
        ? {
            error: (state.error ?? "").slice(0, 500),
            ...classifyFailure(state.error),
          }
        : {}),
    }
  })

  return JSON.stringify(
    {
      execution: {
        id: row.id,
        status: row.status,
        totalNodes: row.total_nodes ?? nodes.length,
        completedNodes: row.completed_nodes ?? 0,
        failedNodes: row.failed_nodes ?? 0,
        error: row.error_message,
        startedAt: row.created_at,
        finishedAt: row.completed_at,
      },
      nodes,
    },
    null,
    2,
  )
}
