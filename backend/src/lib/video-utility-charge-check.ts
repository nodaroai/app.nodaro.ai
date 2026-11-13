import { DeterministicJobError } from "./deterministic-job-error.js"
import { videoUtilityClipReading } from "./video-utility-credits.js"
import { probeClipLengthSec } from "./video-utility-probe.js"
import { videoUtilityRefusalForCharge, videoUtilityUnpricedRefusal } from "./video-utility-refusal.js"

/**
 * The render's side of a Trim / Loop / Combine Videos charge: a job that
 * carries no priced units is refused at once (before anything is downloaded),
 * and the returned check re-measures the clips the render downloaded — by
 * `probeClipLengthSec` at the node's own reading (`videoUtilityClipReading`),
 * the reading the charge was measured by — and refuses
 * clips that need more units than were charged (`videoUtilityRefusalForCharge`).
 * Both refusals are final and refunded (`DeterministicJobError`). A probe that
 * timed out stays a plain, retryable error.
 */
export function videoUtilityChargeCheck(
  jobName: string,
  job: Readonly<Record<string, unknown>>,
): (localPaths: readonly string[]) => Promise<void> {
  const unpriced = videoUtilityUnpricedRefusal(jobName, job.billedUnits)
  if (unpriced) throw new DeterministicJobError(unpriced.message)
  const reading = videoUtilityClipReading(jobName)
  return async (localPaths) => {
    const secs = await Promise.all(localPaths.map(async (path, i) => {
      try {
        return await probeClipLengthSec(path, { reading })
      } catch (err) {
        if ((err as { timedOut?: unknown }).timedOut === true) throw err
        const which = localPaths.length > 1 ? `clip ${i + 1} of ${localPaths.length}` : "the video"
        throw new DeterministicJobError(`Could not read ${which}. The file may be corrupted or an unsupported format.`, { cause: err })
      }
    }))
    const refusal = videoUtilityRefusalForCharge(jobName, job, secs)
    if (refusal) throw new DeterministicJobError(refusal.message)
  }
}
