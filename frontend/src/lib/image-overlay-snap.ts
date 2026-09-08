/**
 * Snapping for the Image Overlay preview: while a layer is dragged, its
 * predicted box (screen px) is compared with the stage's centre lines, edges
 * and the active safe area; a match within `threshold` px pulls the drag onto
 * the line and reports which guides to draw. Pure — no DOM, no React.
 */
export interface Rect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface SnapResult {
  /** Correction to add to the pointer delta (screen px). */
  readonly dx: number
  readonly dy: number
  /** Guides to draw, as FRACTIONS of the stage (0..1). */
  readonly vertical: readonly number[]
  readonly horizontal: readonly number[]
}

/**
 * @param box       the layer's box at the pointer's current position (screen px)
 * @param stage     the stage rectangle (screen px)
 * @param safe      optional safe-area rectangle inside the stage (screen px)
 * @param threshold snap distance (screen px)
 */
export function snapBox(box: Rect, stage: Rect, safe: Rect | undefined, threshold: number): SnapResult {
  const xLines = [stage.left, stage.left + stage.width / 2, stage.left + stage.width]
  const yLines = [stage.top, stage.top + stage.height / 2, stage.top + stage.height]
  if (safe) {
    xLines.push(safe.left, safe.left + safe.width)
    yLines.push(safe.top, safe.top + safe.height)
  }
  const xEdges = [box.left, box.left + box.width / 2, box.left + box.width]
  const yEdges = [box.top, box.top + box.height / 2, box.top + box.height]

  const best = (edges: number[], lines: number[]) => {
    let hit: { delta: number; line: number } | null = null
    for (const e of edges) {
      for (const l of lines) {
        const d = l - e
        if (Math.abs(d) <= threshold && (hit === null || Math.abs(d) < Math.abs(hit.delta))) hit = { delta: d, line: l }
      }
    }
    return hit
  }
  const hx = best(xEdges, xLines)
  const hy = best(yEdges, yLines)
  return {
    dx: hx?.delta ?? 0,
    dy: hy?.delta ?? 0,
    vertical: hx ? [(hx.line - stage.left) / Math.max(1, stage.width)] : [],
    horizontal: hy ? [(hy.line - stage.top) / Math.max(1, stage.height)] : [],
  }
}
