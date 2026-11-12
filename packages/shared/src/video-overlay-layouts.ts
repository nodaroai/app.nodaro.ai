/**
 * Video Overlay layouts and the placed base — the request-level normaliser
 * (`expandVideoOverlayLayout`) and the geometry the canvas preview and the
 * ffmpeg worker both call, so the preview and the render cannot disagree.
 * A sibling of `video-overlay.ts`: it imports from there, nothing there imports
 * from here, and the layout ids live in the dependency-free
 * `video-overlay-layout-ids.ts`.
 *
 * - `video-bottom` / `video-top` write a base box; an explicit one wins.
 * - `pip` writes the first video layer's box in its corner.
 * - The two stacks write no box: their rects depend on the sources' shapes,
 *   known only after probing, so the worker and the preview call
 *   `resolveVideoOverlayStackRects` with them. A stack places the base
 *   itself, so the validator refuses one with a `baseBox` (`layout_conflicts_base_box`).
 * `pip` and the two stacks turn the first video layer's fade off;
 * `video-bottom` / `video-top` touch no layer. "First video layer" is the
 * lowest one (`firstVideoLayerIndex`); image layers are left where they are.
 * A probed video's aspect goes through `clampVideoOverlayAspect` before any of
 * this geometry, and a video's rect through `evenVideoOverlayRect` after it —
 * in the worker and the preview alike.
 * Wire contract only — no I/O.
 */
import {
  VIDEO_OVERLAY_BOX_FIELDS,
  expandVideoOverlayLayer,
  isVideoOverlayCorner,
  videoOverlayRenderOrder,
  type VideoOverlayBox,
  type VideoOverlayBoxInput,
  type VideoOverlayCorner,
  type VideoOverlayFit,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayOrderable,
} from "./video-overlay.js"
import { resolveVideoOverlayGeometry, type VideoOverlayCanvas, type VideoOverlayRect } from "./video-overlay-geometry.js"
import { validateVideoOverlayRequest } from "./video-overlay-validate.js"
import { isVideoOverlayVideoLayer } from "./video-overlay-video-layers.js"

/** Picture in picture: the inset's width and its margin from the corner, % of the output canvas (Speaker View's inset). */
export const VIDEO_OVERLAY_PIP_WIDTH = 30
export const VIDEO_OVERLAY_PIP_INSET = 4

/** What a layout reads and writes — a request, an assembled request, or node data. */
export interface VideoOverlayLayoutFields {
  readonly layout?: string | null
  readonly baseBox?: VideoOverlayBoxInput | null
  readonly layers?: ReadonlyArray<VideoOverlayLayerInput | null | undefined> | null
}

/** The base box each edge layout writes: the base whole, full width, flush on that edge. */
const EDGE_BASE_BOXES: { readonly [L in "video-bottom" | "video-top"]: VideoOverlayBox } = {
  "video-bottom": { anchor: "bottom", x: 0, y: 0, width: 100, fit: "contain" },
  "video-top": { anchor: "top", x: 0, y: 0, width: 100, fit: "contain" },
}

/** A base box's trailing defaults, as a layer's (`expandVideoOverlayLayer`). */
const BOX_DEFAULTS = { x: 0, y: 0, fit: "contain" } as const

/**
 * The narrowest and widest aspect a probed video is placed at. A video's
 * shape is only known from its probe, and nothing bounds a probe, so a stack
 * of a 1:1000 sliver could otherwise place a rect off the canvas. Inside these
 * bounds every stack, base and layer rect stays on it.
 */
export const VIDEO_OVERLAY_ASPECT_BOUNDS = [1 / 8, 8] as const

/** Rounded down to even, floored at 2; the epsilon absorbs float error at an exact even size (960.0000 read as 959.9999). */
const evenFloor = (n: number): number => Math.max(2, Math.floor(n / 2 + 1e-9) * 2)
const usableAspect = (a: number): number => (Number.isFinite(a) && a > 0 ? a : 1)

/**
 * A probed video's display aspect (width ÷ height), held inside
 * `VIDEO_OVERLAY_ASPECT_BOUNDS`; one that is not a positive finite number
 * reads as square, as in the layer geometry. The worker and the preview pass
 * every video's aspect (the base's and each video layer's) through this before
 * any placement, so they place the same rects.
 */
