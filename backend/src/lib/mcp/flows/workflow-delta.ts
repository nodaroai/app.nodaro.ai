import { supabase } from "../../supabase.js"

/** A stored workflow graph as the flow writers read it. */
export interface StoredFlow {
  readonly id: string
  readonly version: number
  readonly nodes: ReadonlyArray<Record<string, unknown>>
  readonly edges: ReadonlyArray<Record<string, unknown>>
  readonly settings: Record<string, unknown>
}

/** An id-keyed change to one workflow (the `apply_workflow_delta` RPC, migration 219). */
export interface FlowDelta {
  readonly upsertNodes?: ReadonlyArray<Record<string, unknown>>
  readonly upsertEdges?: ReadonlyArray<Record<string, unknown>>
  /** Shallow per-key replace of `settings`. */
  readonly settings?: Record<string, unknown>
}

/** Attempts before a write gives up: the editor may be saving the same workflow. */
const MAX_ATTEMPTS = 3

export async function loadFlow(workflowId: string, userId: string): Promise<StoredFlow | null> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id, version, nodes, edges, settings")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: data.id as string,
    version: data.version as number,
    nodes: Array.isArray(data.nodes) ? (data.nodes as Record<string, unknown>[]) : [],
    edges: Array.isArray(data.edges) ? (data.edges as Record<string, unknown>[]) : [],
    settings: (data.settings && typeof data.settings === "object" ? data.settings : {}) as Record<string, unknown>,
  }
}

/**
 * Read the workflow, build a delta from what is stored, and apply it against
 * that version; on a version conflict (someone saved in between) read again
 * and rebuild. `build` returning null means there is nothing to write.
 * Returns true when a delta landed (or nothing was needed), false otherwise.
 */
export async function applyFlowDelta(
  workflowId: string,
  userId: string,
  build: (flow: StoredFlow) => FlowDelta | null,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const flow = await loadFlow(workflowId, userId)
    if (!flow) return false
    const delta = build(flow)
    if (!delta) return true
    const { data, error } = await supabase.rpc("apply_workflow_delta", {
      p_workflow_id: workflowId,
      p_base_version: flow.version,
      p_upsert_nodes: delta.upsertNodes ?? [],
      p_delete_node_ids: [],
      p_upsert_edges: delta.upsertEdges ?? [],
      p_delete_edge_ids: [],
      p_set: delta.settings ? { settings: delta.settings } : null,
      p_user_id: userId,
    })
    if (error) return false
    const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; version?: number | null } | null
    if (row?.ok) return true
    // ok=false with no version: the row is gone or not this user's.
    if (row?.version === null || row?.version === undefined) return false
  }
  return false
}
