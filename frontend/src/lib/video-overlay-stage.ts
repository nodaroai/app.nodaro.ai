/**
 * Where the Video Overlay node's live stage draws each picture — pure, so the
 * preview cannot draw anything the render would put elsewhere (the one thing it
 * must never do is disagree with the render about where something sits):
 *   - a layout's boxes are written by the expansion the worker runs
 *     (`expandVideoOverlayLayout`: pip's corner, a stack's fade off, an edge
 *     layout's base box);
 *   - the base (when a stack or a base box places it) and every video layer
 *     through the worker's own placement (`placeVideoOverlayVideos`, with its
 *     aspect clamp and even rects);
 *   - every image layer through the unchanged layer geometry.
 * Anything the render would refuse to place — a partial or out-of-range box,
 * a stack with no video layer or with a base box, a layout or base box without
 * an output aspect, a base whose shape is not known yet — is drawn as before
 * (the base filling the stage, the layer skipped), never thrown: a throw here
 * would take the whole canvas down. The validator's verdict on the Run button
 * says what is wrong.
 */
import {
  VIDEO_OVERLAY_BOUNDS,
  evenVideoOverlayRect,
  expandVideoOverlayLayout,
  firstVideoLayerIndex,
  hasDrawableVideoOverlayBox,
  isVideoOverlayLayoutId,
  isVideoOverlayOutputAspect,
  placeVideoOverlayVideos,
  resolveVideoOverlayBaseRect,
  resolveVideoOverlayGeometry,
  videoOverlayLayoutPlacesBase,
  videoOverlayRenderOrder,
  type PlacedVideoOverlayVideoInput,
  type VideoOverlayBox,
  type VideoOverlayBoxInput,
  type VideoOverlayCanvas,
  type VideoOverlayFit,
  type VideoOverlayLayer,
  type VideoOverlayPlacedRect,
  type VideoOverlayRect,
} from "@nodaro/shared/video"
import { videoOverlayEffectiveBaseBox, videoOverlayFitBaseBox } from "./video-overlay-base-box"

export interface VideoOverlayStageInput {
  /** The output canvas the render draws onto (`videoOverlayCanvas`). */
  readonly canvas: VideoOverlayCanvas
  readonly outputAspect?: string | null
  /** As stored (`""` / null = none). */
  readonly layout?: string | null
  /** As stored; a partial one draws the base as before. */
  readonly baseBox?: VideoOverlayBoxInput | null
  /** As stored: where Video fit puts a base no box places. */
  readonly baseFit?: string | null
  /** The base video's display aspect (width ÷ height); undefined while not known. */
  readonly baseAspect?: number
  /** The wired plan's expanded layers, each with its own source. */
  readonly planLayers: ReadonlyArray<VideoOverlayLayer>
  /** Per slot, the expanded layer as the run assembles it: a wired video carries `videoUrl`. */
  readonly layers: ReadonlyArray<VideoOverlayLayer | undefined>
  /** Per slot, the file it draws (undefined = nothing to draw). */
  readonly sources: ReadonlyArray<string | undefined>
  /** A drawn picture's natural aspect by its URL; undefined until it loads (read as square). */
  readonly aspectOf: (url: string) => number | undefined
}

export interface VideoOverlayStageItem {
  readonly url: string
  readonly video: boolean
  /**
   * The layer as the render reads it (a layout's box written in: pip's corner,
   * and for a stacked layer its rect as a box, `videoOverlayRectBox`) — what a
   * drag starts from, and what a layout turned Custom stores.
   */
  readonly layer: VideoOverlayLayer
  /** Where it draws on the output canvas; undefined when it cannot be placed. */
  readonly drawn?: VideoOverlayRect
  readonly fit: VideoOverlayFit
}

/**
 * The base as the stage lets it be moved: the box a move starts from, the box
 * a resize starts from, and where it draws. A stored box or an edge layout's
 * is both. Otherwise (Video fit, or a partial stored box the stage draws as
 * Video fit) the base has no box of its own yet: a move starts from its drawn
 * rect as a box (`videoOverlayRectBox`, so the first edit moves nothing but
 * what is dragged), a resize from a centred box as wide as it is drawn, with
 * no height — the whole picture, keeping its shape as it scales (Video fit
 * centres the base).
 */
