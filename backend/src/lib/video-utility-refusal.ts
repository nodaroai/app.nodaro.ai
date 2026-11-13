import { pricedClipSeconds } from "@nodaro/shared/media"
import { videoUtilityInputUrls, videoUtilityUnits, withMeasuredInputLengths } from "./video-utility-credits.js"

/**
 * Trim Video, Loop Video and Combine Videos: the render's check that a run was
 * charged for the clips it renders. Pure: no I/O — the worker calls it after
 * its own download and probe of each input, before ffmpeg runs.
 */

/**
 * How much longer a clip may re-measure at the render than when its run was
 * priced and still be the same file (a container read twice, a re-muxed copy):
 * taken off each clip's seconds, never off the units. The same half second
 * Mask Composite allows (`MASK_COMPOSITE_REMEASURE_SLACK_SEC`), named for these
 * nodes so neither can move the other.
 */
export const VIDEO_UTILITY_REMEASURE_SLACK_SEC = 0.5

/** The shortest length the charge check reads (a clip this short is still a clip). */
const MIN_POSITIVE_SEC = 0.001

/** The render's refusal of a run priced for shorter clips than the ones it renders, or of a run with no priced units. */
export type VideoUtilityChargeRefusalCode = "video_utility_input_changed"

export interface VideoUtilityChargeRefusal {
  readonly code: VideoUtilityChargeRefusalCode
  readonly message: string
}

/** What the job's clips are called in a message. */
const subjectOf = (jobName: string): string => (jobName === "combine-videos" ? "clips" : "video")

/**
 * A run that carries no usable `billedUnits` (the units the route, the
 * workflow run or the pipeline measured and charged — server-written onto the
 * queue payload, never a client's field) is refused and refunded, never
 * rendered unpriced. Undefined when it carries them.
 */
export function videoUtilityUnpricedRefusal(jobName: string, billedUnits: unknown): VideoUtilityChargeRefusal | undefined {
  if (typeof billedUnits === "number" && Number.isFinite(billedUnits) && billedUnits >= 1) return undefined
  return { code: "video_utility_input_changed", message: `This run was not priced for its ${subjectOf(jobName)} — run it again` }
}

/**
 * The render's check, from `job` (the queue payload: the node's settings, the
 * `billedUnits` it was charged and the lengths it was charged for) and the
 * container length of each clip it downloaded (`durationsSec`, in the order of
 * its inputs): the units those clips cost by the node's own formula, each clip
 * first shortened by {@link VIDEO_UTILITY_REMEASURE_SLACK_SEC}, must not exceed
 * the units charged. A clip that has grown past its price since (a link that
 * served a short file to the price probe and a long one to the download) is
 * refused before anything is rendered, and refunded. Lengths in the message are
 * the priced seconds, the rounding prices use.
 */
export function videoUtilityRefusalForCharge(
  jobName: string,
  job: Readonly<Record<string, unknown>>,
  durationsSec: readonly number[],
): VideoUtilityChargeRefusal | undefined {
  const unpriced = videoUtilityUnpricedRefusal(jobName, job.billedUnits)
  if (unpriced) return unpriced
  const billedUnits = job.billedUnits as number
  const remeasured = durationsSec.map((sec) => Math.max(sec - VIDEO_UTILITY_REMEASURE_SLACK_SEC, MIN_POSITIVE_SEC))
  const units = videoUtilityUnits(jobName, withMeasuredInputLengths(jobName, job, remeasured)) ?? 0
  if (units <= billedUnits) return undefined
  // Name the clip that grew: the first whose re-measure is past the length it was priced at.
  const priced = jobName === "combine-videos" ? (Array.isArray(job.upstreamDurations) ? job.upstreamDurations : []) : [job.upstreamDuration]
  const count = videoUtilityInputUrls(jobName, job).length
  const grown = remeasured.findIndex((sec, i) => typeof priced[i] === "number" && sec > (priced[i] as number))
  const i = grown >= 0 ? grown : 0
  const which = jobName === "combine-videos" && count > 1 ? `Clip ${i + 1} of ${count}` : "The video"
  const was = typeof priced[i] === "number" ? ` the ${pricedClipSeconds(priced[i] as number)} seconds` : ""
  return {
    code: "video_utility_input_changed",
    message: `${which} is ${pricedClipSeconds(durationsSec[i] ?? 0)} seconds, longer than${was || " the length"} this run was priced for — run it again`,
  }
}
