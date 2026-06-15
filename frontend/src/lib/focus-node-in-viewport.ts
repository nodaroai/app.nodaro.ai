/**
 * Pan + zoom the viewport to center a node and select it — the shared
 * "jump to this node" used by the canvas search modal and the handle popover.
 * Extracted so the camera constants (zoom 1, 400ms) and the measured-size
 * fallbacks live in ONE place instead of being copy-pasted per call site.
 */
interface ViewportNode {
  readonly position: { readonly x: number; readonly y: number }
  readonly measured?: { readonly width?: number; readonly height?: number } | null
}

export function focusNodeInViewport(
  getNode: (id: string) => ViewportNode | undefined,
  setCenter: (x: number, y: number, opts?: { zoom?: number; duration?: number }) => void,
  selectNode: (id: string) => void,
  nodeId: string,
): void {
  const target = getNode(nodeId)
  if (!target) return
  const w = target.measured?.width ?? 200
  const h = target.measured?.height ?? 150
  setCenter(target.position.x + w / 2, target.position.y + h / 2, { zoom: 1, duration: 400 })
  selectNode(nodeId)
}