export interface VideoOverlayBaseFrame {
  readonly box: VideoOverlayBox
  readonly resizeBox: VideoOverlayBox
  readonly drawn: VideoOverlayRect
}

export interface VideoOverlayStage {
  /** Where the base draws when a stack or a base box places it; undefined = filling the stage as before. */
  readonly base?: VideoOverlayPlacedRect
  /**
   * The base as a drag moves it: its box (the stored or an edge layout's box,
   * a stack's rect as a box, else Video fit's whole frame) and where it draws.
   * Undefined when it cannot be moved: no output aspect (a base box needs one),
   * its shape not read yet, or a stack whose first video layer's shape is not
   * read yet (its rects would change once it is), or a stack the run refuses.
   */
  readonly baseFrame?: VideoOverlayBaseFrame
  /** By entry — the plan's layers first, then the slots; undefined = nothing to draw. */
  readonly items: ReadonlyArray<VideoOverlayStageItem | undefined>
  /** Every entry, bottom to top (the worker's render order). */
  readonly order: readonly number[]
  /** The entry a stack places under the base (its shape is needed even when it is not live), or -1. */
  readonly stacked: number
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0

/** A percentage of the canvas, to 4 decimals (well under a pixel on any canvas), inside a box field's bounds. */
const pctOf = (px: number, total: number, [min, max]: readonly [number, number]): number =>
  Math.min(max, Math.max(min, Math.round((px / total) * 1_000_000) / 10_000))

/**
 * A rect on the output canvas as a box: anchored top-left, offset and sized in
 * % of the canvas, `cover` — so the box IS the drawn rect, through the layer
 * geometry and the base placement alike (to the pixel). How a stack's rects
 * are stored when its layout is turned Custom, and the frame a drag on a
 * stacked layer starts from.
 */
export function videoOverlayRectBox(rect: VideoOverlayRect, canvas: VideoOverlayCanvas): VideoOverlayBox {
  return {
    anchor: "top-left",
    x: pctOf(rect.left, canvas.w, VIDEO_OVERLAY_BOUNDS.x),
    y: pctOf(rect.top, canvas.h, VIDEO_OVERLAY_BOUNDS.y),
    width: pctOf(rect.width, canvas.w, VIDEO_OVERLAY_BOUNDS.width),
    height: pctOf(rect.height, canvas.h, VIDEO_OVERLAY_BOUNDS.height),
    fit: "cover",
  }
}
/** The stacks — the layouts that place the base themselves. */
const isStack = (layout: string | null | undefined): boolean => isVideoOverlayLayoutId(layout) && videoOverlayLayoutPlacesBase(layout)

export function resolveVideoOverlayStage(input: VideoOverlayStageInput): VideoOverlayStage {
  const { canvas, planLayers } = input
  const planCount = planLayers.length
  // Each entry at its OWN position (plan layer i + 1, slot i + 1), whatever a
  // JSON writer stored — the engine assemblies stamp the same.
  const raw: Array<{ layer: VideoOverlayLayer; url: string; video: boolean } | undefined> = [
    ...planLayers.map((l) => {
      const video = nonEmpty(l.videoUrl)
      const url = video ? l.videoUrl : l.imageUrl
      return nonEmpty(url) ? { layer: l, url, video } : undefined
    }),
    ...input.layers.map((l, i) => {
      const url = input.sources[i]
      return l && nonEmpty(url) ? { layer: l, url, video: nonEmpty(l.videoUrl) } : undefined
    }),
  ]
  const stamped = raw.map((e, k) =>
    e ? ({ ...e.layer, ...(e.video ? { videoUrl: e.url } : {}), ...(k < planCount ? { planLayer: k + 1 } : { slot: k - planCount + 1 }) } as VideoOverlayLayer) : null,
  )
  const order = videoOverlayRenderOrder([
    ...planLayers.map((l, i) => ({ zIndex: l.zIndex, planLayer: i + 1 })),
    ...input.layers.map((l, i) => ({ zIndex: l?.zIndex, slot: i + 1 })),
  ])

  // What the layout writes, by the worker's own expansion.
  const layout = input.layout || undefined
  const expanded = expandVideoOverlayLayout({ layout, baseBox: input.baseBox ?? undefined, layers: stamped })
  const layers = (expanded.layers ?? stamped) as ReadonlyArray<VideoOverlayLayer | null>
  const first = firstVideoLayerIndex(layers)

  const placeable = isVideoOverlayOutputAspect(input.outputAspect) && input.baseAspect !== undefined
  const stacked = placeable && isStack(layout) && first >= 0 && input.baseBox == null ? first : -1
  const baseBox = placeable && !isStack(layout) && expanded.baseBox != null && hasDrawableVideoOverlayBox(expanded.baseBox) ? (expanded.baseBox as VideoOverlayBox) : undefined

  const aspect = (url: string) => input.aspectOf(url) ?? 1
  const videos: PlacedVideoOverlayVideoInput[] = []
  raw.forEach((e, k) => {
    const layer = layers[k]
    if (e?.video && layer && (k === stacked || hasDrawableVideoOverlayBox(layer))) videos.push({ index: k, layer, aspect: aspect(e.url) })
  })
  const placement = placeVideoOverlayVideos({
    canvas,
    layout: stacked >= 0 ? layout : undefined,
    ...(baseBox ? { baseBox } : {}),
    baseAspect: input.baseAspect ?? 1,
    firstVideo: stacked,
    videos,
  })

  const items = raw.map((e, k): VideoOverlayStageItem | undefined => {
    const layer = layers[k]
    if (!e || !layer) return undefined
    if (e.video) {
      const placed = placement.layers.get(k)
      // A stacked layer's own box is not read: the stack's rect is its box.
      const shown = k === stacked && placed ? ({ ...withoutPreset(layer), ...videoOverlayRectBox(placed.drawn, canvas) } as VideoOverlayLayer) : layer
      return { url: e.url, video: true, layer: shown, fit: placed?.fit ?? layer.fit, ...(placed ? { drawn: placed.drawn } : {}) }
    }
    const drawn = hasDrawableVideoOverlayBox(layer) ? resolveVideoOverlayGeometry(canvas, layer, aspect(e.url)).drawn : undefined
    return { url: e.url, video: false, layer, fit: layer.fit, ...(drawn ? { drawn } : {}) }
  })

  const baseFrame = resolveBaseFrame(input, layout, stacked, placement.basePlacement, layers[first]?.videoUrl)
  return { ...(placement.basePlacement ? { base: placement.basePlacement } : {}), ...(baseFrame ? { baseFrame } : {}), items, order, stacked }
}

function resolveBaseFrame(
  input: VideoOverlayStageInput,
  layout: string | undefined,
  stacked: number,
  placed: VideoOverlayPlacedRect | undefined,
  firstVideoUrl: string | undefined,
): VideoOverlayBaseFrame | undefined {
  const { canvas, baseAspect } = input
  if (!isVideoOverlayOutputAspect(input.outputAspect) || baseAspect === undefined) return undefined
  if (isStack(layout)) {
    // A stack-whole's rects follow its clip's shape: until that is read the stage's stand-in would move.
    const pending = layout === "stack-whole" && (!firstVideoUrl || input.aspectOf(firstVideoUrl) === undefined)
    if (stacked < 0 || !placed || pending) return undefined
    const box = videoOverlayRectBox(placed.drawn, canvas)
    return { box, resizeBox: box, drawn: placed.drawn }
  }
  // A box of its own — stored and whole, or an edge layout's — draws where it says.
  if (placed) {
    const own = videoOverlayEffectiveBaseBox({ outputAspect: input.outputAspect, layout, baseBox: input.baseBox, baseFit: input.baseFit })
    return own ? { box: own, resizeBox: own, drawn: placed.drawn } : undefined
  }
  // Video fit places it (or a partial stored box, drawn as Video fit draws).
  const drawn = evenVideoOverlayRect(resolveVideoOverlayBaseRect(canvas, videoOverlayFitBaseBox(input.baseFit), baseAspect))
  const box = videoOverlayRectBox(drawn, canvas)
  // Video fit centres the base, so its resize box is centred too, as wide as it is drawn, with no height.
  return { box, resizeBox: { anchor: "center", x: 0, y: 0, width: box.width, fit: "contain" }, drawn }
}

function withoutPreset(layer: VideoOverlayLayer): VideoOverlayLayer {
  const { preset: _tag, ...rest } = layer
  return rest as VideoOverlayLayer
}
