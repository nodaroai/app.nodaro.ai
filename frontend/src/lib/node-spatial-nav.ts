/**
 * Spatial "nearest node in a direction" pick — the directional neighbor-nav
 * used by the canvas (Arrow / Alt+Arrow) AND the node-search modal (Alt+Arrow
 * re-targets the focused node while search is open). Extracted so both share
 * ONE implementation rather than drifting copies.
 *
 * Center-to-center distance; a node only qualifies if it sits clearly (>20px)
 * in the requested direction. Hidden nodes are skipped.
 */
export type ArrowDirection = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"

export interface SpatialNode {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly measured?: { readonly width?: number; readonly height?: number } | null
  readonly hidden?: boolean
}

const THRESHOLD = 20

export function nearestNodeInDirection(
  nodes: ReadonlyArray<SpatialNode>,
  fromId: string,
  direction: ArrowDirection,
): string | null {
  const current = nodes.find((n) => n.id === fromId)
  if (!current) return null
  const cx = current.position.x + (current.measured?.width ?? 200) / 2
  const cy = current.position.y + (current.measured?.height ?? 100) / 2

  let bestId: string | null = null
  let bestDist = Infinity
  for (const n of nodes) {
    if (n.id === fromId || n.hidden) continue
    const nx = n.position.x + (n.measured?.width ?? 200) / 2
    const ny = n.position.y + (n.measured?.height ?? 100) / 2
    const dx = nx - cx
    const dy = ny - cy
    const ok =
      (direction === "ArrowRight" && dx > THRESHOLD) ||
      (direction === "ArrowLeft" && dx < -THRESHOLD) ||
      (direction === "ArrowDown" && dy > THRESHOLD) ||
      (direction === "ArrowUp" && dy < -THRESHOLD)
    if (!ok) continue
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < bestDist) {
      bestDist = dist
      bestId = n.id
    }
  }
  return bestId
}
