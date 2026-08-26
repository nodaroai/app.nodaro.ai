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
import { PARAMETER_NODE_TYPES } from "@nodaro/shared"
import { supabase } from "../../../lib/supabase.js"
import type { WiredAsset } from "./edit-workflow.js"
import { classifyFailure } from "../../../lib/mcp/tools/diagnose.js"
import { EditRejected } from "./edit-rejected.js"
import type { CopilotToolContext, RunProposal, RunProposalNode } from "./types.js"

export interface RunWorkflowArgs {
  /** One line the panel shows on the Run card. */
  note?: string
  /** Propose ONE node instead of the whole graph. */
  node_id?: string
}

/**
 * NO input overrides. The run route merges an override object straight onto a
 * node's data at execution time (`applyInputOverrides`), which would be a
 * second write path around every `edit_workflow` guard — including the
 * destination lock. The model configures nodes through `edit_workflow`, or
 * not at all.
 */
export async function proposeRun(
  ctx: CopilotToolContext,
  args: RunWorkflowArgs,
  addedNodeTypes: string[],
  wiredAssets: readonly WiredAsset[] = [],
): Promise<{ proposal: RunProposal; message: string }> {
  const node = args.node_id ? await describeProposedNode(ctx, args.node_id) : undefined

  const proposal: RunProposal = {
    addedNodeTypes,
    wiredAssets: [...wiredAssets],
    note: args.note,
    ...(node ? { node } : {}),
  }
  ctx.emit({
    type: "run_proposed",
    data: {
      workflowId: ctx.workflowId,
      addedNodeTypes: proposal.addedNodeTypes,
      // Named, not counted: "1 file" tells the user nothing about WHICH file
      // they are about to spend credits on.
      wiredAssets: proposal.wiredAssets,
      note: proposal.note ?? null,
      node: proposal.node ?? null,
    },
  })
  return {
    proposal,
    message: node
      ? `Run proposed for "${node.label}" only. The user decides whether to start it — say what that one node will do and stop; you'll get the outcome in their next message.`
      : "Run proposed. The user decides whether to start it — summarize what will run and stop; you'll get the outcome in their next message.",
  }
}

/**
 * Read the node out of the LIVE graph, now.
 *
 * The turn's `base_version` is the version at turn START and is stale the
 * moment the copilot's own first edit lands — which is exactly when a run
 * gets proposed. Stamping the proposal with it would make the client's
 * version check refuse every proposal that followed an edit, i.e. all of them.
 */
async function describeProposedNode(ctx: CopilotToolContext, nodeId: string): Promise<RunProposalNode> {
  const { data, error } = await supabase
    .from("workflows")
    .select("nodes, version")
    .eq("id", ctx.workflowId)
    .eq("user_id", ctx.userId)
    .maybeSingle()
  if (error) throw new Error(`run_workflow: ${error.message}`)
  if (!data) throw new Error("run_workflow: workflow not found")

  const row = data as { nodes: unknown; version: number }
  const nodes = Array.isArray(row.nodes) ? (row.nodes as Array<Record<string, unknown>>) : []
  const found = nodes.find((n) => n?.id === nodeId)
  if (!found) {
    throw new EditRejected(
      `No node "${nodeId}" on this canvas. Call get_graph and use an id from it, or propose the whole run.`,
    )
  }
  const type = typeof found.type === "string" ? found.type : ""
  if (!type) throw new EditRejected(`Node "${nodeId}" has no type — it cannot be run on its own.`)

  // Refused HERE rather than at the click. A parameter node is read from its
  // own data and never executed, so a card offering to run one is a button
  // that cannot work — and refusing at the click teaches the model nothing,
  // because by then its tool call has already returned success. This way it
  // hears why and can propose the whole run instead.
  //
  // The SHARED set, not a list of our own: a new parameter node joins it once
  // and this inherits the answer.
  if (PARAMETER_NODE_TYPES.has(type)) {
    throw new EditRejected(
      `"${type}" is a setting the graph reads, not a step that runs — it cannot be run on its own. Propose the whole run instead.`,
    )
  }

  const data_ = (found.data ?? {}) as Record<string, unknown>
  const label = typeof data_.label === "string" && data_.label.trim() ? data_.label.trim().slice(0, 80) : type

  return { id: nodeId, type, graphVersion: row.version, label }
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
