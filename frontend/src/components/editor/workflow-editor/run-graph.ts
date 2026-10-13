import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { carriedEdges } from "./carried-edges"

/**
 * The graph the in-browser runner READS: the store's nodes, and its edges as
 * they carry — a wire leaving a Teleport Receive re-pointed at the node and
 * pip feeding its Send, so every rule (types, lists, fan-out, JSON kinds) sees
 * exactly what entered the pair. The orchestrator reads the same graph
 * (`bypassTeleports` at load, @nodaro/render-rules teleport-bypass.ts).
 *
 * Read-only. Never write these edges back to the store — a re-pointed wire
 * would replace the one the user drew. The two runner paths that write edges
 * (clone expand / collapse) read the store directly; the census in
 * `__tests__/run-graph-census.test.ts` keeps every other runner read here.
 */
export function runGraph(): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const { nodes, edges } = useWorkflowStore.getState()
  return { nodes, edges: carriedEdges(nodes, edges) }
}
