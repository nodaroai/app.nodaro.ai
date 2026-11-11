/**
 * A Video Overlay layout turned Custom — keeping every box it wrote, as a
 * placement preset's Custom keeps its box (`toCustomVideoOverlayLayer`). A
 * layout is a tag and the boxes are the truth, but a layout writes its boxes
 * at the run (`expandVideoOverlayLayout`), not into the node: clearing the tag
 * alone would move what it placed (a pip inset back to its stored box, the
 * base back to filling the frame). So every way a layout becomes Custom —
 * choosing Custom, a drag or resize on the stage (a layer or the base), a box
 * edit on a card — stores where the render puts things first:
 *   - `video-bottom` / `video-top`: the layout's own base box, once there is
 *     an output aspect (unless an explicit one is stored — it already wins);
 *   - `pip`: the first video layer gets the pip box;
 *   - the stacks: the base and the first video layer get their stacked rects
 *     as boxes (`videoOverlayRectBox`), by the ONE placement the render uses
 *     (`placeVideoOverlayVideos`). `stack-filled`'s halves need no shape;
 *     `stack-whole`'s rects need both videos' shapes, so until both are read
 *     it is `"shapes-pending"` — nothing is stored by stand-in shapes the
 *     render never draws, and the caller waits.
 * The first video layer is read from the request the run assembles, so a
 * wired video counts; it keeps the run's timing (an untouched slot stores
 * none, and the box written beside it would otherwise leave it with no
 * `start`). When it is a layer-plan layer it has no stored slot: only the
 * base is kept. A fade the layout turned off is stored off. Pure.
 */
import {
  VIDEO_OVERLAY_BOX_FIELDS,
  expandVideoOverlayLayer,
  expandVideoOverlayLayout,
  firstVideoLayerIndex,
  isVideoOverlayLayoutId,
  isVideoOverlayOutputAspect,
  placeVideoOverlayVideos,
  videoOverlayLayoutNeedsVideoLayer,
  videoOverlayLayoutPlacesBase,
  withoutImpliedVideoOverlayAnimate,
  type VideoOverlayBoxInput,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayLayoutId,
} from "@nodaro/shared/video"
import { videoOverlayRectBox } from "./video-overlay-stage"
import type { VideoOverlayView } from "./video-overlay-view"

/** What the node stores — the fields a layout turned Custom rewrites. */
export interface VideoOverlayLayoutFields {
  readonly layout?: string | null
  readonly outputAspect?: string | null
  readonly baseBox?: VideoOverlayBoxInput | null
  readonly layers?: ReadonlyArray<VideoOverlayLayerInput | null | undefined> | null
}

/** The node-data patch a layout turned Custom writes (`layout` cleared). */
export interface VideoOverlayCustomPatch {
  readonly layout: undefined
  readonly baseBox?: VideoOverlayBoxInput
  readonly layers?: Array<VideoOverlayLayerInput | null>
}

/** A layout turned Custom: the patch, or — for a stack whose shapes are not read yet — not yet. */
export type VideoOverlayLayoutCustom = VideoOverlayCustomPatch | "shapes-pending"

const BOX_FIELDS: ReadonlySet<string> = new Set(VIDEO_OVERLAY_BOX_FIELDS)

function boxOf(layer: VideoOverlayLayerInput): VideoOverlayBoxInput {
  return Object.fromEntries(VIDEO_OVERLAY_BOX_FIELDS.flatMap((f) => (layer[f] != null ? [[f, layer[f]]] : []))) as VideoOverlayBoxInput
}

type CustomView = Pick<VideoOverlayView, "request" | "canvas" | "baseAspect" | "aspectOf">

/**
 * The patch that turns the node's layout Custom with nothing moving; null when
 * it has no layout; `"shapes-pending"` for a `stack-whole` whose base or
 * first video layer has not been read yet. `wiredSlots` (0-based) are the
 * slots whose handle has a wire: their stored layer keeps only a fade it was
 * written with (`withoutImpliedVideoOverlayAnimate`), as every canvas write does.
 */
