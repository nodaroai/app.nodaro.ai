/**
 * Flat-shape vocabulary for Image Overlay shape layers, and the ONE geometry
 * both renderers draw: the server serialises the element to SVG for sharp,
 * the editor renders the same element in an inline <svg> — so the stage shows
 * exactly the shape the run produces. Every shape fills its w × h box.
 */

export const OVERLAY_SHAPES = [
  "rect",
  "rounded",
  "pill",
  "circle",
  "ribbon",
  "triangle",
  "diamond",
  "hexagon",
  "star",
  "burst",
  "arrow",
] as const
export type OverlayShape = (typeof OVERLAY_SHAPES)[number]

export interface OverlayShapeElement {
  readonly tag: "rect" | "ellipse" | "polygon"
  /** Plain SVG attributes (already valid React props too: rx, cx, points…). */
  readonly attrs: Readonly<Record<string, number | string>>
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function points(list: ReadonlyArray<readonly [number, number]>): string {
  return list.map(([x, y]) => `${round(x)},${round(y)}`).join(" ")
}

/** A radial polygon: `n` outer points at (rx, ry), an inner point between each at `inner` × radius. */
function radial(cx: number, cy: number, rx: number, ry: number, n: number, inner: number): string {
  const pts: Array<readonly [number, number]> = []
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n
    const f = i % 2 === 0 ? 1 : inner
    pts.push([cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f])
  }
  return points(pts)
}

/**
 * The element for `shape` inside a w × h box. `inset` keeps a stroke inside
 * the box (pass half the stroke width); geometry is identical for inset 0.
 */
export function overlayShapeElement(shape: OverlayShape, w: number, h: number, inset = 0): OverlayShapeElement {
  const i = Math.max(0, inset)
  const iw = Math.max(0, w - 2 * i)
  const ih = Math.max(0, h - 2 * i)
  const cx = w / 2
  const cy = h / 2
  switch (shape) {
    case "rounded":
      return { tag: "rect", attrs: { x: i, y: i, width: iw, height: ih, rx: round(Math.min(iw, ih) * 0.18) } }
    case "pill":
      return { tag: "rect", attrs: { x: i, y: i, width: iw, height: ih, rx: round(ih / 2) } }
    case "circle":
      return { tag: "ellipse", attrs: { cx, cy, rx: round(iw / 2), ry: round(ih / 2) } }
    case "ribbon": {
      // A banner with notched ends — the "50% OFF" strip.
      const notch = Math.min(w / 4, h / 2)
      return { tag: "polygon", attrs: { points: points([[i, i], [w - i, i], [w - notch, cy], [w - i, h - i], [i, h - i], [notch, cy]]) } }
    }
    case "triangle":
      return { tag: "polygon", attrs: { points: points([[cx, i], [w - i, h - i], [i, h - i]]) } }
    case "diamond":
      return { tag: "polygon", attrs: { points: points([[cx, i], [w - i, cy], [cx, h - i], [i, cy]]) } }
    case "hexagon":
      return { tag: "polygon", attrs: { points: points([[w * 0.25, i], [w * 0.75, i], [w - i, cy], [w * 0.75, h - i], [w * 0.25, h - i], [i, cy]]) } }
    case "star":
      return { tag: "polygon", attrs: { points: radial(cx, cy, iw / 2, ih / 2, 5, 0.42) } }
    case "burst":
      return { tag: "polygon", attrs: { points: radial(cx, cy, iw / 2, ih / 2, 14, 0.82) } }
    case "arrow":
      // Right-pointing: a shaft half the box tall, a head on the last 40 %.
      return {
        tag: "polygon",
        attrs: { points: points([[i, h * 0.25], [w * 0.6, h * 0.25], [w * 0.6, i], [w - i, cy], [w * 0.6, h - i], [w * 0.6, h * 0.75], [i, h * 0.75]]) },
      }
    default:
      return { tag: "rect", attrs: { x: i, y: i, width: iw, height: ih } }
  }
}
