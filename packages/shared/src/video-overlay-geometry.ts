/**
 * Video Overlay — placement: the output canvas and where a layer's box lands
 * on it. `resolveVideoOverlayGeometry` is the one placement function the
 * canvas preview and the ffmpeg worker both call. A sibling of
 * `video-overlay.ts`, which it imports from; nothing there imports this file.
 * Wire contract only — no I/O.
 */
import type { OverlayAnchor } from "./image-overlay-layers.js"
import { ASPECT_RATIO_DIMENSIONS } from "./model-constants.js"
import { isVideoOverlayOutputAspect, type VideoOverlayLayer } from "./video-overlay.js"

export interface VideoOverlayRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}
export interface VideoOverlayCanvas {
  readonly w: number
  readonly h: number
}
export interface VideoOverlayGeometry {
  readonly box: VideoOverlayRect
  readonly drawn: VideoOverlayRect
}

const evenFloor = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

/**
 * The output canvas: `ASPECT_RATIO_DIMENSIONS[outputAspect]` when a target
 * aspect is set; otherwise the base's DISPLAY size (rotation already applied by
 * the caller's probe) with the sample aspect ratio resolved and both sides
 * rounded down to even — `trunc(iw*sar/2)*2 × trunc(ih/2)*2`, what the ffmpeg
 * base chain produces. null when neither is known.
 */
export function videoOverlayCanvas(
  display: { readonly width: number; readonly height: number; readonly sar?: number } | null | undefined,
  outputAspect?: string | null,
): VideoOverlayCanvas | null {
  if (isVideoOverlayOutputAspect(outputAspect)) {
    const d = ASPECT_RATIO_DIMENSIONS[outputAspect]!
    return { w: d.width, h: d.height }
  }
  if (!display || !(display.width > 0) || !(display.height > 0)) return null
  const sar = typeof display.sar === "number" && Number.isFinite(display.sar) && display.sar > 0 ? display.sar : 1
  return { w: evenFloor(display.width * sar), h: evenFloor(display.height) }
}

function anchorFactors(anchor: OverlayAnchor): readonly [number, number] {
  const h = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? 1 : 0.5
  const v = anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? 1 : 0.5
  return [h, v]
}

/**
 * Spec §3.4. `width%` → px of the canvas width; height follows the image's
 * aspect unless `height%` is set; nine anchors; x/y are additive offsets in %
 * of the canvas. An aspect-following box taller than the canvas is fitted
 * inside it (both sides scaled, aspect kept) — so `drawn` never exceeds the
 * canvas, which is what bounds the sharp pre-fit at one canvas of RGBA. `fit`:
 * contain → the image scaled inside the box, centred; cover → the box itself.
 * The only post-processing is rounding `drawn` DOWN to even, floored at 2 × 2.
 * Differences from Image Overlay's copies (on purpose): no 8192 edge shrink,
 * the canvas clamp, the even rounding.
 */
export function resolveVideoOverlayGeometry(
  canvas: VideoOverlayCanvas,
  layer: Pick<VideoOverlayLayer, "anchor" | "x" | "y" | "width" | "height" | "fit">,
  imageAspect: number,
): VideoOverlayGeometry {
  const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1
  let bw = Math.max(1, Math.round((layer.width / 100) * canvas.w))
  let bh = layer.height !== undefined ? Math.max(1, Math.round((layer.height / 100) * canvas.h)) : Math.max(1, Math.round(bw / aspect))
  if (layer.height === undefined && bh > canvas.h) {
    bw = Math.max(1, Math.round(bw * (canvas.h / bh)))
    bh = canvas.h
  }
  const [ax, ay] = anchorFactors(layer.anchor)
  const left = Math.round(ax * (canvas.w - bw) + (layer.x / 100) * canvas.w)
  const top = Math.round(ay * (canvas.h - bh) + (layer.y / 100) * canvas.h)
  let dw: number
  let dh: number
  if (layer.fit === "cover") {
    dw = bw
    dh = bh
  } else if (bw / bh > aspect) {
    dh = bh
    dw = bh * aspect
  } else {
    dw = bw
    dh = bw / aspect
  }
  const width = evenFloor(dw)
  const height = evenFloor(dh)
  return {
    box: { left, top, width: bw, height: bh },
    drawn: { left: left + Math.floor((bw - width) / 2), top: top + Math.floor((bh - height) / 2), width, height },
  }
}
