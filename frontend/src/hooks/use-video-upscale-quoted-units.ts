/**
 * The Topaz units a Video Upscale node is quoted at (1 for any other
 * provider): the reading the confirm dialog and the workflow badge price it by
 * (`videoUpscalePricingUnits`), so the node's own pill and Run button never
 * disagree with them. The selector returns a number, so it re-renders only
 * when the units move.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { nodaroVideoUpscaleRefusedSec, videoUpscalePricingUnits } from "@/lib/video-utility-estimate"
import type { WorkflowNode } from "@/types/nodes"

export function useVideoUpscaleQuotedUnits(nodeId: string): number {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId) as WorkflowNode | undefined
    return node ? videoUpscalePricingUnits(node, s.nodes, s.edges) : 1
  })
}

/**
 * The length of the clip a Nodaro Video Upscale node is given when the graph
 * knows it is past the longest clip a run takes (`nodaroVideoUpscaleRefusedSec`,
 * the reading the confirm dialog leaves the node out by), else undefined: the
 * node's pill and Run button then show no figure for a run that is refused.
 */
export function useNodaroVideoUpscaleRefusedSec(nodeId: string): number | undefined {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId) as WorkflowNode | undefined
    return node ? nodaroVideoUpscaleRefusedSec(node, s.nodes, s.edges) : undefined
  })
}
