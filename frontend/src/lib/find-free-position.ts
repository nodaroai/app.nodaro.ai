/**
 * Collision-free node placement for the canvas. New nodes never land on top
 * of existing ones: when the desired spot (mouse position, viewport center,
 * edge-drop point) would overlap, we search outward on a grid spiral and
 * return the closest position whose rect — inflated by a margin of "air" —
 * touches no other node.
 */

export interface PlacementRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PlacementSize {
  readonly width: number
  readonly height: number
}

/** Estimated footprint for a node that hasn't been measured yet (React Flow
 *  fills `measured` only after the first render). */
export const DEFAULT_PLACEMENT_SIZE: PlacementSize = { width: 280, height: 200 }

/** The placement rect of an existing canvas node: measured dimensions when
 *  available, the node's explicit width/height otherwise, then the estimate. */
export function nodeRect(node: {
  readonly position: { readonly x: number; readonly y: number }
  readonly measured?: { readonly width?: number; readonly height?: number }
  readonly width?: number
  readonly height?: number
}): PlacementRect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? DEFAULT_PLACEMENT_SIZE.width,
    height: node.measured?.height ?? node.height ?? DEFAULT_PLACEMENT_SIZE.height,
  }
}

/**
 * Horizontal gap (px) between a node and a node directly wired to it. Kept
 * EQUAL to ELK's layered between-layers spacing (`use-elk-layout` derives its
 * `elk.layered.spacing.nodeNodeBetweenLayers` option from THIS constant) so a
 * node placed by Tab auto-connect or the handle "Add new" popover lands exactly
 * where Tidy Up would put it — no jump when the user presses Tidy Up afterwards,
 * and none of the cramped 80px spacing that made fresh nodes hug their source
 * (the media cards here are 200–650px wide, so a small gap reads as overlapping).
 */
export const CONNECTED_NODE_GAP_X = 200

/**
 * Flow-space position for a NEW node being wired to a `focused` node.
 * `direction` is the focused node's handle direction relative to the new node:
 *  - `"source"`: the focused node is the SOURCE, so the new node is DOWNSTREAM
 *    and sits to the RIGHT — a {@link CONNECTED_NODE_GAP_X} gap past the focused
 *    node's right edge.
 *  - `"target"`: the focused node is the TARGET, so the new node is UPSTREAM and
 *    sits to the LEFT — we budget the new (not-yet-measured) node's own width
 *    ({@link DEFAULT_PLACEMENT_SIZE}) before the gap.
 *
 * Vertical position is anchored at the focused node's mid-height.
 */
export function connectedNodePosition(
  focused: PlacementRect,
  direction: "source" | "target",
): { x: number; y: number } {
  const offsetX =
    direction === "target"
      ? -(DEFAULT_PLACEMENT_SIZE.width + CONNECTED_NODE_GAP_X)
      : focused.width + CONNECTED_NODE_GAP_X
  return {
    x: focused.x + offsetX,
    y: focused.y + focused.height / 2,
  }
}

interface PlacementOptions {
  /** Minimum air between the new node and every existing one. */
  readonly margin?: number
  /** Grid granularity of the outward search. */
  readonly step?: number
  /** Give up beyond this Chebyshev radius and return `desired` as-is. */
  readonly maxRadius?: number
}

/**
 * The closest position to `desired` where a node of `size` keeps `margin` air
 * from every obstacle. Searches concentric square rings (`step` apart) sorted
 * by true distance, so the first free candidate is (approximately) the
 * nearest one. Falls back to `desired` when everything in range is blocked.
 */
export function findNonOverlappingPosition(
  desired: { readonly x: number; readonly y: number },
  size: PlacementSize,
  obstacles: ReadonlyArray<PlacementRect>,
  { margin = 24, step = 24, maxRadius = 2400 }: PlacementOptions = {},
): { x: number; y: number } {
  const isFree = (px: number, py: number) =>
    !obstacles.some(
      (o) =>
        px - margin < o.x + o.width &&
        px + size.width + margin > o.x &&
        py - margin < o.y + o.height &&
        py + size.height + margin > o.y,
    )

  if (isFree(desired.x, desired.y)) return { x: desired.x, y: desired.y }

  for (let r = step; r <= maxRadius; r += step) {
    // All grid points on the square ring at Chebyshev radius r…
    const candidates: Array<{ x: number; y: number; d: number }> = []
    for (let dx = -r; dx <= r; dx += step) {
      const dys = Math.abs(dx) === r
        ? Array.from({ length: Math.floor((2 * r) / step) + 1 }, (_, i) => -r + i * step)
        : [-r, r]
      for (const dy of dys) {
        candidates.push({ x: desired.x + dx, y: desired.y + dy, d: dx * dx + dy * dy })
      }
    }
    // …tried nearest-first so corners of the ring lose to its edge midpoints.
    candidates.sort((a, b) => a.d - b.d)
    for (const c of candidates) {
      if (isFree(c.x, c.y)) return { x: c.x, y: c.y }
    }
  }
  return { x: desired.x, y: desired.y }
}
