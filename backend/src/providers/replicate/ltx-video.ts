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
import { snapAspectRatioToken } from "../video/aspect-ratio.js"
import { MODEL_CATALOG } from "@nodaro/shared"

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

// Both LTX 2.3 catalog entries declare IDENTICAL `resolutions` /
// `aspectRatios` (packages/shared/src/model-catalog.ts) — enforced by the
// parity assertions in ltx-video-guards.test.ts. Deriving from "ltx-2.3-pro"
// here means these two lists can never drift from the catalog again. Before
// this catalog entry existed, LTX had no MODEL_CATALOG row at all, so nothing
// upstream could snap a stale resolution — a "720p" left over from a provider
// switch reached Replicate unmodified and came back a 422 (app-reports triage
// 2026-09-01, P3). `LTX_RESOLUTIONS`/`LTX_ASPECT_RATIOS` used to be Task 6's
// hand-copied stopgap for that gap; now that the catalog entry exists, they
// derive from it instead of risking the same kind of drift a second time.
const LTX_CATALOG_ENTRY = MODEL_CATALOG["ltx-2.3-pro"]
if (!LTX_CATALOG_ENTRY?.resolutions?.length || !LTX_CATALOG_ENTRY?.aspectRatios?.length) {
  throw new Error(
    "MODEL_CATALOG['ltx-2.3-pro'] must declare non-empty resolutions and aspectRatios for ltx-video.ts to derive its dispatch-time guard lists from",
  )
}

/** The three bands Replicate's ltx-2.3-{pro,fast} accept. Derived from
 *  MODEL_CATALOG so it can't drift; also mirrors LTX_DURATION_TIERS' band
 *  keys — the credit identifier falls back to "1080p" for anything else, so
 *  the render must too, or the reservation and the run disagree. */
export const LTX_RESOLUTIONS = LTX_CATALOG_ENTRY.resolutions as readonly LtxResolution[]
export const LTX_ASPECT_RATIOS = LTX_CATALOG_ENTRY.aspectRatios as readonly LtxAspect[]
// The catalog tracks no fps lever at all (ModelCatalogEntry has no `fps`
// field), so this one stays hand-written — there is nothing to derive it from.
export const LTX_FPS = [24, 25, 48, 50] as const

export interface LtxSnappedInput {
  resolution?: LtxResolution
  aspectRatio?: LtxAspect
  fps?: LtxFps
}

/**
 * Last-mile guard. Both video routes take `resolution` as a free string and the
 * orchestrator forwards `data.resolution` verbatim, so a node switched from a
 * 720p-capable provider keeps "720p" and Replicate answers 422 (app-reports
 * P3). Snapping — never throwing — is deliberate: the credit was already
 * reserved, and `buildVideoCreditModelIdentifier` uses the SAME 1080p fallback,
 * so a snapped run stays inside the tier the user paid for.
 */
export function snapLtxInput(input: {
  resolution?: string
  aspectRatio?: string
  fps?: number
}): LtxSnappedInput {
  const out: LtxSnappedInput = {}

  if (input.resolution !== undefined) {
    // R3: deliberately NOT lower-cased. `buildVideoCreditModelIdentifier`'s LTX
    // branch keys LTX_DURATION_TIERS case-sensitively on lowercase bands, so an
    // un-canonicalised "4K" already reserved 1080p; matching that fallback here
    // keeps render == reserved. Canonicalisation belongs upstream, once, in
    // `normalizeVideoRequestParams` (Task 9) — before the identifier is built.
    const r = String(input.resolution).trim()
    out.resolution = (LTX_RESOLUTIONS as readonly string[]).includes(r)
      ? (r as LtxResolution)
      : "1080p"
  }

  if (input.aspectRatio !== undefined) {
    const a = String(input.aspectRatio).trim()
    out.aspectRatio = ((LTX_ASPECT_RATIOS as readonly string[]).includes(a)
      ? a
      : snapAspectRatioToken(a, LTX_ASPECT_RATIOS) ?? "16:9") as LtxAspect
  }

  if (input.fps !== undefined) {
    out.fps = (LTX_FPS as readonly number[]).includes(input.fps)
      ? (input.fps as LtxFps)
      : 24
  }

  return out
}

function buildCommonInput(args: LtxCommon): Record<string, unknown> {
  // R23: `LtxCommon` (`:47-57`) declares resolution/aspectRatio/fps as REQUIRED
  // narrowed unions, so `snapLtxInput` always returns all three defined and the
  // earlier draft's `snapped.x ?? args.x` fallbacks were dead code. The guard
  // still earns its keep at runtime: the worker's blind cast at
  // `workers/handlers/video-ai.ts:147` is what lets a real "720p" in.
  const snapped = snapLtxInput(args)
  return {
    prompt: args.prompt,
    resolution: snapped.resolution,
    duration: args.duration,
    aspect_ratio: snapped.aspectRatio,
    fps: snapped.fps,
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
  // Retake bypasses buildCommonInput, so it needs the same last-mile snap.
  const snapped = snapLtxInput(args)
  return dispatchAndWait(
    MODEL_ID[args.variant],
    {
      task: "retake",
      video: args.video,
      prompt: args.prompt,
      retake_start_time: args.retakeStartTime,
      retake_duration: args.retakeDuration,
      retake_mode: args.retakeMode,
      resolution: snapped.resolution,
      aspect_ratio: snapped.aspectRatio,
      fps: snapped.fps,
      generate_audio: args.generateAudio,
      camera_motion: args.cameraMotion,
    },
    args.reconcileOpts,
    "[replicate:ltx:retake]",
  )
}
