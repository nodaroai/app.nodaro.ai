import { billsReferenceVideoSeconds, isGeminiOmniPerSecondProvider, isSeedance2Provider } from "@nodaro/shared/models"
import { isAutoVideoDuration } from "@nodaro/shared/model-catalog"
import { hasCredits } from "./config.js"

/**
 * The BASE credits a Seedance 2 reference-video run actually billed, measured
 * from the clip the provider delivered — or `undefined` when there is nothing
 * to measure (no credits in this edition, another provider, neither a
 * reference video nor an Auto duration) or the measurement failed, in which case the caller commits the
 * reservation exactly as before (never under-bills).
 *
 * WHY: the reservation for such a run is a worst case. Seedance decides from
 * the prompt whether the run is a style run (renders the requested duration)
 * or an EDIT of the wired clip (renders the clip's own length, however long),
 * and the verdict is only known once the provider has spoken — so the reserve
 * holds the longer of the two and this measurement settles the difference.
 * Handed to `finalizeJobWithMedia` as `meteredBaseCredits` by every lane that
 * completes such a run: the i2v/t2v worker handlers (through
 * {@link measureSeedance2Settle}, which also returns the seconds), the voiced
 * lane and the reconcile cron's generic recovery.
 *
 * `refVideoDurationsSec` is the reservation's own probe of the reference
 * clips, carried on the job (`input_data` and the queue payload) by both
 * reservation lanes; the settlement reads it instead of probing again.
 *
 * Core shim over the ee helper (dynamic import, the credit-guard pattern):
 * community/business never load a billing module.
 */
export async function measureSeedance2RefVideoBaseCredits(args: Seedance2SettleArgs): Promise<number | undefined> {
  return (await measureSeedance2Settle(args)).baseCredits
}

/** What a lane completing a Seedance run hands the settlement (see {@link measureSeedance2RefVideoBaseCredits}). */
export interface Seedance2SettleArgs {
  provider: string | undefined
  resolution: string | undefined
  outputUrl: string
  referenceVideoUrls: unknown
  refVideoDurationsSec?: unknown
  /** The REQUESTED duration. Only Auto (-1) matters here: with no reference
   *  video wired it is the one other run reserved at a worst case; with one,
   *  the hold was sized from the source clip, and a delivered clip past it is
   *  charged at the hold and alerted. */
  duration?: unknown
  /** The job being settled — named by the over-the-hold alert. */
  jobId?: string
}

/** One measurement of a delivered Seedance run — see {@link measureSeedance2Settle}. */
export interface Seedance2Settle {
  /** The BASE credits to commit in place of the reservation; undefined = commit the reservation. */
  baseCredits: number | undefined
  /** The seconds those credits were measured from: `outputSec` is the delivered clip's
   *  length (what was rendered, never capped at a hold), `inputSec` the reference clips
   *  as billed (0 without one). Undefined when nothing was measured; kept when only the
   *  pricing failed (`baseCredits` undefined: the reservation is committed). */
  seconds: { outputSec: number; inputSec: number } | undefined
}

const NOT_MEASURED: Seedance2Settle = { baseCredits: undefined, seconds: undefined }

const everyClipMeasured = (durationsSec: unknown): boolean =>
  Array.isArray(durationsSec) && durationsSec.length > 0
  && durationsSec.every((d) => typeof d === "number" && Number.isFinite(d) && d > 0)

/**
 * Price a measurement already taken. A pricing failure (a missing price row)
 * commits the reservation, as before, and keeps the seconds: the length is
 * known, so the run's provider cost can still be recorded.
 */
async function priceMeasured(
  seconds: { outputSec: number; inputSec: number },
  price: () => Promise<number>,
  run: string,
): Promise<Seedance2Settle> {
  try {
    return { baseCredits: await price(), seconds }
  } catch (err) {
    console.warn(`[billing] could not price the delivered Seedance ${run}; committing the reservation:`, err)
    return { baseCredits: undefined, seconds }
  }
}

/**
 * {@link measureSeedance2RefVideoBaseCredits}, with the seconds behind its
 * answer: ONE measurement of the delivered clip gives the credits the charge
 * commits and the seconds the worker records the run's provider cost from, so
 * the two can never read different lengths. Same gates, same fallback: nothing
 * measured (or a failed measurement) is neither credits nor seconds; a
 * measurement that cannot be priced keeps its seconds (see `priceMeasured`).
 */
export async function measureSeedance2Settle(args: Seedance2SettleArgs): Promise<Seedance2Settle> {
  if (!hasCredits()) return NOT_MEASURED
  const { provider, referenceVideoUrls } = args
  // Every model whose reference-video runs bill the clips' seconds (Seedance 2,
  // Kling 4.0) settles here; only Seedance has the Auto-duration case below.
  if (!billsReferenceVideoSeconds(provider)) return NOT_MEASURED
  // A per-second Gemini Omni edit is billed for its source clip, and the hold is
  // already that clip's price. Only a clip the hold could not read settles on
  // the clip delivered.
  if (isGeminiOmniPerSecondProvider(provider) && everyClipMeasured(args.refVideoDurationsSec)) return NOT_MEASURED
  const hasVideoRef = Array.isArray(referenceVideoUrls) && referenceVideoUrls.length > 0
  if (!hasVideoRef) {
    if (!isSeedance2Provider(provider)) return NOT_MEASURED
    // AUTO duration, nothing wired: reserved at the model's longest clip, so
    // settle to the tier of the length the model actually chose.
    if (!isAutoVideoDuration(args.duration)) return NOT_MEASURED
    try {
      const { seedance2AutoDurationActualSeconds, seedance2AutoDurationActualBaseCredits } = await import("../ee/billing/seedance2-ref-video-credits.js")
      const outputSec = await seedance2AutoDurationActualSeconds({ outputUrl: args.outputUrl })
      return await priceMeasured(
        { outputSec, inputSec: 0 },
        () => seedance2AutoDurationActualBaseCredits({ provider: provider as string, resolution: args.resolution, outputUrl: args.outputUrl }, outputSec),
        "auto-duration run",
      )
    } catch (err) {
      console.warn(`[billing] could not measure the delivered Seedance auto-duration run; committing the reservation:`, err)
      return NOT_MEASURED
    }
  }
  try {
    const { seedance2RefVideoActualSeconds, seedance2RefVideoActualBaseCredits } = await import("../ee/billing/seedance2-ref-video-credits.js")
    const run = {
      provider: provider as string,
      resolution: args.resolution ?? "720p",
      outputUrl: args.outputUrl,
      referenceVideoUrls,
      ...(Array.isArray(args.refVideoDurationsSec) ? { durationsSec: args.refVideoDurationsSec } : {}),
      requestedDuration: args.duration,
      ...(args.jobId ? { jobId: args.jobId } : {}),
    }
    const measured = await seedance2RefVideoActualSeconds(run)
    return await priceMeasured(
      { outputSec: measured.deliveredSec, inputSec: measured.inputSec },
      () => seedance2RefVideoActualBaseCredits(run, measured),
      "reference run",
    )
  } catch (err) {
    console.warn(`[billing] could not measure the delivered Seedance reference run; committing the reservation:`, err)
    return NOT_MEASURED
  }
}
