import { useLayoutEffect, type RefObject } from "react"

export interface UseAutoMeasureForZoomArgs {
  /**
   * The OUTER wrapper of the node (parameter-node-shell's outermost div).
   * Includes label (visual coords) + zoom-scaled body.
   */
  innerRef: RefObject<HTMLElement | null>
  /**
   * The label container (visual coords, OUTSIDE the zoom wrapper).
   * Subtracted from the outer measurement to isolate the zoom-scaled portion.
   */
  labelRef: RefObject<HTMLElement | null>
  zoom: number
  visualHeight: number | undefined
  onMeasured: (visualH: number) => void
  /** Kept for back-compat / observability. */
  triggerKey?: string
}

/**
 * When `visualHeight === undefined` (Fit Content / displayMode toggle just
 * cleared height) and `zoom != 1`, compute the natural visual height needed
 * to fit the content.
 *
 * The measurement strategy avoids two bugs that combined to grow the node
 * on every press at zoom != 1:
 *
 * 1. **h-full inheritance**: wrapperRef has `h-full` of React Flow's
 *    NodeWrapper, which doesn't actually fall back to natural sizing when
 *    `node.height = undefined` (RF uses node.measured as a fallback). To
 *    get the true natural content size, we temporarily force
 *    `height: auto !important` on wrapperRef, measure, then restore.
 *
 * 2. **Mixed coord systems**: wrapperRef contains a label (in visual
 *    canvas coords) PLUS the zoom-scaled body (whose layout box is in
 *    logical = visual / zoom coords because CSS transforms don't change
 *    layout). Naively multiplying the whole measurement by zoom over-
 *    counts the label. We split: visual = labelH + (totalNatural - labelH) × zoom.
 */
export function useAutoMeasureForZoom({
  innerRef, labelRef, zoom, visualHeight, onMeasured,
}: UseAutoMeasureForZoomArgs): void {
  useLayoutEffect(() => {
    if (zoom === 1) return
    if (visualHeight !== undefined) return
    const el = innerRef.current
    if (!el) return

    // Override h-full from className so the chain falls back to natural.
    el.style.setProperty("height", "auto", "important")
    const totalNaturalH = el.offsetHeight
    const labelH = labelRef.current?.offsetHeight ?? 0
    el.style.removeProperty("height")

    if (totalNaturalH === 0) return

    // labelH is in visual coords (no transform on the label).
    // The rest of the wrapperRef is the BaseNode body, whose CSS box height
    // equals the zoom wrapper's LOGICAL content (transform doesn't affect
    // layout box). Multiply that part by zoom to get visual.
    const bodyLogical = Math.max(0, totalNaturalH - labelH)
    const visualH = Math.round(labelH + bodyLogical * zoom)
    onMeasured(visualH)
  }, [innerRef, labelRef, zoom, visualHeight, onMeasured])
}
