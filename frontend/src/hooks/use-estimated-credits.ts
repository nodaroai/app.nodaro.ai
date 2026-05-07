import {
  estimateLoopVideoCredits,
  estimateTrimVideoCredits,
  estimateCombineVideosCredits,
  type LoopVideoEstimatorInput,
  type TrimVideoEstimatorInput,
  type CombineVideosEstimatorInput,
} from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  getUpstreamDuration,
  getCombineUpstreamDurations,
} from "@/lib/upstream-duration"
import type { WorkflowNode } from "@/types/nodes"

/** Returns the estimated credit cost for a video-utility node by walking
 *  upstream to read source durations. Returns 0 for unsupported node types.
 *
 *  The selector returns a primitive number, so Zustand only triggers a
 *  re-render when the credits actually change — even though the selector
 *  itself re-runs on any store update, that's a few microseconds of pure
 *  math on a JSON object. */
export function useEstimatedCredits(node: WorkflowNode): number {
  return useWorkflowStore((s) => {
    const data = node.data as Record<string, unknown>
    switch (node.type) {
      case "loop-video": {
        const upstream = getUpstreamDuration(node.id, s.nodes as WorkflowNode[], s.edges)
        return estimateLoopVideoCredits(data as LoopVideoEstimatorInput, upstream)
      }
      case "trim-video": {
        const upstream = getUpstreamDuration(node.id, s.nodes as WorkflowNode[], s.edges)
        return estimateTrimVideoCredits(data as TrimVideoEstimatorInput, upstream)
      }
      case "combine-videos": {
        const durations = getCombineUpstreamDurations(node, s.nodes as WorkflowNode[], s.edges)
        return estimateCombineVideosCredits(data as CombineVideosEstimatorInput, durations)
      }
      default:
        return 0
    }
  })
}
