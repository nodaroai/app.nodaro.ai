/**
 * Canvas zoom math, shared by CanvasControls + the editor zoom shortcuts. Pure
 * (no React) so it's unit-testable and importable anywhere.
 */

/** React Flow zoom bounds — single source of truth, also passed to <ReactFlow
 *  minZoom/maxZoom> so the control math and the canvas always agree. */
export const ZOOM_MIN = 0.2 // 20%
export const ZOOM_MAX = 8 // 800%

/** Snap stops (as factors) that +/− and the keyboard shortcuts step through. */
export const ZOOM_SNAP_LADDER: readonly number[] = [
  25, 33, 50, 67, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500, 600, 800,
].map((pct) => pct / 100)

/** Format a zoom factor as a display percentage: ×100, rounded to one decimal,
 *  trailing ".0" dropped. 1 → "100%", 0.882 → "88.2%", 0.75 → "75%". */
export function formatZoomPercent(zoom: number): string {
  const pct = Math.round(zoom * 1000) / 10
  return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(1)}%`
}

/** Clamp a zoom factor to the canvas bounds. */
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/** Step to the next (`dir > 0`) or previous (`dir < 0`) ladder stop, clamped to
 *  the bounds. A small epsilon means stepping from exactly a stop advances to
 *  the neighbour rather than staying put. */
export function snapZoom(zoom: number, dir: number): number {
  const eps = 1e-3
  if (dir > 0) {
    const next = ZOOM_SNAP_LADDER.find((v) => v > zoom + eps)
    return clampZoom(next ?? ZOOM_MAX)
  }
  const prev = [...ZOOM_SNAP_LADDER].reverse().find((v) => v < zoom - eps)
  return clampZoom(prev ?? ZOOM_MIN)
}

/** Per-pixel scrub sensitivity. Multiplicative so the felt rate is constant
 *  across the zoom range; ~100px of vertical drag ≈ a 1.65× change. */
const SCRUB_SENSITIVITY = 0.005

/** New zoom from a vertical drag. `dyPx` is (startY − currentY) — positive when
 *  the pointer moved UP → zoom in; negative (down) → zoom out. Clamped. */
export function scrubZoom(startZoom: number, dyPx: number): number {
  return clampZoom(startZoom * Math.exp(dyPx * SCRUB_SENSITIVITY))
}

/** Parse a user-typed zoom ("120", "120%", " 88.2 ") into a clamped factor, or
 *  null when the text isn't a positive number. */
export function parseZoomInput(text: string): number | null {
  const n = parseFloat(String(text).replace("%", "").trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return clampZoom(n / 100)
}