export function videoOverlayLayoutAsCustom(data: VideoOverlayLayoutFields, view: CustomView, wiredSlots: ReadonlySet<number>): VideoOverlayLayoutCustom | null {
  const stored = typeof data.layout === "string" ? data.layout : ""
  if (stored === "") return null
  // An unknown layout writes nothing (the validator refuses it): only the tag goes.
  if (!isVideoOverlayLayoutId(stored)) return { layout: undefined }
  const layout: VideoOverlayLayoutId = stored
  const { request } = view
  const aspect = isVideoOverlayOutputAspect(data.outputAspect)
  const first = firstVideoLayerIndex(request.layers)
  const firstLayer = first >= 0 ? request.layers[first] : undefined

  // Where the layout puts the base and the first video layer, as the render does.
  let baseBox: VideoOverlayBoxInput | undefined
  let placed: VideoOverlayBoxInput | undefined
  if (videoOverlayLayoutPlacesBase(layout)) {
    // A stack with no output aspect or no video layer is refused: it places nothing to keep.
    if (aspect && firstLayer) {
      const stacked = stackRects(layout, view, first, firstLayer)
      if (stacked === "shapes-pending") return stacked
      if (data.baseBox == null) baseBox = stacked.base
      placed = stacked.layer
    }
  } else {
    const expanded = expandVideoOverlayLayout({ layout, baseBox: data.baseBox ?? undefined, layers: request.layers })
    if (data.baseBox == null && aspect && expanded.baseBox != null) baseBox = expanded.baseBox
    if (layout === "pip" && first >= 0) placed = boxOf(expanded.layers![first] as VideoOverlayLayer)
  }

  let layers: Array<VideoOverlayLayerInput | null> | undefined
  const slot = firstLayer?.slot
  if (slot !== undefined && placed && videoOverlayLayoutNeedsVideoLayer(layout)) {
    const own = Array.isArray(data.layers) ? data.layers : []
    const index = slot - 1
    layers = Array.from({ length: Math.max(own.length, index + 1) }, (_, k) => own[k] ?? null)
    layers[index] = placedSlot(own[index], placed, firstLayer!, wiredSlots.has(index))
  }
  return { layout: undefined, ...(baseBox ? { baseBox } : {}), ...(layers ? { layers } : {}) }
}

/**
 * A stack's two rects as boxes, by the render's own placement. `stack-filled`
 * reads no shape; `stack-whole` needs the base's and the first video layer's.
 */
function stackRects(
  layout: VideoOverlayLayoutId,
  view: CustomView,
  first: number,
  layer: VideoOverlayLayer,
): { base: VideoOverlayBoxInput; layer: VideoOverlayBoxInput } | "shapes-pending" {
  const whole = layout === "stack-whole"
  const layerAspect = whole && layer.videoUrl ? view.aspectOf(layer.videoUrl) : 1
  const baseAspect = whole ? view.baseAspect : 1
  if (baseAspect === undefined || layerAspect === undefined) return "shapes-pending"
  const placement = placeVideoOverlayVideos({ canvas: view.canvas, layout, baseAspect, firstVideo: first, videos: [{ index: first, layer, aspect: layerAspect }] })
  return { base: videoOverlayRectBox(placement.basePlacement!.drawn, view.canvas), layer: videoOverlayRectBox(placement.layers.get(first)!.drawn, view.canvas) }
}

/**
 * The first video layer's stored layer, placed: its own settings as the run
 * reads them (the stored layer expanded — an untouched slot is the default
 * layer, start 0 — never a fade the expansion implied), its box and preset
 * tag replaced by `box`, and the run's `start` when it stores none. A fade the
 * layout turned off is stored off.
 */
function placedSlot(raw: VideoOverlayLayerInput | null | undefined, box: VideoOverlayBoxInput, run: VideoOverlayLayer, wired: boolean): VideoOverlayLayerInput {
  const own: VideoOverlayLayerInput = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  const expanded = expandVideoOverlayLayer(own)
  const kept = Object.fromEntries(
    Object.entries(expanded).filter(([k]) => k !== "preset" && k !== "animate" && !BOX_FIELDS.has(k)),
  ) as VideoOverlayLayerInput
  // Every layout that places the first video layer holds its fade off: a fade it was written with is kept off.
  const fade = own.animate != null ? { animate: false } : {}
  const written: VideoOverlayLayerInput = { ...kept, ...(kept.start == null ? { start: run.start } : {}), ...box, ...fade }
  const next = expandVideoOverlayLayer(written)
  return wired ? withoutImpliedVideoOverlayAnimate(next, written) : next
}
