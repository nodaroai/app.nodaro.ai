/**
 * The drag math of a box with 8 handles: move it, pull an edge (free ratio),
 * pull a corner (the box keeps the ratio it had when the drag began), and keep
 * it inside its bounds and above a minimum size.
 *
 * Shared by the media editor's `CropPanel` (display pixels) and Speaker View's
 * region editor (fractions of the camera frame). Pure: the caller owns the
 * pointer and the units. `CropPanel`'s tests pin this behaviour.
 */
import type { CSSProperties } from "react"

export type RectHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w"
export type RectDrag = "move" | RectHandle

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A handle's on-screen size in px (slightly larger for touch). */
export const RECT_HANDLE_SIZE = 16

const H = RECT_HANDLE_SIZE / 2

/** The 8 handles: where each sits on the box's border, and its cursor. */
export const RECT_HANDLES: ReadonlyArray<{ readonly type: RectHandle; readonly style: CSSProperties; readonly cursor: string }> = [
  { type: "nw", style: { top: -H, left: -H }, cursor: "nw-resize" },
  { type: "ne", style: { top: -H, right: -H }, cursor: "ne-resize" },
  { type: "sw", style: { bottom: -H, left: -H }, cursor: "sw-resize" },
  { type: "se", style: { bottom: -H, right: -H }, cursor: "se-resize" },
  { type: "n", style: { top: -H, left: "50%", marginLeft: -H }, cursor: "n-resize" },
  { type: "s", style: { bottom: -H, left: "50%", marginLeft: -H }, cursor: "s-resize" },
  { type: "e", style: { top: "50%", right: -H, marginTop: -H }, cursor: "e-resize" },
  { type: "w", style: { top: "50%", left: -H, marginTop: -H }, cursor: "w-resize" },
]

export const isCornerHandle = (type: RectDrag | null): boolean => type === "nw" || type === "ne" || type === "sw" || type === "se"
export const isEdgeHandle = (type: RectDrag | null): boolean => type === "n" || type === "s" || type === "e" || type === "w"

/** The box a drag of `type` by (dx, dy) makes of `start`, before any clamp. */
export function dragRect<T extends Rect>(start: T, type: RectDrag, dx: number, dy: number): T {
  if (type === "move") return { ...start, x: start.x + dx, y: start.y + dy }
  let nx = start.x, ny = start.y, nw = start.width, nh = start.height
  if (type.includes("e")) nw = start.width + dx
  if (type.includes("w")) { nx = start.x + dx; nw = start.width - dx }
  if (type.includes("s")) nh = start.height + dy
  if (type.includes("n")) { ny = start.y + dy; nh = start.height - dy }
  return { ...start, x: nx, y: ny, width: nw, height: nh }
}

export interface ClampRectOptions {
  /** The smallest width and height. */
  readonly minWidth: number
  readonly minHeight: number
  /** width / height to enforce (shrinking the longer side), or null for free. */
  readonly ratio: number | null
}

/**
 * `r` fitted to `ratio` (when given), sized between the minimum and the
 * bounds, then moved inside the bounds. Bounds of zero leave `r` as it is.
 */
export function clampRect<T extends Rect>(r: T, bounds: { readonly width: number; readonly height: number }, opts: ClampRectOptions): T {
  let { x, y, width, height } = r
  const maxW = bounds.width
  const maxH = bounds.height
  if (maxW <= 0 || maxH <= 0) return r
  if (opts.ratio !== null) {
    if (width / height > opts.ratio) {
      width = height * opts.ratio
    } else {
      height = width / opts.ratio
    }
  }
  width = Math.max(opts.minWidth, Math.min(width, maxW))
  height = Math.max(opts.minHeight, Math.min(height, maxH))
  x = Math.max(0, Math.min(x, maxW - width))
  y = Math.max(0, Math.min(y, maxH - height))
  return { ...r, x, y, width, height }
}

/** The pointer position of a mouse or touch event. */
export function eventClientXY(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ("touches" in e) {
    const t = e.touches[0] ?? e.changedTouches[0]
    return { x: t.clientX, y: t.clientY }
  }
  return { x: e.clientX, y: e.clientY }
}
