/**
 * How many images are wired into a node (references and identity nodes),
 * for the cost pill of a model whose price reads them (GPT Image 2.6, MiniMax
 * H3 Image, Seedream 5.5, and FLUX 3 Klein, priced on its edit id when any goes).
 */
import { useMemo } from "react"
import { countImageInputEdges } from "@nodaro/shared/workflow"
import { isKlingImage4, type ImageInputGraph } from "@nodaro/shared/model-catalog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

const NONE: readonly never[] = []

export function useWiredImageRefCount(nodeId: string): number {
  return useWorkflowStore((s) => countImageInputEdges(s.edges, nodeId))
}

/**
 * The node and its graph, for a model that counts input items (Kling Image
 * 4.0: a character's views grouped, each image once), else undefined — so no
 * other model's pill re-renders on a graph change.
 */
export function useImageInputGraph(nodeId: string, provider: string | undefined): ImageInputGraph | undefined {
  const counts = isKlingImage4(provider)
  const nodes = useWorkflowStore((s) => (counts ? s.nodes : NONE))
  const edges = useWorkflowStore((s) => (counts ? s.edges : NONE))
  return useMemo(() => (counts ? { nodeId, nodes, edges } : undefined), [counts, nodeId, nodes, edges])
}
