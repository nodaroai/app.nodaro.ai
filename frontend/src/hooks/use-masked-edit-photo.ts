/**
 * Whether a node carries an inpainting mask (its own or wired) and the size
 * of the photo wired into it, as the node it comes from records it: what the
 * cost pill of a masked edit on a model that follows its photo (GPT Image 2.6
 * Flare and Sunburst) is priced from. The selector returns a string, so the
 * pill re-renders only when one of them changes.
 */
import { useMemo } from "react"
import { nodeIsMasked, wiredImageSize } from "@nodaro/shared/workflow"
import type { SourceImageSize } from "@nodaro/shared/model-catalog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

export function useMaskedEditPhoto(nodeId: string): { masked: boolean; sourceImage?: SourceImageSize } {
  const key = useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId)
    const masked = nodeIsMasked(nodeId, node?.data as Record<string, unknown> | undefined, s.edges)
    const size = masked ? wiredImageSize(nodeId, s.nodes, s.edges) : undefined
    return `${masked ? 1 : 0}:${size ? `${size.width}x${size.height}` : ""}`
  })
  return useMemo(() => {
    const [flag, dims] = key.split(":")
    const [width, height] = (dims ?? "").split("x").map(Number)
    return {
      masked: flag === "1",
      ...(width && height ? { sourceImage: { width, height } } : {}),
    }
  }, [key])
}
