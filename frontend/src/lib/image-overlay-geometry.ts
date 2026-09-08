/**
 * Image Overlay placement math — the CANVAS twin of
 * backend/src/providers/image/overlay.ts (resolveOverlayGeometry), kept in
 * lockstep by lib/__tests__/image-overlay-geometry.test.ts, which pins the same
 * numbers the backend suite pins. The live preview in the node draws with
 * this, the worker renders with the backend copy; if they disagree the
 * preview lies, so every rule here mirrors the server one:
 *
 *   width%  → px of the BASE width; height follows the layer's aspect unless
 *             height% (of the BASE height) is set;
 *   anchor  → one of nine points on the base; x/y are ADDITIVE offsets in %
 *             of the base width/height (so a drag is a plain delta);
 *   rotation is around the layer's own centre (the box is not enlarged here —
 *   CSS rotates the element in place, sharp re-centres the grown bitmap).
 */
import { OVERLAY_ANCHORS, type OverlayAnchor, type OverlayLayerConfig } from "@/types/nodes"

/** Mirrors the backend raster cap (MAX_LAYER_EDGE): a layer box never exceeds this on either axis. */
export const OVERLAY_MAX_LAYER_EDGE = 8192

export interface OverlayBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export function resolveOverlayGeometry(
  base: { w: number; h: number },
  layer: Pick<OverlayLayerConfig, "anchor" | "x" | "y" | "width" | "height">,
  layerAspect: number,
): OverlayBox {
  const aspect = Number.isFinite(layerAspect) && layerAspect > 0 ? layerAspect : 1
  const rawWidth = Math.max(1, Math.round((layer.width / 100) * base.w))
  const rawHeight = Math.max(1, Math.round(layer.height !== undefined ? (layer.height / 100) * base.h : rawWidth / aspect))
  const shrink = Math.min(1, OVERLAY_MAX_LAYER_EDGE / Math.max(rawWidth, rawHeight))
  const width = Math.max(1, Math.round(rawWidth * shrink))
  const height = Math.max(1, Math.round(rawHeight * shrink))
  const [ax, ay] = anchorPoint(layer.anchor)
  const left = Math.round(ax * (base.w - width) + (layer.x / 100) * base.w)
  const top = Math.round(ay * (base.h - height) + (layer.y / 100) * base.h)
  return { left, top, width, height }
}

/** 0 / 0.5 / 1 factors along each axis for the nine anchors. */
function anchorPoint(anchor: OverlayAnchor): readonly [number, number] {
  switch (anchor) {
    case "top-left": return [0, 0]
    case "top": return [0.5, 0]
    case "top-right": return [1, 0]
    case "left": return [0, 0.5]
    case "center": return [0.5, 0.5]
    case "right": return [1, 0.5]
    case "bottom-left": return [0, 1]
    case "bottom": return [0.5, 1]
    case "bottom-right": return [1, 1]
    default: return [0.5, 0.5]
  }
}

/** Render order: explicit zIndex wins, ties keep handle order (layer 1 lowest). */
export function overlayRenderOrder<T extends { zIndex?: number }>(layers: ReadonlyArray<T>): number[] {
  return layers
    .map((l, i) => ({ i, z: typeof l.zIndex === "number" && Number.isFinite(l.zIndex) ? l.zIndex : i }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((e) => e.i)
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)

/**
 * Canvas twin of the backend's resolveLayer: a layer read from workflow JSON
 * (MCP, import, a hand edit) is clamped into the route's bounds before the
 * preview draws it, so the preview cannot show a 500%-wide layer the run
 * renders at 100%.
 */
export function normalizeOverlayLayer(raw: Partial<OverlayLayerConfig> | undefined): OverlayLayerConfig {
  const r = raw ?? {}
  const anchor = (OVERLAY_ANCHORS as readonly string[]).includes(String(r.anchor)) ? (r.anchor as OverlayAnchor) : "center"
  const blend = r.blend === "multiply" || r.blend === "screen" ? r.blend : "over"
  const fit = r.fit === "cover" || r.fit === "stretch" ? r.fit : "contain"
  return {
    ...r,
    anchor,
    x: clamp(num(r.x, 0), -100, 100),
    y: clamp(num(r.y, 0), -100, 100),
    width: clamp(num(r.width, 25), 1, 100),
    height: r.height === undefined || r.height === null ? undefined : clamp(num(r.height, 25), 1, 100),
    opacity: clamp(num(r.opacity, 1), 0, 1),
    rotation: clamp(num(r.rotation, 0), -180, 180),
    blend,
    fit,
    roundedCorners: r.roundedCorners === undefined ? undefined : clamp(Math.round(num(r.roundedCorners, 0)), 0, 500),
    zIndex: r.zIndex === undefined || r.zIndex === null ? undefined : clamp(Math.round(num(r.zIndex, 0)), 0, 100),
  }
}

/** Clamp a preview edit into the same bounds the route's Zod enforces. */
export function clampOverlayEdit(patch: Partial<OverlayLayerConfig>): Partial<OverlayLayerConfig> {
  const out: Partial<OverlayLayerConfig> = { ...patch }
  if (out.x !== undefined) out.x = clamp(Math.round(out.x * 10) / 10, -100, 100)
  if (out.y !== undefined) out.y = clamp(Math.round(out.y * 10) / 10, -100, 100)
  if (out.width !== undefined) out.width = clamp(Math.round(out.width * 10) / 10, 1, 100)
  if (out.height !== undefined) out.height = clamp(Math.round(out.height * 10) / 10, 1, 100)
  if (out.rotation !== undefined) {
    let r = Math.round(out.rotation)
    while (r > 180) r -= 360
    while (r < -180) r += 360
    out.rotation = r
  }
  if (out.opacity !== undefined) out.opacity = clamp(Math.round(out.opacity * 100) / 100, 0, 1)
  return out
}
