/**
 * Pure viewport-math helpers for keyboard panning (Ctrl+Alt+Arrow) and the
 * auto-focus control button. Kept free of React/React Flow so they are trivially
 * unit-tested; the canvas wires them to `setViewport` / `setCenter`.
 */

/** Screen-space pixels the canvas pans per Ctrl+Alt+Arrow keypress. */
export const PAN_STEP_PX = 80

/** Fallback node dimensions when React Flow has not measured a node yet. */
const DEFAULT_NODE_WIDTH = 200
const DEFAULT_NODE_HEIGHT = 100

interface NearestNode {
  readonly id: string
  readonly type?: string | null
  readonly hidden?: boolean
  readonly position: { readonly x: number; readonly y: number }
  readonly measured?: { readonly width?: number; readonly height?: number }
  readonly width?: number
  readonly height?: number
}

/**
 * Viewport translate delta for a Ctrl+Alt+Arrow keypress, or null for any
 * non-arrow code. Scroll convention: an arrow reveals content in its direction
 * (Right reveals content to the right). The delta is added to the React Flow
 * viewport translate, which moves content, so revealing the right means x--.
 */
export function panDelta(code: string, step: number): { dx: number; dy: number } | null {
  switch (code) {
    case "ArrowRight":
      return { dx: -step, dy: 0 }
    case "ArrowLeft":
      return { dx: step, dy: 0 }
    case "ArrowDown":
      return { dx: 0, dy: -step }
    case "ArrowUp":
      return { dx: 0, dy: step }
    default:
      return null
  }
}

/**
 * Id of the visible node whose center is closest to `point` (flow coords), or
 * null when there is no eligible node. Hidden nodes and sticky notes are
 * skipped. Ties resolve to the first node in array order (stable).
 */
export function findNodeNearestToPoint(
  nodes: ReadonlyArray<NearestNode>,
  point: { x: number; y: number },
): string | null {
  let bestId: string | null = null
  let bestDistSq = Infinity
  for (const n of nodes) {
    if (n.hidden || n.type === "sticky-note") continue
    const w = n.measured?.width ?? n.width ?? DEFAULT_NODE_WIDTH
    const h = n.measured?.height ?? n.height ?? DEFAULT_NODE_HEIGHT
    const cx = n.position.x + w / 2
    const cy = n.position.y + h / 2
    const dx = cx - point.x
    const dy = cy - point.y
    const distSq = dx * dx + dy * dy
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      bestId = n.id
    }
  }
  return bestId
}
