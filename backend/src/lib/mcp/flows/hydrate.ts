import { supabase } from "../../supabase.js"
import { applyFlowDelta } from "./workflow-delta.js"
import { workflowIdOfFlowNode } from "./flow-graph.js"
import { OUTPUT_URL_FIELD, outputKeyOfStep } from "./mappers/kit.js"

/**
 * Fill an MCP conversation node with its job's outcome.
 *
 * The editor writes a node's results itself when it ran the job, and on open
 * it reads them back for a node still marked running. A conversation node's
 * job was started by an assistant, usually with no editor open, so without
 * this the stored graph would hold a forever-running node: the conversation
 * card would have no preview and a server-side "Run from here" no input.
 *
 * Only MCP jobs filed in a conversation workflow (`settings.mcpConversation`)
 * are touched: an editor's own single-node run is the editor's to write, and
 * a second writer there would race its save. Best-effort, and never a write
 * to the job row.
 */


interface JobRow {
  readonly id: string
  readonly user_id: string

  readonly node_id: string | null
  readonly source: string | null
  readonly status: string
  readonly output_data: Record<string, unknown> | null
  readonly error_message: string | null
  readonly completed_at: string | null
}

type Node = Record<string, unknown> & { id: string; type?: string; data?: Record<string, unknown> }

/** The node's data once its job is applied, or null when there is nothing to apply. */
export function hydratedNodeData(node: Node, job: JobRow): Record<string, unknown> | null {
  const data = node.data ?? {}
  const results = Array.isArray(data.generatedResults) ? (data.generatedResults as Array<Record<string, unknown>>) : []
  // Only the job this node is waiting for, and only once.
  if (data.currentJobId !== job.id) return null
  const { currentJobId: _current, currentJobProgress: _progress, ...rest } = data
  if (job.status === "failed" || job.status === "cancelled") {
    return { ...rest, executionStatus: "failed", errorMessage: job.error_message ?? "The generation failed." }
  }
  if (job.status !== "completed") return null
  const outputKey = outputKeyOfStep(node.type, data)
  const url = outputKey ? job.output_data?.[OUTPUT_URL_FIELD[outputKey]] : undefined
  // Finished with no media the node shows: done all the same, never left running.
  if (!outputKey || typeof url !== "string" || !url) return { ...rest, executionStatus: "completed" }
  const thumbnailUrl = typeof job.output_data?.thumbnailUrl === "string" ? job.output_data.thumbnailUrl : undefined
  const result = {
    url,
    ...(thumbnailUrl && outputKey === "generatedVideoUrl" ? { thumbnailUrl } : {}),
    timestamp: job.completed_at ?? new Date().toISOString(),
    jobId: job.id,
  }
  // Every other media field the job also wrote (Voice Changer on a video keeps
  // its audio beside it): a later step may be wired from that output.
  const sidecars = Object.fromEntries(
    (Object.entries(OUTPUT_URL_FIELD) as Array<[string, string]>)
      .filter(([key, field]) => key !== outputKey && typeof job.output_data?.[field] === "string")
      .map(([key, field]) => [key, job.output_data?.[field]]),
  )
  return {
    ...rest,
    ...sidecars,
    executionStatus: "completed",
    [outputKey]: url,
    generatedResults: [result, ...results.filter((r) => r.jobId !== job.id)],
    activeResultIndex: 0,
  }
}

/** Apply a finished job to its conversation node, if it has one. Never throws. */
export async function hydrateFlowNodeForJob(jobId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from("jobs")
      .select("id, user_id, node_id, source, status, output_data, error_message, completed_at")
      .eq("id", jobId)
      .maybeSingle()
    const job = data as JobRow | null
    if (!job || job.source !== "mcp") return
    // The node id names the conversation (flow-graph.ts flowNodeId); the job
    // carries no workflow_id on purpose.
    const workflowId = workflowIdOfFlowNode(job.node_id)
    if (!workflowId) return
    await applyFlowDelta(workflowId, job.user_id, (flow) => {
      if (!flow.settings.mcpConversation) return null
      // By the job too: a client retry reuses the job but writes a node of its own.
      const node = (flow.nodes.find((n) => n.id === job.node_id) ??
        flow.nodes.find((n) => (n.data as Record<string, unknown> | undefined)?.currentJobId === job.id)) as Node | undefined
      if (!node) return null
      const next = hydratedNodeData(node, job)
      return next ? { upsertNodes: [{ ...node, data: next }] } : null
    })
  } catch (err) {
    console.warn(`[mcp-flows] could not apply job ${jobId} to its node:`, err instanceof Error ? err.message : err)
  }
}
