import { bypassTeleports } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

let cached: { nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[]; carried: WorkflowEdge[] } | undefined

/**
 * The edges as they CARRY — a wire leaving a Teleport Receive re-pointed at the
 * node and pip feeding its Send (@nodaro/render-rules teleport-bypass.ts) —
 * memoized on the snapshot's arrays. Read-only: never write these back.
 */
export function carriedEdges(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): WorkflowEdge[] {
  if (cached && cached.nodes === nodes && cached.edges === edges) return cached.carried
  const carried = bypassTeleports(nodes, edges)
  cached = { nodes, edges, carried }
  return carried
}
