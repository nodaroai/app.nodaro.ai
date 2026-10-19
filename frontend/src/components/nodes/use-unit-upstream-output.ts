// frontend/src/components/nodes/use-unit-upstream-output.ts — what is wired into
// one input pip of a canvas node, for a node unit's node.tsx (§5.8 B,
// tools/units/README.md). A unit may not import the workflow store or the
// engine's output extraction (G5); this hook reads both for it, the way
// useUnitNodeKit does for the store's services.
import { useMemo } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { incomingSourcesFingerprint } from "@/lib/node-fingerprint"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"

/**
 * The output of the first node wired into `nodeId`'s `handleId` pip (on the
 * pip its edge taps), or undefined when nothing is wired there. Re-read when an
 * incoming connection or upstream source data changes.
 */
export function useUnitUpstreamOutput(nodeId: string, handleId: string): string | undefined {
  const connectedFingerprint = useWorkflowStore((s) => incomingSourcesFingerprint(s.nodes, s.edges, nodeId))
  return useMemo(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    for (const edge of edges) {
      if (edge.target !== nodeId || edge.targetHandle !== handleId) continue
      const src = nodes.find((n) => n.id === edge.source)
      if (src) return extractNodeOutput(src, edge.sourceHandle ?? undefined)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedFingerprint, nodeId, handleId])
}
