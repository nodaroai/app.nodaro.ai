import { useMemo } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { computeMissingPromptRefs, type MissingRef } from "@/lib/missing-prompt-refs"

/**
 * Reactive list of unresolved `{Label}` references in a node's prompt fields.
 * Mirrors useHandleConnections: subscribe to nodes/edges, memoize a pure fn.
 */
export function useMissingPromptRefs(nodeId: string): MissingRef[] {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  return useMemo(
    () => computeMissingPromptRefs(nodes, edges, nodeId),
    [nodes, edges, nodeId],
  )
}
