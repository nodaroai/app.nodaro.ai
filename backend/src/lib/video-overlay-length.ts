import { VIDEO_OVERLAY_PRICING, videoOverlayVideoUnits } from "@nodaro/shared/credits"
import { expandVideoOverlayLayout, expandVideoOverlayPresets, videoOverlayHasVideoLayer, type VideoOverlayLayerInput } from "@nodaro/shared/video"
import { probeVideoOverlayBaseSource } from "../providers/video/ffmpeg-utils.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { videoOverlayRefusalAtLength, type VideoOverlayLengthRefusalCode } from "./video-overlay-refusal.js"

/**
 * Video Overlay with a video layer: how long the output is (the base's
 * length), and so how many pricing units a run is charged — one
 * `video-overlay:video` row per started 5 seconds (`videoOverlayVideoUnits`).
 * One rule for both places such a run starts — the route's preHandler
 * (`POST /v1/video-overlay`) and the workflow run (node-executor) — so it costs
 * the same wherever it runs. The row is read from `model_pricing`, so an
 * administrator's retune reaches every unit. An image-only run is never
 * measured: it is the flat `video-overlay` row, as before.
 *
 * Refused before anything is reserved: a base that cannot be read (the worker
 * must decode it, so it would fail there anyway, after the reservation), one
 * past the cap, and a request the length makes impossible
 * (`videoOverlayRefusalAtLength`). The length is read by the worker's own probe
 * on the link (`probeVideoOverlayBaseSource`: cover pictures skipped, the
 * video stream's length) — what the render follows. The measured units ride
 * the queue payload as `billedUnits`, and the worker refuses a base that has
 * grown past them since (`videoOverlayRefusalForCharge`).
 */

export type VideoOverlayLength =
  | { readonly ok: true; readonly durationSec: number; readonly units: number }
  | {
      readonly ok: false
      readonly code: "invalid_media_duration" | VideoOverlayLengthRefusalCode
      readonly message: string
    }

/** What a request carries that the measurement reads. */
export interface VideoOverlayMeasuredRequest {
  readonly videoUrl: string
  readonly layers: ReadonlyArray<VideoOverlayLayerInput>
  readonly layout?: string | null
}

/** Measure the base of a request with a video layer, and what its length decides. */
export async function measureVideoOverlayBase(request: VideoOverlayMeasuredRequest): Promise<VideoOverlayLength> {
  let durationSec: number
  try {
    durationSec = (await probeVideoOverlayBaseSource(request.videoUrl)).streamDurationSec
  } catch {
    return {
      ok: false,
      code: "invalid_media_duration",
      message: "Could not read the base video. The file may be corrupted or an unsupported format.",
    }
  }
  // The layers as the worker reads them: presets, then the layout's boxes.
  const expanded = expandVideoOverlayLayout({ layout: request.layout, layers: expandVideoOverlayPresets(request.layers) })
  const refusal = videoOverlayRefusalAtLength(expanded, durationSec)
  if (refusal) return { ok: false, ...refusal }
  return { ok: true, durationSec, units: videoOverlayVideoUnits(durationSec) }
}

/** BASE credits for `units` pricing units: the `video-overlay:video` row (one unit) times the count (`unitRateBaseCredits`). */
export async function videoOverlayBaseCredits(units: number): Promise<number> {
  return unitRateBaseCredits(VIDEO_OVERLAY_PRICING.VIDEO_CREDIT_ID, Math.max(1, units))
}

/** The layers of an untrusted payload, for the video-layer test. */
function layersOf(payload: Readonly<Record<string, unknown>>): ReadonlyArray<VideoOverlayLayerInput> {
  return Array.isArray(payload.layers) ? (payload.layers as VideoOverlayLayerInput[]) : []
}

/**
 * The workflow run's twin of the route's preHandler: measures the base of a
 * video-overlay payload with a video layer and stamps `billedUnits` (what the
 * reservation charges, see `videoOverlayReserveUnits`). Run BEFORE writing
 * input_data. Returns the route's refusal for a base it would refuse;
 * undefined otherwise, and for an image-only run or any other job, whose
 * payload is left untouched.
 */
export async function stampVideoOverlayLength(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "video-overlay" || !videoOverlayHasVideoLayer(layersOf(payload))) return undefined
  const measured = await measureVideoOverlayBase({
    videoUrl: typeof payload.videoUrl === "string" ? payload.videoUrl : "",
    layers: layersOf(payload),
    layout: typeof payload.layout === "string" ? payload.layout : undefined,
  })
  if (!measured.ok) return { code: measured.code, message: measured.message }
  payload.billedUnits = measured.units
  return undefined
}

/** The units a stamped video-overlay payload reserves; undefined for an image-only run and any other job. */
export function videoOverlayReserveUnits(jobName: string, payload: Readonly<Record<string, unknown>>): number | undefined {
  return jobName === "video-overlay" && typeof payload.billedUnits === "number" ? payload.billedUnits : undefined
}

/** The row a stamped video-overlay payload reserves on (the video row); undefined otherwise — the payload's own id stands. */
export function videoOverlayReserveId(jobName: string, payload: Readonly<Record<string, unknown>>): string | undefined {
  return videoOverlayReserveUnits(jobName, payload) === undefined ? undefined : VIDEO_OVERLAY_PRICING.VIDEO_CREDIT_ID
}
