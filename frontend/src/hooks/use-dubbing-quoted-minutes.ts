/**
 * The started minutes a Dubbing node is quoted at (1 to 30; 1 when the span is
 * not known): the reading the confirm dialog and the workflow badge price it
 * by (`dubbingQuotedMinutesOf`), so the node's own pill and Run button never
 * disagree with them. The selector returns a number, so it re-renders only
 * when the minutes move.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { dubbingQuotedMinutesOf } from "@/lib/video-utility-estimate"
import type { WorkflowNode } from "@/types/nodes"

export function useDubbingQuotedMinutes(nodeId: string): number {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId) as WorkflowNode | undefined
    return node ? dubbingQuotedMinutesOf(node, s.nodes, s.edges) : 1
  })
}
