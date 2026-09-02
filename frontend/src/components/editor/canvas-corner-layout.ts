/**
 * The corners of the canvas column mirror as one set: the node config drawer
 * pins to the inline END, the controls bar to the inline START, and the
 * React Flow MiniMap sits under the drawer's edge. The MiniMap lives inside
 * `.react-flow`, which is pinned `direction: ltr` (the graph is content, not
 * chrome), so a logical class cannot reach it — its corner is a prop chosen
 * by the live direction.
 */
export type MiniMapCorner = "bottom-left" | "bottom-right"

export function minimapPosition(isRtl: boolean): MiniMapCorner {
  return isRtl ? "bottom-left" : "bottom-right"
}
