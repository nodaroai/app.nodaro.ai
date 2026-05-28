export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.0
export const ZOOM_PER_PIXEL = 0.005

export const SNAP_THRESHOLD = 0.05
export const TEAR_AWAY_THRESHOLD = 0.08

export const VISUAL_FLOOR_PX = 100

export interface Point {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** Snap to 1.0 within ±5%; require ±8% movement to leave once snapped. */
export function applyMagnet(zoomT: number, zoomAtDragStart: number): number {
  const wasSnapped = Math.abs(zoomAtDragStart - 1.0) < SNAP_THRESHOLD
  const threshold = wasSnapped ? TEAR_AWAY_THRESHOLD : SNAP_THRESHOLD
  return Math.abs(zoomT - 1.0) < threshold ? 1.0 : zoomT
}

/**
 * Compute new zoom from drag delta. Direction is "drag away from the opposite
 * corner to grow":
 *   - bottom-left handle: drag DOWN-LEFT to grow, UP-RIGHT to shrink
 *   - bottom-right handle (Alt-swapped): drag DOWN-RIGHT to grow, UP-LEFT to shrink
 *
 * Y axis behaves the same for both (bottom corners → drag down grows). Only
 * the X axis sign flips based on which corner.
 */
export function computeZoomFromDrag(
  zoom0: number,
  start: Point,
  now: Point,
  position: "bottom-left" | "bottom-right" = "bottom-left",
  min: number = ZOOM_MIN,
  max: number = ZOOM_MAX,
): number {
  const xDelta = position === "bottom-left" ? (start.x - now.x) : (now.x - start.x)
  const yDelta = now.y - start.y
  return clamp(zoom0 + (xDelta + yDelta) * ZOOM_PER_PIXEL, min, max)
}

/** Visual = round(logical × zoom), with VISUAL_FLOOR_PX hard floor. */
export function computeVisualSize(logical: Size, zoom: number): Size {
  return {
    w: Math.max(VISUAL_FLOOR_PX, Math.round(logical.w * zoom)),
    h: Math.max(VISUAL_FLOOR_PX, Math.round(logical.h * zoom)),
  }
}
