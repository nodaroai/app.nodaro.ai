/**
 * Video Overlay pricing — which row a run is charged from, and how many units
 * of it. One mapping for every place that names the price: the route
 * (`POST /v1/video-overlay`), the workflow run's reservation, the node's Run
 * button and the workflow estimates.
 *
 * An image-only run is the flat `video-overlay` row, whatever its layers or
 * the base's length; its base is never measured for the price. A run with any
 * video layer is charged the `video-overlay:video` row once per started 5
 * seconds of the output — the base's length, which is the output's — the unit
 * Mask Composite is charged by. The route and the workflow run measure the
 * base before anything is reserved, and refuse one they cannot read or one
 * past {@link VIDEO_OVERLAY_PRICING.MAX_BASE_SEC}. Before a run, a base whose
 * length is not known yet is quoted at that cap, so a quote is never below
 * what the run is charged.
 *
 * Worked examples, in units of the `video-overlay:video` row:
 *   10 s → 2,  23 s → 5,  60 s → 12,  unknown → 12,  61 s → refused.
 */
import { pricedClipSeconds } from "../priced-clip-seconds.js"
import { VIDEO_OVERLAY_VIDEO_MAX_BASE_SEC } from "../video-overlay.js"

export const VIDEO_OVERLAY_PRICING = {
  /** An image-only run: one flat row. */
  IMAGE_CREDIT_ID: "video-overlay",
  /** A run with a video layer: one row per started {@link VIDEO_OVERLAY_PRICING.UNIT_SEC} seconds of the output. */
  VIDEO_CREDIT_ID: "video-overlay:video",
  /** Seconds of output one unit of the video row covers. */
  UNIT_SEC: 5,
  /** The longest base a run with a video layer accepts, in seconds. */
  MAX_BASE_SEC: VIDEO_OVERLAY_VIDEO_MAX_BASE_SEC,
} as const

/**
 * How much longer, in seconds, the base the worker downloads may run than the
 * base measured before the run was charged, before the worker refuses it as
 * changed: a re-measure can read a hair longer (a re-encode, a container's
 * rounding), and that is not a different file. Applied to the seconds, never
 * to the units: a base billed for 10 s renders at up to 10.5 s.
 */
export const VIDEO_OVERLAY_REMEASURE_SLACK_SEC = 0.5

/** The row a run is charged from: the flat image row, or the per-5-second video row when any layer is a video. */
export function videoOverlayCreditId(hasVideoLayer: boolean): string {
  return hasVideoLayer ? VIDEO_OVERLAY_PRICING.VIDEO_CREDIT_ID : VIDEO_OVERLAY_PRICING.IMAGE_CREDIT_ID
}

/**
 * Units of the video row for a base `baseSec` long: one per started 5
 * seconds, at least one, after `pricedClipSeconds` (up to 0.05 s past a whole
 * second is ignored, so a 10.01 s base is 2 units). An unknown length counts
 * the cap — the pre-run quote for a base not measured yet — and so does a
 * length past it (such a base is refused before anything is reserved).
 */
export function videoOverlayVideoUnits(baseSec: number | null | undefined): number {
  const sec =
    typeof baseSec === "number" && Number.isFinite(baseSec) && baseSec > 0
      ? Math.min(baseSec, VIDEO_OVERLAY_PRICING.MAX_BASE_SEC)
      : VIDEO_OVERLAY_PRICING.MAX_BASE_SEC
  return Math.ceil(pricedClipSeconds(sec) / VIDEO_OVERLAY_PRICING.UNIT_SEC)
}

/**
 * Whether a measured base is past the cap for a run with a video layer. Read
 * on the priced seconds the units use, so a base the price counts as 60 s
 * (60.04 s, a whole-second cut of a 29.97 fps clip) is accepted at 12 units.
 */
export function videoOverlayBaseTooLong(baseSec: number): boolean {
  return pricedClipSeconds(baseSec) > VIDEO_OVERLAY_PRICING.MAX_BASE_SEC
}
