/**
 * Walk the workflow graph from (nodeId, handleId) to find the upstream
 * video producer's duration. Best-effort: returns null when no edge,
 * no source node, or no duration field. The backend ffprobe is authoritative
 * for billing; this hook is for the toolbar's credit-display estimate only.
 */

import { useWorkflowStore } from "@/hooks/use-workflow-store"

export function useUpstreamVideoDuration(nodeId: string, handleId: string): number | null {
  return useWorkflowStore((s) => {
    const edge = s.edges.find((e) => e.target === nodeId && e.targetHandle === handleId)
    if (!edge) return null
    const src = s.nodes.find((n) => n.id === edge.source)
    if (!src) return null
    const data = src.data as Record<string, unknown>
    const candidates: Array<number | undefined> = [
      data.generatedVideoDuration as number | undefined,
      data.duration as number | undefined,
      data.uploadedDuration as number | undefined,
      data.durationSeconds as number | undefined,
    ]
    return candidates.find((v) => typeof v === "number" && v > 0) ?? null
  })
}