export function clampVideoOverlayAspect(aspect: number): number {
  const [min, max] = VIDEO_OVERLAY_ASPECT_BOUNDS
  return Number.isFinite(aspect) && aspect > 0 ? Math.min(max, Math.max(min, aspect)) : 1
}

/** Rounded down to an even integer, negatives included (−61 → −62). */
const floorEven = (n: number): number => Math.floor(n / 2) * 2

/**
 * A video's rect as the render draws it: left and top rounded DOWN to even,
 * and the size down to even. ffmpeg's overlay on yuv420 clears the low bit of
 * an odd x or y (a base placed at top 371 is drawn at 370), so this is where
 * the picture lands anyway; the worker hands the graph these numbers and the
 * preview draws them, so the two agree to the pixel. A stack's two rects move
 * by the same pixel (its heights are even), so its join stays exact. Applied
 * to the base's rect and to video layers only — an image layer's geometry is
 * unchanged. By reference when the rect is already even.
 */
export function evenVideoOverlayRect(rect: VideoOverlayRect): VideoOverlayRect {
  const even = { left: floorEven(rect.left), top: floorEven(rect.top), width: evenFloor(rect.width), height: evenFloor(rect.height) }
  return sameShallow(even, rect) ? rect : even
}

function sameShallow(a: object, b: object): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
}

/** The lowest video layer by `videoOverlayRenderOrder`, as its index in `layers`; -1 when there is none. */
export function firstVideoLayerIndex(
  layers: ReadonlyArray<(VideoOverlayOrderable & { readonly videoUrl?: string | null }) | null | undefined> | null | undefined,
): number {
  if (!Array.isArray(layers)) return -1
  return videoOverlayRenderOrder(layers).find((i) => isVideoOverlayVideoLayer(layers[i])) ?? -1
}

/**
 * An explicit base box with `anchor` and `width` gets the layer's trailing
 * defaults (x 0, y 0, fit contain) and loses its `null` fields; anything else
 * (a partial box, a non-object) is returned untouched for the validator. By
 * reference when nothing changes.
 */
function expandBaseBox(raw: VideoOverlayBoxInput): VideoOverlayBoxInput {
  if (typeof raw !== "object" || Array.isArray(raw) || raw.anchor == null || raw.width == null) return raw
  const out: Record<string, unknown> = { ...BOX_DEFAULTS }
  for (const [k, v] of Object.entries(raw)) if (v != null) out[k] = v
  return sameShallow(out, raw) ? raw : (out as VideoOverlayBoxInput)
}

function pipBox(corner: VideoOverlayCorner): VideoOverlayBox {
  const sx = corner.endsWith("left") ? 1 : -1
  const sy = corner.startsWith("top") ? 1 : -1
  return { anchor: corner, x: sx * VIDEO_OVERLAY_PIP_INSET, y: sy * VIDEO_OVERLAY_PIP_INSET, width: VIDEO_OVERLAY_PIP_WIDTH, fit: "contain" }
}

/**
 * The validator's per-layer verdict on this layer alone (a one-layer request
 * meets no request-level check). A layout never repairs a layer it refuses — a
 * bad or partial box, a non-boolean `animate`, two sources, a bad time or
 * volume — so the verdict is the same before and after the expansion, as
 * `expandBaseBox` leaves a partial base box for the validator.
 */
const acceptedAlone = (layer: VideoOverlayLayerInput): boolean => validateVideoOverlayRequest({ layers: [layer] }).ok

/**
 * The first video layer under `pip` or a stack, the layouts that place it:
 * `pip` replaces its box (as a preset click does: height and tag go), and each
 * of them turns its fade off. A layer the validator would refuse is returned
 * untouched.
 */
function placeFirstVideoLayer(layout: string, layer: VideoOverlayLayerInput): VideoOverlayLayerInput {
  if (!acceptedAlone(layer)) return layer
  if (layout !== "pip") return layer.animate === false ? layer : { ...layer, animate: false }
  const rest: Record<string, unknown> = { ...layer }
  for (const f of VIDEO_OVERLAY_BOX_FIELDS) delete rest[f]
  delete rest.preset
  const corner = isVideoOverlayCorner(layer.corner) ? layer.corner : "bottom-right"
  const next = expandVideoOverlayLayer({ ...rest, ...pipBox(corner), animate: false } as VideoOverlayLayerInput)
  return sameShallow(next, layer) ? layer : next
}

