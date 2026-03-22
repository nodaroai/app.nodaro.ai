import { useStore } from "@xyflow/react"
import { useCanvasZoom } from "@/components/editor/canvas-zoom-context"

/**
 * Returns true when the node is large enough on screen to warrant full-resolution
 * images instead of thumbnails. Based on visible pixel size (measuredWidth * zoom)
 * rather than zoom level alone, so a large resized node at low zoom still gets
 * full-res, and a tiny node at high zoom still gets thumbnails.
 */
export function useFullResolution(nodeId: string, threshold = 320): boolean {
  const { zoom } = useCanvasZoom()
  const nodeWidth = useStore((s) => s.nodeLookup.get(nodeId)?.measured?.width ?? 0)
  return nodeWidth * zoom >= threshold
}
