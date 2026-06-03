/**
 * Single source of truth for "is this node visually compact right now?".
 *
 * A node is compact when its ON-SCREEN width (its DOM width × the canvas
 * zoom) drops below {@link NODE_COMPACT_VISIBLE_WIDTH_PX}. Two behaviors flip
 * at this exact size so they stay in lockstep:
 *   - the Generate Image quick toolbar collapses to its single summary pill
 *     (`generate-image-quick-toolbar.tsx`), and
 *   - typed-handle labels hide at rest — except CONNECTED ones — and are all
 *     revealed on node hover (`handle-with-popover.tsx` + the
 *     `.handle-typed-pip-label.is-compact` rules in `globals.css`).
 *
 * Keeping the threshold + the width/zoom read here (rather than re-deriving in
 * each consumer) means they can never drift apart.
 */

import { useStore } from "@xyflow/react"

/**
 * On-screen node width (px) below which the node is treated as compact.
 * Derived historically from the quick toolbar's natural strip width
 * (~400px) over its 1.5× crowding factor ≈ 267px.
 */
export const NODE_COMPACT_VISIBLE_WIDTH_PX = 267

/** Pure predicate: is `nodeWidthPx × zoom` below the compact threshold? */
export function isNodeVisuallyCompact(nodeWidthPx: number, zoom: number): boolean {
  return nodeWidthPx * zoom < NODE_COMPACT_VISIBLE_WIDTH_PX
}

/**
 * React Flow hook → true when the node is visually compact. Reads the node's
 * width from the O(1) `nodeLookup` map and the live zoom; the selector returns
 * a primitive boolean so subscribers only re-render when the node actually
 * crosses the threshold (not on every zoom/pan frame).
 */
export function useNodeVisuallyCompact(nodeId: string): boolean {
  return useStore((s) => {
    const n = s.nodeLookup.get(nodeId)
    const w =
      (n?.width as number | undefined) ?? (n?.measured?.width as number | undefined)
    const width = typeof w === "number" && w > 0 ? w : 320
    return isNodeVisuallyCompact(width, s.transform[2])
  })
}
