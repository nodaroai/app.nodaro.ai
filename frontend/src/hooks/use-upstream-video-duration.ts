/**
 * Walk the workflow graph from (nodeId, handleId) to find the upstream
 * video producer's duration. Best-effort: returns null when no edge,
 * no source node, or no duration field. The backend ffprobe is authoritative
 * for billing; this hook is for the toolbar's credit-display estimate only.
 * The reading itself is `upstreamVideoDurationSec`, which the workflow
 * estimate shares.
 */

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { upstreamVideoDurationSec } from "@/lib/upstream-video-duration"

export function useUpstreamVideoDuration(nodeId: string, handleId: string): number | null {
  return useWorkflowStore((s) => upstreamVideoDurationSec(nodeId, handleId, s.nodes, s.edges))
}
