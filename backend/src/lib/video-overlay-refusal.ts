import { VIDEO_OVERLAY_PRICING, VIDEO_OVERLAY_REMEASURE_SLACK_SEC, videoOverlayBaseTooLong, videoOverlayVideoUnits } from "@nodaro/shared/credits"
import { pricedClipSeconds } from "@nodaro/shared/media"
import { firstVideoLayerIndex, videoOverlayHasVideoLayer, videoOverlayLayerLabel, type VideoOverlayLayer } from "@nodaro/shared/video"

/**
 * Video Overlay: the refusals the base's length decides, before any layer is
 * fetched — ONE rule for the three places that know the length: the route's
 * preHandler and the workflow run (both before anything is reserved, through
 * `measureVideoOverlayBase`) and the worker (the last net, after its own
 * probe). Pure: no I/O.
 *
 *  - `video_overlay_too_long`: a run with a video layer takes a base of at
 *    most `VIDEO_OVERLAY_PRICING.MAX_BASE_SEC` (on the priced seconds,
 *    `videoOverlayBaseTooLong`). An image-only run has no cap here.
 *  - `video_overlay_starts_after_end`: every layer starts at or after the end
 *    (the render would have nothing to draw), or a stack's first video layer
 *    does (the stack would have nothing to stack). Any other layer past the end
 *    is skipped by the render and reported in its warnings, as before.
 */
export type VideoOverlayLengthRefusalCode = "video_overlay_too_long" | "video_overlay_starts_after_end"

/** The shortest length the charge check reads: a base this short is one unit. */
const MIN_POSITIVE_SEC = 0.001

/** The worker's refusal of a run priced for a shorter base than the one it renders. */
export type VideoOverlayChargeRefusalCode = "video_overlay_base_changed"

export interface VideoOverlayLengthRefusal {
  readonly code: VideoOverlayLengthRefusalCode
  readonly message: string
}

/** What the base's length decides about a request — its layers with their presets and layout already written — or undefined. */
export function videoOverlayRefusalAtLength(
  request: { readonly layers: ReadonlyArray<VideoOverlayLayer>; readonly layout?: string | null },
  durationSec: number,
): VideoOverlayLengthRefusal | undefined {
  const { layers, layout } = request
  if (videoOverlayHasVideoLayer(layers) && videoOverlayBaseTooLong(durationSec)) {
    return {
      code: "video_overlay_too_long",
      message: `The base video is ${pricedClipSeconds(durationSec)} seconds. A Video Overlay with a video layer takes a base of up to ${VIDEO_OVERLAY_PRICING.MAX_BASE_SEC} seconds — trim it first.`,
    }
  }
  const end = `${durationSec.toFixed(2)} s`
  if (layers.length > 0 && layers.every((l) => l.start >= durationSec)) {
    return { code: "video_overlay_starts_after_end", message: `Every layer starts after the video ends (${end})` }
  }
  if (layout !== "stack-whole" && layout !== "stack-filled") return undefined
  const first = firstVideoLayerIndex(layers)
  const layer = first >= 0 ? layers[first] : undefined
  if (!layer || layer.start < durationSec) return undefined
  const ref = { layer: first, ...(layer.slot !== undefined ? { slot: layer.slot } : {}), ...(layer.planLayer !== undefined ? { planLayer: layer.planLayer } : {}) }
  return {
    code: "video_overlay_starts_after_end",
    message: `${videoOverlayLayerLabel(ref)}: the stacked video starts at ${layer.start} s, after the video ends (${end})`,
  }
}


/**
 * The worker's check that a run with a video layer was priced for the base it
 * renders: `billedUnits` is the units the route or the workflow run measured
 * and charged — server-written onto the queue payload, never a client's field.
 * A base that has grown past them since (a link that served a short file to
 * the price probe and a long one to the download) is refused before anything
 * is fetched, and refunded; so is a run with a video layer that carries no
 * priced units. A re-measure up to `VIDEO_OVERLAY_REMEASURE_SLACK_SEC` longer
 * is the same file (the slack is taken off the seconds, not the units). An
 * image-only run is never checked: its price never read the base. Lengths in
 * the message are the priced seconds, the rounding the price uses.
 */
export function videoOverlayRefusalForCharge(
  layers: ReadonlyArray<VideoOverlayLayer>,
  billedUnits: unknown,
  durationSec: number,
): { readonly code: VideoOverlayChargeRefusalCode; readonly message: string } | undefined {
  if (!videoOverlayHasVideoLayer(layers)) return undefined
  if (typeof billedUnits !== "number" || !Number.isFinite(billedUnits) || billedUnits < 1) {
    return { code: "video_overlay_base_changed", message: "This run was not priced for a video layer — run it again" }
  }
  // Never at or below 0: `videoOverlayVideoUnits` reads that as "not known" (the cap).
  const remeasured = Math.max(durationSec - VIDEO_OVERLAY_REMEASURE_SLACK_SEC, MIN_POSITIVE_SEC)
  if (videoOverlayVideoUnits(remeasured) <= billedUnits) return undefined
  return {
    code: "video_overlay_base_changed",
    message: `The base video is ${pricedClipSeconds(durationSec)} seconds, longer than the ${billedUnits * VIDEO_OVERLAY_PRICING.UNIT_SEC} seconds this run was priced for — run it again`,
  }
}
