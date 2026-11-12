/**
 * What a Video Overlay node runs and draws, from its stored settings and its
 * wires — ONE derivation for the node (its stage and its Run button), the
 * panel (its cards and checks) and the layers writer (a layout turned
 * Custom), so none of them can read a wire's kind or a layout's boxes
 * differently from the others or from the run.
 *   - the request: the ONE assembly both engines run, with the wires the run
 *     reads (a wired video is a video layer; a wired image skips a stored sound);
 *   - per slot, the layer the stage draws and where (`resolveVideoOverlayStage`).
 * Pure.
 */
import {
  assembleVideoOverlayRequest,
  expandVideoOverlayLayer,
  videoOverlayCanvas,
  videoOverlaySlotSources,
  type ExpandedVideoOverlayRequest,
  type VideoOverlayCanvas,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayNodeFields,
} from "@nodaro/shared/video"
import { resolveVideoOverlayStage, type VideoOverlayStage } from "./video-overlay-stage"

/** The wires a view reads (`VideoOverlayUpstream`). */
export interface VideoOverlayWires {
  readonly base?: string
  readonly layers: ReadonlyArray<string | undefined>
  readonly wiredVideoSlots: ReadonlySet<number>
  readonly plan?: string
}

/** The node's request as the run assembles it. */
export function assembleVideoOverlayNode(data: VideoOverlayNodeFields, wires: VideoOverlayWires): ExpandedVideoOverlayRequest {
  return assembleVideoOverlayRequest({
    videoUrl: wires.base ?? "",
    data,
    wiredImageUrls: wires.layers,
    wiredVideoSlots: wires.wiredVideoSlots,
    planLayers: wires.plan,
  })
}

/** What the stage draws per slot: the layer as the run assembles it (the default badge for an untouched wired slot), and its file — none for a slot the run drops. */
export interface VideoOverlaySlotStage {
  readonly layers: ReadonlyArray<VideoOverlayLayer>
  readonly sources: ReadonlyArray<string | undefined>
  /** The wired plan's expanded layers, drawn under the slots. */
  readonly planLayers: ReadonlyArray<VideoOverlayLayer>
}

export function videoOverlaySlotStage(
  layers: ReadonlyArray<VideoOverlayLayerInput | null | undefined>,
  wired: ReadonlyArray<string | undefined>,
  request: ExpandedVideoOverlayRequest,
): VideoOverlaySlotStage {
  const sources = videoOverlaySlotSources(layers, wired)
  const bySlot = new Map(request.layers.flatMap((l) => (l.slot !== undefined ? [[l.slot, l] as const] : [])))
  return {
    layers: sources.map((_, i) => bySlot.get(i + 1) ?? expandVideoOverlayLayer(layers[i])),
    sources: sources.map((_, i) => {
      const l = bySlot.get(i + 1)
      return l ? l.videoUrl || l.imageUrl : undefined
    }),
    planLayers: request.layers.filter((l) => l.planLayer !== undefined),
  }
}

/** The stage's canvas: the output aspect's, else the base's display size, else 1920×1080 until it is known — as the preview draws. */
export function videoOverlayStageCanvas(baseDisplay: { readonly width: number; readonly height: number } | null | undefined, outputAspect: string | null | undefined): VideoOverlayCanvas {
  return videoOverlayCanvas(baseDisplay, outputAspect) ?? { w: 1920, h: 1080 }
}

/** Everything a view reads besides the stored settings and the wires. */
export interface VideoOverlayViewMedia {
  /** The base's display size when known (the probe): the canvas without an output aspect. */
  readonly baseDisplay?: { readonly width: number; readonly height: number } | null
  /** The base's aspect as the stage read it, when known; else the display size's. */
  readonly baseAspect?: number
  /** A drawn picture's natural aspect by its URL; undefined until it is known. */
  readonly aspectOf: (url: string) => number | undefined
}

export interface VideoOverlayView {
  readonly request: ExpandedVideoOverlayRequest
  readonly slots: VideoOverlaySlotStage
  readonly canvas: VideoOverlayCanvas
  readonly stage: VideoOverlayStage
  /** The base's aspect the stage placed it by; undefined while it is not known. */
  readonly baseAspect?: number
  /** Each picture's aspect the stage read; undefined until it is known. */
  readonly aspectOf: (url: string) => number | undefined
}

/** The request, the per-slot stage and where everything draws — what the preview shows for these settings, wires and media. */
export function resolveVideoOverlayView(
  data: VideoOverlayNodeFields,
  wires: VideoOverlayWires,
  media: VideoOverlayViewMedia,
): VideoOverlayView {
  const request = assembleVideoOverlayNode(data, wires)
  const layers = Array.isArray(data.layers) ? data.layers : []
  const slots = videoOverlaySlotStage(layers, wires.layers, request)
  const display = media.baseDisplay && media.baseDisplay.width > 0 && media.baseDisplay.height > 0 ? media.baseDisplay : undefined
  const canvas = videoOverlayStageCanvas(display, data.outputAspect)
  const baseAspect = media.baseAspect ?? (display ? display.width / display.height : undefined)
  const stage = resolveVideoOverlayStage({
    canvas,
    outputAspect: data.outputAspect,
    layout: data.layout,
    baseBox: data.baseBox,
    baseFit: data.baseFit,
    ...(baseAspect !== undefined ? { baseAspect } : {}),
    planLayers: slots.planLayers,
    layers: slots.layers,
    sources: slots.sources,
    aspectOf: media.aspectOf,
  })
  return { request, slots, canvas, stage, ...(baseAspect !== undefined ? { baseAspect } : {}), aspectOf: media.aspectOf }
}

/**
 * The media a view of a node reads, from what the canvas knows: the base's
 * probed display size (trusted only for the URL wired now) and the shapes the
 * stage read (`useVideoOverlayAspectStore`), the base's included.
 */
export function videoOverlayViewMedia(
  probedVideo: { readonly url: string; readonly width?: number; readonly height?: number } | null | undefined,
  base: string | undefined,
  aspects: Readonly<Record<string, number>>,
): VideoOverlayViewMedia {
  const probed = probedVideo && base && probedVideo.url === base ? probedVideo : undefined
  const baseAspect = base ? aspects[base] : undefined
  return {
    baseDisplay: probed?.width && probed.height ? { width: probed.width, height: probed.height } : null,
    ...(baseAspect !== undefined ? { baseAspect } : {}),
    aspectOf: (url) => aspects[url],
  }
}
