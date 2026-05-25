import { useMemo } from "react"
import { useWorkflowStore } from "./use-workflow-store"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export interface HandleConnection {
  readonly edgeId: string
  readonly otherNodeId: string
  readonly otherNodeLabel: string
  readonly otherNodeType: string
}

/** Pure function — extracted for testability. */
export function computeHandleConnections(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  nodeId: string,
  handleId: string,
  direction: "source" | "target",
): HandleConnection[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const result: HandleConnection[] = []
  for (const e of edges) {
    if (direction === "target") {
      if (e.target !== nodeId || e.targetHandle !== handleId) continue
      const other = nodeById.get(e.source)
      if (!other) continue
      result.push({
        edgeId: e.id,
        otherNodeId: other.id,
        otherNodeLabel: ((other.data as { label?: string }).label ?? other.type ?? "Unknown") as string,
        otherNodeType: (other.type ?? "") as string,
      })
    } else {
      if (e.source !== nodeId || e.sourceHandle !== handleId) continue
      const other = nodeById.get(e.target)
      if (!other) continue
      result.push({
        edgeId: e.id,
        otherNodeId: other.id,
        otherNodeLabel: ((other.data as { label?: string }).label ?? other.type ?? "Unknown") as string,
        otherNodeType: (other.type ?? "") as string,
      })
    }
  }
  return result
}

/** Hook that subscribes to the workflow store and recomputes only when
 *  nodes/edges actually change. */
export function useHandleConnections(
  nodeId: string,
  handleId: string,
  direction: "source" | "target",
): HandleConnection[] {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  return useMemo(
    () => computeHandleConnections(nodes, edges, nodeId, handleId, direction),
    [nodes, edges, nodeId, handleId, direction],
  )
}
