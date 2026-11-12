/**
 * A generated video that is not the length its node stores (decided
 * 2026-11-11). A video generation run is LENGTH-FOLLOWING when its model
 * offers an automatic length (catalog `autoDuration`) and the run either goes
 * out at an automatic length (the model picks it; an Edit takes the clip's own)
 * or carries a declared reference task type after resolution (an Extend with
 * an automatic length runs at the model's default). Such a video records the
 * length it really is when it completes (`output_data.durationSec`, the key a
 * render records), and the step after it — Trim, Loop, Combine Videos — is
 * charged by that, while every quote reads the run's UPPER BOUND until the
 * video exists. Every other run renders its stored length and records nothing.
 *
 * One rule for the worker that records the length and both estimators that
 * quote it; it reads the catalog and restates no number.
 */
import {
  canonicalVideoProvider,
  listedSeedanceTaskType,
  pricedOutputDurationSec,
  supportsAutoVideoDuration,
} from "@nodaro/shared/models"
import { isAutoVideoDuration, VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"

/**
 * The node types whose run is a video generation job that can follow its own
 * length (Generate Video, the older Image to Video and Text to Video, and the
 * Video to Video node, whose Seedance lane runs at an automatic length): the
 * types whose output carries the length its job recorded to the step after it.
 */
export const LENGTH_RECORDING_VIDEO_NODE_TYPES: ReadonlySet<string> = new Set(["generate-video", "image-to-video", "text-to-video", "video-to-video"])

/** A video generation run as it is SENT: the model, the length and the reference task type after resolution. */
export interface VideoRunRequest {
  readonly provider: unknown
  /** The length sent: seconds, or `VIDEO_DURATION_AUTO`; a numeric string reads as its number. */
  readonly duration: unknown
  /** The declared reference task type, if any (anything the model does not list is none). */
  readonly referenceTaskType?: unknown
}

/**
 * A video generation node read as it was before its runs recorded a length:
 * its results without the `duration` a length-following run put on them. What
 * an estimate reads for a step that MEASURES the clip it is given (Video SFX,
 * Video Mask, Pitch & Tempo, …): the recorded length is capped at the run's
 * bound, so it can sit a few hundredths of a second under the file that step
 * measures, and a quote must never be below the charge. Every other node, and
 * a generation with no recorded length, is the same object.
 */
export function withoutRecordedVideoLength<T extends { readonly type?: string | null; readonly data?: unknown }>(origin: T): T {
  if (!LENGTH_RECORDING_VIDEO_NODE_TYPES.has(origin.type ?? "")) return origin
  const data = origin.data as Record<string, unknown> | undefined
  const results = Array.isArray(data?.generatedResults) ? (data.generatedResults as unknown[]) : undefined
  if (!results?.some((r) => r !== null && typeof r === "object" && "duration" in r)) return origin
  const stripped = results.map((r) => {
    if (r === null || typeof r !== "object" || !("duration" in r)) return r
    const { duration: _recorded, ...rest } = r as Record<string, unknown>
    return rest
  })
  return { ...origin, data: { ...data, generatedResults: stripped } }
}

/**
 * The most a length-following run can make, in seconds, or `undefined` when
 * the run is not length-following (it renders its stored length). A run is
 * length-following at an automatic length, or at any length when it declares
 * a reference task type the model lists. The bound is the length the run is
 * priced at (`pricedOutputDurationSec`): an automatic length at the model's
 * longest clip, a set one at the length the model renders for it.
 *
 * A retired model is read as the model it runs as (`canonicalVideoProvider`).
 */
export function lengthFollowingBoundSec(run: VideoRunRequest): number | undefined {
  const provider = typeof run.provider === "string" && run.provider !== "" ? canonicalVideoProvider(run.provider) : undefined
  if (provider === undefined || !supportsAutoVideoDuration(provider)) return undefined
  if (isAutoVideoDuration(run.duration)) return pricedOutputDurationSec(provider, VIDEO_DURATION_AUTO)
  if (listedSeedanceTaskType(provider, run.referenceTaskType) === undefined) return undefined
  const duration = typeof run.duration === "number" || typeof run.duration === "string" ? run.duration : undefined
  return pricedOutputDurationSec(provider, duration)
}
