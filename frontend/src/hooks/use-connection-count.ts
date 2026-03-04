import { useWorkflowStore } from "./use-workflow-store"

/**
 * Returns the number of edges connected to a specific handle on a node.
 *
 * Uses a Zustand selector so the component only re-renders when the count
 * actually changes — not on every edge mutation in the workflow.
 */
export function useConnectionCount(nodeId: string, handleId: string = "in"): number {
  return useWorkflowStore(
    (s) => s.edges.filter((e) => e.target === nodeId && e.targetHandle === handleId).length,
  )
}
