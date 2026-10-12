/**
 * Where everything stands on the office floor. Pure geometry, so the world
 * only draws and the arithmetic is tested.
 *
 * A cluster sits at a curved desk: up to nine screens per row, extra rows on
 * poles above. Clusters are packed in rows across the floor, largest first,
 * each kept clear of its neighbours by its rug and props; the single desks of
 * unlinked accounts fill a grid in front of them.
 */

/** Orthographic frustum height in world units — the scale every zoom is computed against. */
export const FRUSTUM = 42
export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 5
/** The rug plus the props beside the desk, past the screen arc. */
const FOOTPRINT_MARGIN = 2.6
const GAP = 2.4
/** Clusters wrap to a new row past this width. */
const ROW_WIDTH = 96
export const SINGLE_COLS = 9
export const SINGLE_SPACING = 4.6

export interface DeskShape {
  /** Screens per row. */
  readonly per: number
  readonly rows: number
  /** Arc radius. */
  readonly r: number
}

export function deskShape(n: number): DeskShape {
  const count = Math.max(1, n)
  const per = count <= 5 ? count : count <= 12 ? Math.ceil(count / 2) : SINGLE_COLS
  return { per, rows: Math.ceil(count / per), r: Math.max(2.8, (per * 1.78) / 1.9) }
}

export const footprint = (n: number): number => deskShape(n).r + FOOTPRINT_MARGIN

/** The zoom a selected cluster flies to: its whole desk in view. */
export function clusterZoom(r: number): number {
  return Math.min(3.2, Math.max(1.3, FRUSTUM / ((r + 3) * 2.2)))
}

export const accountZoom = (current: number): number => Math.max(current, 2.6)

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

export interface FloorLayout {
  /** Each cluster's centre, by key. */
  readonly clusters: ReadonlyMap<string, { readonly x: number; readonly z: number }>
  /** The first single desk; the grid runs +x by column and +z by row. */
  readonly singles: { readonly x0: number; readonly z0: number }
  /** The floor rectangle that holds everything. */
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
}

export function layoutFloor(
  clusters: ReadonlyArray<{ readonly key: string; readonly drawn: number }>,
  singleCount: number,
): FloorLayout {
  const placed = new Map<string, { x: number; z: number }>()
  const left = -ROW_WIDTH / 2
  let x = left
  let z = 0
  let rowDepth = 0
  for (const c of clusters) {
    const R = footprint(c.drawn)
    if (x > left && x + 2 * R > ROW_WIDTH / 2) {
      x = left
      z += rowDepth + GAP
      rowDepth = 0
    }
    placed.set(c.key, { x: x + R, z: z + R })
    x += 2 * R + GAP
    rowDepth = Math.max(rowDepth, 2 * R)
  }
  const clustersEnd = clusters.length ? z + rowDepth : 0
  const singleRows = Math.ceil(singleCount / SINGLE_COLS)
  const singles = { x0: -((SINGLE_COLS - 1) * SINGLE_SPACING) / 2, z0: clustersEnd + (clusters.length ? 6 : 2) }
  const singlesEnd = singleRows ? singles.z0 + (singleRows - 1) * SINGLE_SPACING + 3 : clustersEnd
  const maxX = Math.max(ROW_WIDTH / 2, ...[...placed.values()].map((p) => p.x + 6))
  const bounds = { minX: left - 6, maxX: maxX + 6, minZ: -6, maxZ: Math.max(singlesEnd, clustersEnd) + 6 }
  // Centre the whole floor on the origin, so the home view frames it.
  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  return {
    clusters: new Map([...placed].map(([k, p]) => [k, { x: p.x - cx, z: p.z - cz }])),
    singles: { x0: singles.x0 - cx, z0: singles.z0 - cz },
    bounds: { minX: bounds.minX - cx, maxX: bounds.maxX - cx, minZ: bounds.minZ - cz, maxZ: bounds.maxZ - cz },
  }
}

/** The single desk at index i. */
export function singleDesk(layout: FloorLayout, i: number): { x: number; z: number } {
  return {
    x: layout.singles.x0 + (i % SINGLE_COLS) * SINGLE_SPACING,
    z: layout.singles.z0 + Math.floor(i / SINGLE_COLS) * SINGLE_SPACING,
  }
}

/**
 * The zoom at which a w × d floor fills the view from the home angle (azimuth
 * 45°, polar ≈ 0.95): its diagonal runs across the screen, foreshortened in
 * depth.
 */
export function fitZoom(w: number, d: number, aspect: number): number {
  const across = (w + d) / Math.SQRT2
  const deep = across * Math.cos(0.95) + 4
  return clampZoom(Math.min((FRUSTUM * aspect) / across, FRUSTUM / deep) * 0.92)
}