/**
 * The request-level normaliser: what a `layout` writes, and an explicit base
 * box's defaults. Called at the write boundaries and by the worker after the
 * validator. An explicit `baseBox` wins over `video-bottom` / `video-top`;
 * `pip` places the first video layer; the stacks write no box. An unknown
 * layout writes nothing (the validator refuses it), and neither does any
 * layout to a first video layer the validator refuses, so the verdict is the
 * same before and after. Never mutates; the request BY REFERENCE when nothing
 * changes; idempotent.
 */
export function expandVideoOverlayLayout<T extends VideoOverlayLayoutFields>(req: T): T & { readonly baseBox?: VideoOverlayBox } {
  const { layout } = req
  const baseBox =
    req.baseBox != null ? expandBaseBox(req.baseBox) : layout === "video-bottom" || layout === "video-top" ? EDGE_BASE_BOXES[layout] : req.baseBox
  let layers = req.layers
  const first = layout === "pip" || layout === "stack-whole" || layout === "stack-filled" ? firstVideoLayerIndex(req.layers) : -1
  if (first >= 0 && Array.isArray(req.layers)) {
    const layer = req.layers[first] as VideoOverlayLayerInput
    const placed = placeFirstVideoLayer(layout as string, layer)
    if (placed !== layer) layers = req.layers.map((l, i) => (i === first ? placed : l))
  }
  if (baseBox === req.baseBox && layers === req.layers) return req as T & { readonly baseBox?: VideoOverlayBox }
  // Only the changed fields: an unset one never becomes an `undefined` key.
  return {
    ...req,
    ...(baseBox !== req.baseBox ? { baseBox } : {}),
    ...(layers !== req.layers ? { layers } : {}),
  } as T & { readonly baseBox?: VideoOverlayBox }
}

/**
 * The two stacked rects, `top` for the base and `bottom` for the first video
 * layer, in output pixels.
 * - `stack-whole`: both whole, the same even width, touching, the pair centred
 *   with equal spare room above and below (±1 px). They shrink together only
 *   when both together are taller than the canvas. The join is pixel-exact.
 * - `stack-filled`: the top half (rounded down to even) and the rest, full
 *   width; the aspects are not read — both are cropped (`cover`).
 * An aspect that is not a positive finite number reads as square.
 */
export function resolveVideoOverlayStackRects(
  layout: "stack-whole" | "stack-filled",
  canvas: VideoOverlayCanvas,
  topAspect: number,
  bottomAspect: number,
): { top: VideoOverlayRect; bottom: VideoOverlayRect } {
  if (layout === "stack-filled") {
    const half = evenFloor(canvas.h / 2)
    return {
      top: { left: 0, top: 0, width: canvas.w, height: half },
      bottom: { left: 0, top: half, width: canvas.w, height: canvas.h - half },
    }
  }
  const a = usableAspect(topAspect)
  const b = usableAspect(bottomAspect)
  const total = canvas.w / a + canvas.w / b
  const width = evenFloor(total > canvas.h ? (canvas.w * canvas.h) / total : canvas.w)
  const th = evenFloor(width / a)
  const bh = evenFloor(width / b)
  const top = Math.floor((canvas.h - th - bh) / 2)
  const left = Math.floor((canvas.w - width) / 2)
  return {
    top: { left, top, width, height: th },
    bottom: { left, top: top + th, width, height: bh },
  }
}

/** A picture placed on the output canvas: its even rect and how it fills it (contain = scaled to the rect, cover = cropped to it). */
export interface VideoOverlayPlacedRect {
  readonly drawn: VideoOverlayRect
  readonly fit: VideoOverlayFit
}

/** A video layer to place. */
export interface PlacedVideoOverlayVideoInput {
  /** 0-based index in the request's layers[] (what `firstVideo` names). */
  readonly index: number
  readonly layer: Pick<VideoOverlayLayer, "anchor" | "x" | "y" | "width" | "height" | "fit">
  /** Its display aspect (width ÷ height, rotation and sample aspect resolved); held inside the bounds here. */
  readonly aspect: number
}

export interface VideoOverlayVideoPlacement {
  /** Present when the base is placed (a stack or a base box); absent = the base as before (its own size, or `outputAspect` with `baseFit`). */
  readonly basePlacement?: VideoOverlayPlacedRect
  /** Each video layer's even drawn rect and fit, by request index. */
  readonly layers: ReadonlyMap<number, VideoOverlayPlacedRect>
}

