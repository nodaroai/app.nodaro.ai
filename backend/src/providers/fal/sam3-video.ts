/**
 * fal.ai SAM 3 / SAM 3.1 video segmentation — text-prompted, per-frame masks.
 *
 * Endpoints `fal-ai/sam-3/video-rle` and `fal-ai/sam-3-1/video-rle` (same
 * request and answer; 3.1 tracks several objects per pass, measured 4.2 min
 * against 6.8 min for 1,800 frames of 1080p). Verified 2026-10-12 against live runs
 * (the published schema lists a `video` File output; the endpoint actually
 * answers `{ rle: string[], metadata, scores, boxes, boundingbox_frames_zip }`):
 *   - `rle[i]` is frame i's mask, "" when nothing matched on that frame;
 *   - each string is space-separated (start, length) pairs over the frame's
 *     pixels in ROW-MAJOR order with a ONE-BASED start (start = y·width + x + 1
 *     — see `decodeMaskRle`), union of every object the prompt matched;
 *   - `apply_mask: true` is REQUIRED for a usable mask: with `false` the same
 *     clip tracked only one object and dropped the first 59 of 90 frames,
 *     reproducibly, on both `sam-3/video` and `sam-3-1/video`. With `true` the
 *     RLE matched the masked-video output on 99.3 % of pixels.
 *
 * The request is NOT registered with the reconcile cron: a finished request is
 * an RLE the worker renders locally, which the generic fal finalize cannot do.
 * A worker crash re-runs the job on its BullMQ retry; the pre-task sweep is the
 * backstop (the `voiced-video` pattern).
 */

import { runFalRequest } from "./client.js"
import { falCostUsd } from "./pricing.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

import type { VideoMaskProvider } from "@nodaro/shared"

/** Per model: its fal endpoint and its `FAL_PRICING` key. */
export const SAM3_VIDEO_MODELS: Readonly<Record<VideoMaskProvider, { readonly endpoint: string; readonly priceId: string }>> = {
  "sam-3.1": { endpoint: "fal-ai/sam-3-1/video-rle", priceId: "sam-3.1-video" },
  "sam-3": { endpoint: "fal-ai/sam-3/video-rle", priceId: "sam-3-video" },
}

export interface Sam3VideoParams {
  readonly model: VideoMaskProvider
  readonly videoUrl: string
  readonly prompt: string
  /** Detection confidence 0.05–0.95. */
  readonly threshold: number
  /** Frames in the clip — prices the anomaly/display cost only (the charge is the reserved row). */
  readonly frameCount?: number
}

export interface Sam3VideoResult {
  /** One entry per frame: row-major (start, length) pairs, "" = empty frame. */
  readonly rle: readonly string[]
  readonly requestId: string
  readonly cost: number | null
}

/** Narrow the endpoint's answer to the per-frame RLE list, refusing any other shape loudly. */
export function parseSam3VideoOutput(output: unknown): string[] {
  const rle = (output as { rle?: unknown } | null)?.rle
  if (!Array.isArray(rle) || rle.some((r) => typeof r !== "string")) {
    throw new DeterministicJobError(`SAM 3 returned an unexpected shape (no per-frame rle list): ${JSON.stringify(output).slice(0, 200)}`)
  }
  if (rle.length === 0) throw new DeterministicJobError("SAM 3 returned no frames for this video.")
  return rle as string[]
}

export async function runSam3Video(params: Sam3VideoParams): Promise<Sam3VideoResult> {
  const model = SAM3_VIDEO_MODELS[params.model]
  const { output, requestId } = await runFalRequest({
    endpoint: model.endpoint,
    input: {
      video_url: params.videoUrl,
      prompt: params.prompt,
      apply_mask: true,
      detection_threshold: params.threshold,
    },
    label: "[fal:sam3Video]",
  })
  const rle = parseSam3VideoOutput(output)
  return { rle, requestId, cost: falCostUsd(model.priceId, { frames: params.frameCount ?? rle.length }) }
}
