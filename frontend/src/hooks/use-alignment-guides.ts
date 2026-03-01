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

export interface DraggedNodeRect {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const THRESHOLD = 5 // px in flow coordinates

/**
 * Returns a callback that computes alignment guide lines.
 *
 * Accepts the dragged node's live rect (from onNodeDrag callback) so
 * positions are always up-to-date, even with snap-to-grid enabled.
 */
export function useAlignmentGuides() {
  const { getNodes } = useReactFlow()

  const computeGuides = useCallback(
    (dragged: DraggedNodeRect): GuideLine[] => {
      const allNodes = getNodes()

      const dLeft = dragged.x
      const dTop = dragged.y
      const dRight = dLeft + dragged.width
      const dCenterX = dLeft + dragged.width / 2
      const dBottom = dTop + dragged.height
      const dCenterY = dTop + dragged.height / 2

      const dragXEdges = [dLeft, dRight, dCenterX]
      const dragYEdges = [dTop, dBottom, dCenterY]

      const guides: GuideLine[] = []
      const seenV = new Set<number>()
      const seenH = new Set<number>()

      for (const node of allNodes) {
        if (node.id === dragged.id) continue
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
            if (Math.abs(dx - ox) <= THRESHOLD) {
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
            if (Math.abs(dy - oy) <= THRESHOLD) {
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
