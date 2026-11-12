import { lengthFollowingBoundSec } from "@nodaro/render-rules"
import { CONTAINER_OVERHANG_SEC } from "@nodaro/shared/video"

/**
 * The length a LENGTH-FOLLOWING video generation run records when it completes
 * (`lengthFollowingBoundSec`, @nodaro/render-rules: its model offers an
 * automatic length, and it went out at one or declared a reference task type),
 * so the step after it is charged by the length it really is.
 *
 * Recorded by `finalizeJobWithMedia` only — the one funnel every completion of
 * such a job takes (the worker's lanes and the reconcile cron; the guard is
 * `__tests__/length-recording-completions.test.ts`) — as `output_data.durationSec`,
 * the key a render records its cut's length under.
 */

/**
 * The `job_type` of a video generation job's row: what its route inserts, or
 * the queue name the video worker writes onto a workflow's row when it picks
 * it up (`voiced-video` is Generate Video with a voice). Another producer that
 * finalizes AS one of these (Generate Video Pro as `text-to-video`, Speech to
 * Video as `image-to-video`) keeps its own row type and records nothing.
 */
export const LENGTH_RECORDING_JOB_TYPES: ReadonlySet<string> = new Set(["image-to-video", "text-to-video", "voiced-video"])

/** The finalize types those rows complete as. */
const LENGTH_RECORDING_FINALIZE_TYPES: ReadonlySet<string> = new Set(["image-to-video", "text-to-video"])

/**
 * The upper bound of the run a job sent, when it is a length-following video
 * generation run; `undefined` for every other job (nothing is recorded or probed).
 */
export function recordedLengthBoundSec(
  rowJobType: string | null | undefined,
  finalizeJobType: string,
  inputData: Readonly<Record<string, unknown>> | null | undefined,
): number | undefined {
  if (!LENGTH_RECORDING_JOB_TYPES.has(rowJobType ?? "") || !LENGTH_RECORDING_FINALIZE_TYPES.has(finalizeJobType)) return undefined
  const sent = inputData ?? {}
  return lengthFollowingBoundSec({ provider: sent.provider, duration: sent.duration, referenceTaskType: sent.referenceTaskType })
}

const usableSec = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0

/** How long the one probe of a stored file may take. It runs before the
 *  completion write, so a slow read holds a finished video back; past this the
 *  length is simply not recorded (the step after is handed what it was before). */
export const RECORDED_LENGTH_PROBE_TIMEOUT_MS = 5_000

/**
 * A measured length read as the clip it is: a container that reads past a
 * whole second by no more than the platform's allowance
 * (`CONTAINER_OVERHANG_SEC`) is that whole second (10.04 s is a 10 s clip),
 * the same allowance the Seedance settlements use. Under a second there is no
 * whole second to read it as, and a longer overhang is a longer clip.
 */
function withoutContainerOverhang(sec: number): number {
  const whole = Math.floor(sec)
  return whole >= 1 && sec - whole <= CONTAINER_OVERHANG_SEC ? whole : sec
}

/**
 * The length to record: the delivered video's measured length — the handler's
 * own measurement of that file when it has one, else one probe of the stored
 * file — without a container's overhang, at most `boundSec`.
 *
 * The clamp to the bound is what keeps the charge at or below every quote: each
 * quote reads the bound until the video exists, and a delivered file is often a
 * few hundredths of a second over its nominal length (30.04 s for a 30 s clip,
 * which would be charged 7 units of 5 seconds against a 6-unit quote). Reading
 * past the overhang only ever lowers a record, so no quote can fall below it.
 *
 * A probe that fails or takes longer than `RECORDED_LENGTH_PROBE_TIMEOUT_MS` records nothing: `undefined`, never a throw, so the job
 * completes as it did before (the step after it is then handed what it was
 * handed before).
 */
export async function recordedVideoLengthSec(args: {
  readonly boundSec: number
  /** The handler's measurement of the delivered file, when it took one. */
  readonly measuredSec: number | undefined
  /** The stored video, probed when there is no measurement. */
  readonly videoUrl: string
  readonly jobId: string
}): Promise<number | undefined> {
  let sec = usableSec(args.measuredSec) ? args.measuredSec : undefined
  if (sec === undefined) {
    try {
      const { probeMediaDuration } = await import("../providers/video/ffmpeg-utils.js")
      sec = await probeMediaDuration(args.videoUrl, { timeoutMs: RECORDED_LENGTH_PROBE_TIMEOUT_MS })
    } catch (err) {
      console.warn(`[job-finalize] could not measure the delivered video of job ${args.jobId}; its length is not recorded:`, err)
      return undefined
    }
  }
  return usableSec(sec) ? Math.min(withoutContainerOverhang(sec), args.boundSec) : undefined
}
