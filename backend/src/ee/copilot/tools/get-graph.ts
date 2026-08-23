/**
 * `get_graph` — a compact projection of the open workflow.
 *
 * The MCP `get_workflow_json` dump is the whole row: generated results,
 * field mappings, list runtime state, presentation settings. On a real
 * workflow that blows past the tool-result cap, and the truncated JSON is
 * useless to the model. This returns what an editor needs: identity, wiring,
 * config, and the last run's per-node status.
 */
import { EXECUTION_DATA_KEYS, TRANSIENT_RUNTIME_KEYS } from "@nodaro/shared"
import { supabase } from "../../../lib/supabase.js"
import type { CopilotToolContext } from "./types.js"

interface RawNode {
  id?: unknown
  type?: unknown
  position?: { x?: unknown; y?: unknown } | null
  parentId?: unknown
  data?: Record<string, unknown> | null
}

/** Config only: drop generated output and per-run scratch, keep what the user chose. */
function projectData(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!data) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (EXECUTION_DATA_KEYS.has(key) || TRANSIENT_RUNTIME_KEYS.has(key)) continue
    if (key === "fieldMappings" && value && typeof value === "object" && Object.keys(value).length === 0) continue
    if (value === undefined || value === null || value === "") continue
    // A long free-text field (a prompt) is kept, but never a whole essay.
    out[key] = typeof value === "string" && value.length > 2000 ? `${value.slice(0, 2000)}…` : value
  }
  return out
}

function round(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : undefined
}

export interface GetGraphArgs {
  include_node_ids?: string[]
}

export async function runGetGraph(ctx: CopilotToolContext, args: GetGraphArgs): Promise<string> {
  const { data, error } = await supabase
    .from("workflows")
    .select("name, nodes, edges, version, updated_at")
    .eq("id", ctx.workflowId)
    .eq("user_id", ctx.userId)
    .maybeSingle()
  if (error) throw new Error(`get_graph: ${error.message}`)
  if (!data) throw new Error("get_graph: workflow not found")

  const row = data as { name: string; nodes: unknown; edges: unknown; version: number; updated_at: string }
  const rawNodes = Array.isArray(row.nodes) ? (row.nodes as RawNode[]) : []
  const full = new Set(args.include_node_ids ?? [])

  const states = await lastRunStates(ctx)

  const nodes = rawNodes.map((n) => {
    const id = typeof n.id === "string" ? n.id : ""
    const projected = full.size > 0 && !full.has(id) ? summarizeData(n.data) : projectData(n.data)
    const state = states.get(id)
    return {
      id,
      type: typeof n.type === "string" ? n.type : null,
      ...(n.parentId ? { parentId: n.parentId } : {}),
      position: { x: round(n.position?.x) ?? 0, y: round(n.position?.y) ?? 0 },
      data: projected,
      ...(state ? { lastRun: state } : {}),
    }
  })

  return JSON.stringify(
    { name: row.name, version: row.version, updatedAt: row.updated_at, nodes, edges: row.edges ?? [] },
    null,
    2,
  )
}

/** For nodes the caller did not ask for in full: identity fields only. */
function summarizeData(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const projected = projectData(data)
  const keep: Record<string, unknown> = {}
  for (const key of ["label", "provider", "model"]) {
    if (projected[key] !== undefined) keep[key] = projected[key]
  }
  const rest = Object.keys(projected).filter((k) => keep[k] === undefined)
  if (rest.length > 0) keep.__omittedFields = rest
  return keep
}

async function lastRunStates(ctx: CopilotToolContext): Promise<Map<string, { status: string; error?: string }>> {
  const { data } = await supabase
    .from("workflow_executions")
    .select("node_states")
    .eq("workflow_id", ctx.workflowId)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nodeStates = (data as { node_states?: Record<string, { status?: string; error?: string }> } | null)?.node_states
  const map = new Map<string, { status: string; error?: string }>()
  for (const [id, state] of Object.entries(nodeStates ?? {})) {
    if (!state?.status) continue
    map.set(id, state.error ? { status: state.status, error: state.error.slice(0, 300) } : { status: state.status })
  }
  return map
}