/**
 * Where the base and every video layer draw, on the output canvas — the ONE
 * placement the worker renders with and the canvas preview draws with. Every
 * aspect goes through `clampVideoOverlayAspect` and every rect through
 * `evenVideoOverlayRect` here, so neither caller can skip them.
 * - A stack (`stack-whole` / `stack-filled`): both rects from
 *   `resolveVideoOverlayStackRects` with the base's and the first video
 *   layer's aspects; that layer's stored box is not read. `stack-filled` draws
 *   both `cover`, `stack-whole` both `contain`, whatever fit is stored.
 * - Otherwise a base box (written by `video-bottom` / `video-top`, or explicit)
 *   places the base with `resolveVideoOverlayBaseRect` at its own fit.
 * - Every other video layer: its box, `resolveVideoOverlayGeometry`, at its
 *   aspect (`pip` has already written its box).
 * An image layer is not placed here: its geometry is unchanged. The caller
 * passes a stack's first video layer among `videos` (the worker refuses a
 * stack whose first video layer it does not keep). Pure.
 */
export function placeVideoOverlayVideos(input: {
  readonly canvas: VideoOverlayCanvas
  readonly layout?: string | null
  readonly baseBox?: VideoOverlayBox
  readonly baseAspect: number
  /** `firstVideoLayerIndex` of the request's layers: what a stack places under the base. */
  readonly firstVideo: number
  readonly videos: ReadonlyArray<PlacedVideoOverlayVideoInput>
}): VideoOverlayVideoPlacement {
  const { canvas, layout } = input
  const baseAspect = clampVideoOverlayAspect(input.baseAspect)
  const layers = new Map<number, VideoOverlayPlacedRect>()
  let basePlacement: VideoOverlayPlacedRect | undefined
  if (layout === "stack-whole" || layout === "stack-filled") {
    const first = input.videos.find((v) => v.index === input.firstVideo)
    if (!first) throw new Error(`placeVideoOverlayVideos: the stacked layer ${input.firstVideo} was not kept`)
    const rects = resolveVideoOverlayStackRects(layout, canvas, baseAspect, clampVideoOverlayAspect(first.aspect))
    const fit: VideoOverlayFit = layout === "stack-filled" ? "cover" : "contain"
    basePlacement = { drawn: evenVideoOverlayRect(rects.top), fit }
    layers.set(first.index, { drawn: evenVideoOverlayRect(rects.bottom), fit })
  } else if (input.baseBox) {
    basePlacement = { drawn: evenVideoOverlayRect(resolveVideoOverlayBaseRect(canvas, input.baseBox, baseAspect)), fit: input.baseBox.fit }
  }
  for (const v of input.videos) {
    if (layers.has(v.index)) continue
    const { drawn } = resolveVideoOverlayGeometry(canvas, v.layer, clampVideoOverlayAspect(v.aspect))
    layers.set(v.index, { drawn: evenVideoOverlayRect(drawn), fit: v.layer.fit })
  }
  return { ...(basePlacement ? { basePlacement } : {}), layers }
}

/**
 * Where a placed base draws, in output pixels. Its SIZE is the layer
 * geometry's drawn size (`resolveVideoOverlayGeometry`: the same clamp and even
 * rounding as an image layer); it is then placed by that drawn size against the
 * anchor, plus the x / y offsets — so a contained base sits flush on its
 * anchored edge rather than centred in a box rounded to other numbers (a 16:9
 * base at the bottom of 1080x1920 draws at y 1314–1920, with no strip under it).
 */
export function resolveVideoOverlayBaseRect(canvas: VideoOverlayCanvas, box: VideoOverlayBox, baseAspect: number): VideoOverlayRect {
  const { drawn } = resolveVideoOverlayGeometry(canvas, box, baseAspect)
  const ax = box.anchor.endsWith("left") ? 0 : box.anchor.endsWith("right") ? 1 : 0.5
  const ay = box.anchor.startsWith("top") ? 0 : box.anchor.startsWith("bottom") ? 1 : 0.5
  return {
    left: Math.round(ax * (canvas.w - drawn.width) + (box.x / 100) * canvas.w),
    top: Math.round(ay * (canvas.h - drawn.height) + (box.y / 100) * canvas.h),
    width: drawn.width,
    height: drawn.height,
  }
}
