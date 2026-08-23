/**
 * The volatile part of a turn's prompt: what the workflow looks like right
 * now, and what the user already owns that the copilot can reference.
 *
 * It rides in the USER message, not in `system`: the system block is the
 * cached prefix and must not change between turns. Stored separately from the
 * user's own text (`copilot_messages.context_preamble`) so replay can include
 * only the latest snapshot instead of ten contradictory ones.
 */
import { supabase } from "../../lib/supabase.js"
import { TURN_CAPS } from "./constants.js"

interface GraphNode {
  id?: unknown
  type?: unknown
  data?: { label?: unknown } | null
}

export interface SnapshotInput {
  userId: string
  workflowId: string
  workflowName: string
  version: number | null
  nodes: unknown
  edges: unknown
}

const MAX_LISTED_NODES = 60

function nodeLine(node: GraphNode): string | null {
  const id = typeof node.id === "string" ? node.id : null
  const type = typeof node.type === "string" ? node.type : null
  if (!id || !type) return null
  const label = typeof node.data?.label === "string" ? node.data.label.slice(0, 60) : ""
  return label ? `${id} (${type}) "${label}"` : `${id} (${type})`
}

async function lastRunLine(workflowId: string, userId: string): Promise<string> {
  const { data } = await supabase
    .from("workflow_executions")
    .select("id, status, completed_nodes, failed_nodes, total_nodes, created_at")
    .eq("workflow_id", workflowId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as
    | { id: string; status: string; completed_nodes: number | null; failed_nodes: number | null; total_nodes: number | null }
    | null
  if (!row) return "Last run: none yet."
  return `Last run: execution ${row.id} — ${row.status} (${row.completed_nodes ?? 0}/${row.total_nodes ?? 0} nodes done, ${row.failed_nodes ?? 0} failed).`
}

async function entityCounts(userId: string): Promise<string> {
  const tables = ["characters", "locations", "objects", "creatures"] as const
  const parts: string[] = []
  for (const table of tables) {
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
    if ((count ?? 0) > 0) parts.push(`${count} ${table}`)
  }
  return parts.length > 0
    ? `The user has saved: ${parts.join(", ")} (list them with list_characters / list_locations before referencing one).`
    : "The user has no saved characters, locations or objects yet."
}

/** A compact, per-turn view of the world. Capped so it can never crowd out the conversation. */
export async function buildContextPreamble(input: SnapshotInput): Promise<string> {
  const nodes = Array.isArray(input.nodes) ? (input.nodes as GraphNode[]) : []
  const edges = Array.isArray(input.edges) ? input.edges : []
  const lines = nodes.slice(0, MAX_LISTED_NODES).map(nodeLine).filter((l): l is string => l !== null)
  const overflow = nodes.length > MAX_LISTED_NODES ? `\n… and ${nodes.length - MAX_LISTED_NODES} more nodes (call get_graph for the full list).` : ""
  const [runLine, entities] = await Promise.all([
    lastRunLine(input.workflowId, input.userId),
    entityCounts(input.userId),
  ])

  const body = [
    `Workflow "${input.workflowName}" (version ${input.version ?? "unknown"}) — ${nodes.length} nodes, ${edges.length} edges.`,
    lines.length > 0 ? `Nodes:\n${lines.join("\n")}${overflow}` : "The canvas is empty.",
    runLine,
    entities,
  ].join("\n\n")

  const capped = body.length > TURN_CAPS.contextPreambleMaxChars
    ? `${body.slice(0, TURN_CAPS.contextPreambleMaxChars)}\n… (truncated)`
    : body
  return `<workflow-context>\n${capped}\n</workflow-context>`
}
