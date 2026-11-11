/**
 * The base's length cap a run with a video layer takes, as the canvas warns
 * of it before a run. SHOW-ONLY: the route and the workflow run measure the
 * real file and refuse past the cap before anything is charged — they decide,
 * so the canvas never blocks a run on a length it only reads from the graph.
 * The rule is the server's own (`videoOverlayBaseTooLong`, on the priced
 * seconds: a 60.04 s base is accepted); the length is the one the price reads
 * (`videoOverlayWireBaseSec`, before the price's cap). Every other limit —
 * more than 2 video layers included — is the shared validator's, exact, and
 * blocks Run.
 */
import { VIDEO_OVERLAY_PRICING, videoOverlayBaseTooLong } from "@nodaro/shared/credits"
import { pricedClipSeconds } from "@nodaro/shared/media"
import { videoOverlayHasVideoLayer, type VideoOverlayValidationInput } from "@nodaro/shared/video"

/** A base past the cap for a run with a video layer: the cap and the base's priced length, in seconds. */
export interface VideoOverlayLengthWarning {
  readonly max: number
  readonly d: number
}

/** The cap's warning, or undefined when the length is not known, no layer is a video, or the base is within the cap. */
export function videoOverlayLengthWarning(
  layers: VideoOverlayValidationInput["layers"],
  baseSec: number | null | undefined,
): VideoOverlayLengthWarning | undefined {
  if (typeof baseSec !== "number" || !Number.isFinite(baseSec) || !videoOverlayHasVideoLayer(layers)) return undefined
  if (!videoOverlayBaseTooLong(baseSec)) return undefined
  return { max: VIDEO_OVERLAY_PRICING.MAX_BASE_SEC, d: pricedClipSeconds(baseSec) }
}
