/**
 * How many images are wired into a node (references and identity nodes),
 * for the cost pill of a model priced per input image (GPT Image 2.6,
 * MiniMax H3 Image).
 */
import { countImageInputEdges } from "@nodaro/shared/workflow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

export function useWiredImageRefCount(nodeId: string): number {
  return useWorkflowStore((s) => countImageInputEdges(s.edges, nodeId))
}
