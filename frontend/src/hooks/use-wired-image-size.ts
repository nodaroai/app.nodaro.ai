/**
 * The size of the photo wired into a node's `image` input, as the node it
 * comes from records it — what the cost pill of a model priced by its photo's
 * size (Nodaro Image Upscale: the output is that size × the factor) is priced from.
 * The selector returns a string, so the pill re-renders only when it changes.
 */
import { useMemo } from "react"
import { wiredImageSize } from "@nodaro/shared/workflow"
import type { SourceImageSize } from "@nodaro/shared/model-catalog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

export function useWiredImageSize(nodeId: string): SourceImageSize | undefined {
  const key = useWorkflowStore((s) => {
    const size = wiredImageSize(nodeId, s.nodes, s.edges)
    return size ? `${size.width}x${size.height}` : ""
  })
  return useMemo(() => {
    const [width, height] = key.split("x").map(Number)
    return width && height ? { width, height } : undefined
  }, [key])
}
