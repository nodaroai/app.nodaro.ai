import { memo, useRef, useCallback, type PointerEvent as ReactPointerEvent } from "react"
import { useStore } from "@xyflow/react"

export interface CustomHandleProps {
  visible: boolean
  /** "bottom-left" (default) or "bottom-right" — used by Alt-swap. */
  position?: "bottom-left" | "bottom-right"
  onDragStart: (e: ReactPointerEvent) => void
  onDragMove: (e: ReactPointerEvent) => void
  onDragEnd: (e: ReactPointerEvent) => void
  onDoubleClick?: () => void
}

const DOUBLE_CLICK_MS = 220
const DOUBLE_CLICK_MOVE_PX = 5

// Custom cursor: magnifying-glass with + above and − below in the lens.
// Browser only ships `zoom-in` / `zoom-out` (one direction each) —
// drag-to-zoom needs both. Inline SVG data URL with `(8 8)` hot spot
// at the lens center.
const ZOOM_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'><circle cx='8' cy='8' r='6.5' fill='white' stroke-width='2'/><line x1='12.5' y1='12.5' x2='20' y2='20' stroke-width='3'/><line x1='5.5' y1='6' x2='10.5' y2='6'/><line x1='8' y1='3.5' x2='8' y2='8.5'/><line x1='5.5' y1='10.5' x2='10.5' y2='10.5'/></svg>\") 8 8, zoom-in"

const CustomHandleComponent = ({
  visible, position = "bottom-left",
  onDragStart, onDragMove, onDragEnd, onDoubleClick,
}: CustomHandleProps) => {
  const lastDownRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const dragStartRef = useRef<{ x: number; y: number; active: boolean } | null>(null)
  // Match React Flow's NodeResizeControl autoScale exactly: it applies
  // `scale: max(1/viewportZoom, 1)` — keeps handle constant when zooming
  // OUT (zoom<1) but lets it grow naturally with the canvas when zooming
  // IN (zoom>1, scale clamped to 1). Plain `1/viewportZoom` would shrink
  // the magnifier at zoom>1 while the resize dot grows — visual mismatch.
  const viewportZoom = useStore((s) => s.transform[2])

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation()
    const now = performance.now()
    const last = lastDownRef.current
    if (last && (now - last.t) < DOUBLE_CLICK_MS) {
      const dx = Math.abs(e.clientX - last.x)
      const dy = Math.abs(e.clientY - last.y)
      if (dx < DOUBLE_CLICK_MOVE_PX && dy < DOUBLE_CLICK_MOVE_PX) {
        lastDownRef.current = null
        dragStartRef.current = null
        onDoubleClick?.()
        return
      }
    }
    lastDownRef.current = { t: now, x: e.clientX, y: e.clientY }
    dragStartRef.current = { x: e.clientX, y: e.clientY, active: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [onDoubleClick])

  const handlePointerMove = useCallback((e: ReactPointerEvent) => {
    const ds = dragStartRef.current
    if (!ds) return
    e.stopPropagation()
    if (!ds.active) {
      ds.active = true
      onDragStart(e)
    }
    onDragMove(e)
  }, [onDragStart, onDragMove])

  const handlePointerUp = useCallback((e: ReactPointerEvent) => {
    const ds = dragStartRef.current
    if (!ds) return
    e.stopPropagation()
    if (ds.active) onDragEnd(e)
    dragStartRef.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
  }, [onDragEnd])

  if (!visible) return null

  return (
    <div
      data-testid="zoom-handle"
      // `nodrag nopan` opts out of React Flow's node-drag and canvas-pan
      // handling, otherwise pointerdown on this handle starts dragging
      // the node instead of running our zoom gesture.
      // Sized to match the 10px resize dot so it scales identically with
      // canvas viewport zoom. Inline SVG with viewBox matching container
      // px (no internal upscaling) so strokes are crisp at any zoom.
      className="nodrag nopan absolute z-10 w-2.5 h-2.5 text-muted-foreground/70"
      style={{
        bottom: -5,
        left: position === "bottom-left" ? -5 : undefined,
        right: position === "bottom-right" ? -5 : undefined,
        cursor: ZOOM_CURSOR,
        // Match NodeResizeControl autoScale: max(1/zoom, 1). Constant size
        // at zoom<=1, grows with canvas at zoom>1 (no inverse-scale).
        scale: viewportZoom > 0 ? String(Math.max(1 / viewportZoom, 1)) : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <svg
        viewBox="0 0 10 10"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        className="pointer-events-none"
      >
        <circle cx={4} cy={4} r={3.3} />
        <line x1={6.3} y1={6.3} x2={8.5} y2={8.5} strokeWidth={1.2} />
      </svg>
    </div>
  )
}

export const CustomHandle = memo(CustomHandleComponent)
