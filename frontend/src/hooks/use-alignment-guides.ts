import { useCallback } from "react"
import { useReactFlow } from "@xyflow/react"

export interface GuideLine {
  readonly orientation: "vertical" | "horizontal"
  /** Position on the perpendicular axis (x for vertical, y for horizontal) */
  readonly position: number
  /** Start of the line on the parallel axis */
  readonly from: number
  /** End of the line on the parallel axis */
  readonly to: number
}

const SNAP_THRESHOLD = 5 // px in flow coordinates

/**
 * Returns a callback that computes alignment guide lines between the
 * dragged node and all other (non-sticky, non-hidden, non-selected) nodes.
 */
export function useAlignmentGuides() {
  const { getNodes } = useReactFlow()

  const computeGuides = useCallback(
    (draggedNodeId: string): GuideLine[] => {
      const allNodes = getNodes()
      const dragged = allNodes.find((n) => n.id === draggedNodeId)
      if (!dragged) return []

      const dW = dragged.measured?.width ?? 200
      const dH = dragged.measured?.height ?? 100
      const dLeft = dragged.position.x
      const dRight = dLeft + dW
      const dCenterX = dLeft + dW / 2
      const dTop = dragged.position.y
      const dBottom = dTop + dH
      const dCenterY = dTop + dH / 2

      // Candidate edges of the dragged node
      const dragXEdges = [dLeft, dRight, dCenterX]
      const dragYEdges = [dTop, dBottom, dCenterY]

      const guides: GuideLine[] = []
      const seenV = new Set<number>()
      const seenH = new Set<number>()

      for (const node of allNodes) {
        if (node.id === draggedNodeId) continue
        if (node.type === "sticky-note") continue
        if ((node.data as Record<string, unknown>)?.hidden) continue
        if (node.selected) continue

        const nW = node.measured?.width ?? 200
        const nH = node.measured?.height ?? 100
        const nLeft = node.position.x
        const nRight = nLeft + nW
        const nCenterX = nLeft + nW / 2
        const nTop = node.position.y
        const nBottom = nTop + nH
        const nCenterY = nTop + nH / 2

        const otherXEdges = [nLeft, nRight, nCenterX]
        const otherYEdges = [nTop, nBottom, nCenterY]

        // Vertical guides (aligned on X axis)
        for (const dx of dragXEdges) {
          for (const ox of otherXEdges) {
            if (Math.abs(dx - ox) <= SNAP_THRESHOLD) {
              const pos = Math.round(ox)
              if (!seenV.has(pos)) {
                seenV.add(pos)
                const minY = Math.min(dTop, dBottom, nTop, nBottom)
                const maxY = Math.max(dTop, dBottom, nTop, nBottom)
                guides.push({ orientation: "vertical", position: pos, from: minY, to: maxY })
              }
            }
          }
        }

        // Horizontal guides (aligned on Y axis)
        for (const dy of dragYEdges) {
          for (const oy of otherYEdges) {
            if (Math.abs(dy - oy) <= SNAP_THRESHOLD) {
              const pos = Math.round(oy)
              if (!seenH.has(pos)) {
                seenH.add(pos)
                const minX = Math.min(dLeft, dRight, nLeft, nRight)
                const maxX = Math.max(dLeft, dRight, nLeft, nRight)
                guides.push({ orientation: "horizontal", position: pos, from: minX, to: maxX })
              }
            }
          }
        }
      }

      return guides
    },
    [getNodes],
  )

  return computeGuides
}
