import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { carriedEdges } from "@/components/editor/workflow-editor/carried-edges"
import type { WorkflowEdge } from "@/types/nodes"

/**
 * The store's edges as they CARRY — a wire leaving a Teleport Receive re-pointed
 * at the node and pip feeding its Send (@nodaro/render-rules teleport-bypass.ts),
 * the same graph both engines run. A config panel that judges what is wired in
 * (its type, its media, its data) reads this, so it shows what the run uses.
 *
 * A re-pointed wire keeps its own id and, in `teleportedFrom`, the Receive it was
 * drawn from: key a per-wire setting by `drawnSourceId(edge)`, never
 * `edge.source`. Read-only — never write these edges back to the store.
 */
export function useCarriedEdges(): WorkflowEdge[] {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  return carriedEdges(nodes, edges)
}
