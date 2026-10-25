/**
 * Topaz Labs upscalers on Replicate (moved off KIE 2026-10-25, whose Topaz
 * lanes had stopped working for both video and image).
 *
 * - `topazlabs/video-upscale` — input `video`, `target_resolution`
 *   ("720p" | "1080p" | "4k", the frame's short side) and `target_fps`
 *   (15–60, frames it has to add are interpolated). Delivers HEVC 10-bit; the
 *   worker's delivery transcodes it to browser-safe H.264.
 * - `topazlabs/image-upscale` — input `image`, `upscale_factor`
 *   ("None" | "2x" | "4x" | "6x"), `output_format` ("jpg" | "png": PNG up
 *   to 24 MP out, JPG above).
 *
 * Both bill in Topaz units, reported per prediction as
 * `metrics.unspecified_billing_metric`. The units are returned as
 * `billedUnits` (the video lane is charged by them) and priced into
 * `provider_cost` at the per-unit rates below.
 */
import {
  resolveTopazVideoTarget,
  type TopazVideoResolution,
} from "@nodaro/shared/models"
import type {
  ProviderOptions,
  ProviderResult,
  ReconcileOpts,
  VideoUpscaleRequest,
} from "../provider.interface.js"
import { probeVideoSource } from "../video/ffmpeg-utils.js"
import { ensureImageForProvider } from "../kie/video.js"
import { probeImageDisplaySize } from "../../lib/image-source-size.js"
import { extractUrl, runReplicatePrediction } from "./client.js"
import { topazBilledUnits } from "./topaz-units.js"

export { topazBilledUnits }

export const TOPAZ_VIDEO_REPLICATE_MODEL = "topazlabs/video-upscale"
export const TOPAZ_IMAGE_REPLICATE_MODEL = "topazlabs/image-upscale"

/** USD per Topaz unit as Replicate bills them (replicate.com model pages, measured 2026-10-25). */
const VIDEO_USD_PER_UNIT = 0.08
const IMAGE_USD_PER_UNIT = 0.05


export interface TopazVideoRun {
  resolution: TopazVideoResolution
  fps: number
}

/**
 * The target a run renders at. A request that already names both a resolution
 * and a frame rate (the route and the workflow run resolve it before they price
 * it) is taken as sent; anything else — a legacy factor, "same as source" —
 * reads the source's size and rate first.
 */
export async function resolveTopazVideoRun(videoUrl: string, request: VideoUpscaleRequest = {}): Promise<TopazVideoRun> {
  const complete = request.targetResolution !== undefined && request.targetFps !== undefined
  const source = complete ? undefined : await probeVideoSource(videoUrl).catch((err) => {
    console.warn(`[replicate:topaz-video] source probe failed (${err instanceof Error ? err.message : String(err)}); using defaults`)
    return undefined
  })
  const target = resolveTopazVideoTarget({
    targetResolution: request.targetResolution,
    targetFps: request.targetFps,
    upscaleFactor: request.upscaleFactor,
    source,
  })
  if (target.adjustments.length > 0) {
    console.log(`[replicate:topaz-video] ${target.adjustments.join("; ")}`)
  }
  return { resolution: target.resolution, fps: target.fps }
}

export async function runTopazVideoUpscale(
  videoUrl: string,
  request: VideoUpscaleRequest | undefined,
  _options?: ProviderOptions,
  reconcileOpts?: ReconcileOpts,
): Promise<ProviderResult> {
  const run = await resolveTopazVideoRun(videoUrl, request)
  const started = Date.now()
  const { output, metrics } = await runReplicatePrediction({
    model: TOPAZ_VIDEO_REPLICATE_MODEL,
    input: { video: videoUrl, target_resolution: run.resolution, target_fps: run.fps },
    label: "[replicate:topaz-video]",
    reconcileOpts,
  })
  const url = extractUrl(Array.isArray(output) ? output[0] : output)
  const billedUnits = topazBilledUnits(metrics)
  const predictTime = typeof metrics?.predict_time === "number" ? metrics.predict_time : undefined
  console.log(
    `[replicate:topaz-video] ${run.resolution} @ ${run.fps} fps → ${url} (units: ${billedUnits ?? "n/a"})`,
  )
  return {
    url,
    cost: billedUnits !== undefined ? billedUnits * VIDEO_USD_PER_UNIT : null,
    ...(billedUnits !== undefined ? { billedUnits } : {}),
    providerMs: predictTime !== undefined ? Math.round(predictTime * 1000) : Date.now() - started,
  }
}

/** Replicate's `upscale_factor` for our 1/2/4 factor ("1" = enhance at the same size). */
const IMAGE_FACTOR_WIRE: Readonly<Record<string, string>> = { "1": "None", "2": "2x", "4": "4x" }

/** Outputs up to this many megapixels come back as PNG; larger ones as JPG (decided 2026-10-25). */
export const TOPAZ_IMAGE_PNG_MAX_MP = 24

/**
 * PNG (lossless — an upscale never spends detail on a JPEG pass, and the
 * identity plate's 2× gate compares exact pixels) up to
 * {@link TOPAZ_IMAGE_PNG_MAX_MP}; JPG above, where a PNG runs to 100 MB+.
 * An image whose size cannot be read stays PNG.
 */
export async function topazImageOutputFormat(imageUrl: string, factor: number): Promise<"png" | "jpg"> {
  const size = await probeImageDisplaySize(imageUrl)
  if (!size) return "png"
  return (size.width * factor * size.height * factor) / 1e6 > TOPAZ_IMAGE_PNG_MAX_MP ? "jpg" : "png"
}

export async function runTopazImageUpscale(
  imageUrl: string,
  extraParams?: Record<string, unknown>,
  reconcileOpts?: ReconcileOpts,
): Promise<ProviderResult> {
  const factor = String(extraParams?.upscale_factor ?? "2")
  const wireFactor = IMAGE_FACTOR_WIRE[factor] ?? "2x"
  // Same input chokepoint the KIE lane used: an AVIF/HEIC upload is re-encoded
  // losslessly, and the pixel grid is never moved — the identity plate's 2×
  // alignment gate compares the result with the SOURCE bytes.
  const source = await ensureImageForProvider(imageUrl, "topaz-image-upscale", {
    acceptedFormats: new Set(["jpeg", "png", "webp"]),
    context: "Image upscale",
    preferLossless: true,
    preserveGeometry: true,
  })
  const outputFormat = await topazImageOutputFormat(source, Number(factor) || 2)
  const started = Date.now()
  const { output, metrics } = await runReplicatePrediction({
    model: TOPAZ_IMAGE_REPLICATE_MODEL,
    input: { image: source, upscale_factor: wireFactor, output_format: outputFormat },
    label: "[replicate:topaz-image]",
    reconcileOpts,
  })
  const url = extractUrl(Array.isArray(output) ? output[0] : output)
  const billedUnits = topazBilledUnits(metrics)
  const predictTime = typeof metrics?.predict_time === "number" ? metrics.predict_time : undefined
  console.log(`[replicate:topaz-image] ${wireFactor} ${outputFormat} → ${url} (units: ${billedUnits ?? "n/a"})`)
  return {
    url,
    cost: billedUnits !== undefined ? billedUnits * IMAGE_USD_PER_UNIT : null,
    ...(billedUnits !== undefined ? { billedUnits } : {}),
    providerMs: predictTime !== undefined ? Math.round(predictTime * 1000) : Date.now() - started,
  }
}
