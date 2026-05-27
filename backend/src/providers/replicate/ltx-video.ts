/**
 * Lightricks LTX 2.3 (Pro + Fast) Replicate provider
 *
 * Five tasks across two model variants:
 * - Pro: text_to_video, image_to_video, audio_to_video, extend, retake
 * - Fast: text_to_video, image_to_video only (no audio/extend/retake)
 *
 * Finalization: synchronous `replicate.wait(prediction)` after dispatch.
 * Mirrors the face-swap / lip-sync pattern — the worker handler blocks
 * until the prediction reaches terminal state, then uploads + finalizes.
 *
 * The Replicate webhook path was considered but rejected as more invasive:
 *  - No existing /v1/webhooks/replicate-predictions route (only the
 *    training-specific handler exists).
 *  - The reconcile cron (`lib/reconcile/replicate.ts`) already covers the
 *    safety-net case at the 20-min `replicate-prediction` staleness
 *    threshold — webhook would only be a latency optimization.
 *  - Sync wait keeps the worker handler colocated with finalization logic
 *    (upload, watermark, thumbnail), the same shape as face-swap.
 *
 * Cost: extracted via `extractCost(metrics.predict_time * 0.000225)`.
 */
import { replicate, extractUrl, extractCost } from "./client.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"

type LtxVariant = "ltx-2.3-pro" | "ltx-2.3-fast"
type LtxResolution = "1080p" | "2k" | "4k"
type LtxAspect = "16:9" | "9:16"
type LtxFps = 24 | 25 | 48 | 50
type LtxCameraMotion =
  | "dolly_in"
  | "dolly_out"
  | "dolly_left"
  | "dolly_right"
  | "jib_up"
  | "jib_down"
  | "static"
  | "focus_shift"
  | "none"

const MODEL_ID: Record<LtxVariant, string> = {
  "ltx-2.3-pro": "lightricks/ltx-2.3-pro",
  "ltx-2.3-fast": "lightricks/ltx-2.3-fast",
}

interface LtxCommon {
  variant: LtxVariant
  prompt: string
  resolution: LtxResolution
  duration: number
  aspectRatio: LtxAspect
  fps: LtxFps
  generateAudio: boolean
  cameraMotion: LtxCameraMotion
  reconcileOpts?: ReconcileOpts
}

export interface LtxTextToVideoArgs extends LtxCommon {}

export interface LtxImageToVideoArgs extends LtxCommon {
  image: string
  lastFrameImage?: string
}

export interface LtxAudioToVideoArgs extends Omit<LtxCommon, "variant"> {
  variant: "ltx-2.3-pro"
  audio: string
}

export interface LtxExtendArgs {
  variant: "ltx-2.3-pro"
  video: string
  duration: number
  extendMode: "start" | "end"
  reconcileOpts?: ReconcileOpts
}

export interface LtxRetakeArgs {
  variant: "ltx-2.3-pro"
  video: string
  prompt: string
  retakeStartTime: number
  retakeDuration: number
  retakeMode: "replace_audio" | "replace_video" | "replace_audio_and_video"
  resolution: "1080p"
  aspectRatio: LtxAspect
  fps: LtxFps
  generateAudio: boolean
  cameraMotion: LtxCameraMotion
  reconcileOpts?: ReconcileOpts
}

/**
 * Resolved output of an LTX prediction. The worker handler uses this to
 * upload the video, set the kieTaskId-equivalent (predictionId) on the job,
 * and finalize with provider cost when Replicate reports it.
 */
export interface LtxResult {
  predictionId: string
  videoUrl: string
  cost: number | null
}

function buildCommonInput(args: LtxCommon): Record<string, unknown> {
  return {
    prompt: args.prompt,
    resolution: args.resolution,
    duration: args.duration,
    aspect_ratio: args.aspectRatio,
    fps: args.fps,
    generate_audio: args.generateAudio,
    camera_motion: args.cameraMotion,
  }
}

/**
 * Submit a prediction, fire the onTaskCreated reconcile hook with the
 * prediction id, then `replicate.wait()` for terminal state and extract
 * the output URL + provider cost. Mirrors `face-swap.ts` exactly.
 */
async function dispatchAndWait(
  modelId: string,
  input: Record<string, unknown>,
  reconcileOpts: ReconcileOpts | undefined,
  logPrefix: string,
): Promise<LtxResult> {
  const prediction = await replicate.predictions.create({
    model: modelId,
    input,
  })
  await fireOnTaskCreated(reconcileOpts, prediction.id, logPrefix)
  const completed = await replicate.wait(prediction)
  if (completed.status === "failed" || completed.status === "canceled") {
    const err = completed.error
      ? String(completed.error)
      : `prediction ${completed.status}`
    throw new Error(`${logPrefix} ${err}`)
  }
  const output = completed.output
  const videoUrl = extractUrl(
    typeof output === "string"
      ? output
      : Array.isArray(output) && output.length > 0
        ? output[0]
        : output,
  )
  const cost = extractCost(completed.metrics as Record<string, unknown> | undefined)
  return { predictionId: prediction.id, videoUrl, cost }
}

export async function runLtxTextToVideo(
  args: LtxTextToVideoArgs,
): Promise<LtxResult> {
  return dispatchAndWait(
    MODEL_ID[args.variant],
    { task: "text_to_video", ...buildCommonInput(args) },
    args.reconcileOpts,
    "[replicate:ltx:t2v]",
  )
}

export async function runLtxImageToVideo(
  args: LtxImageToVideoArgs,
): Promise<LtxResult> {
  const input: Record<string, unknown> = {
    task: "image_to_video",
    image: args.image,
    ...buildCommonInput(args),
  }
  if (args.lastFrameImage) input.last_frame_image = args.lastFrameImage
  return dispatchAndWait(
    MODEL_ID[args.variant],
    input,
    args.reconcileOpts,
    "[replicate:ltx:i2v]",
  )
}

export async function runLtxAudioToVideo(
  args: LtxAudioToVideoArgs,
): Promise<LtxResult> {
  return dispatchAndWait(
    MODEL_ID[args.variant],
    {
      task: "audio_to_video",
      audio: args.audio,
      ...buildCommonInput(args),
    },
    args.reconcileOpts,
    "[replicate:ltx:a2v]",
  )
}

export async function runLtxExtend(args: LtxExtendArgs): Promise<LtxResult> {
  return dispatchAndWait(
    MODEL_ID[args.variant],
    {
      task: "extend",
      video: args.video,
      duration: args.duration,
      extend_mode: args.extendMode,
    },
    args.reconcileOpts,
    "[replicate:ltx:extend]",
  )
}

export async function runLtxRetake(args: LtxRetakeArgs): Promise<LtxResult> {
  return dispatchAndWait(
    MODEL_ID[args.variant],
    {
      task: "retake",
      video: args.video,
      prompt: args.prompt,
      retake_start_time: args.retakeStartTime,
      retake_duration: args.retakeDuration,
      retake_mode: args.retakeMode,
      resolution: args.resolution,
      aspect_ratio: args.aspectRatio,
      fps: args.fps,
      generate_audio: args.generateAudio,
      camera_motion: args.cameraMotion,
    },
    args.reconcileOpts,
    "[replicate:ltx:retake]",
  )
}
