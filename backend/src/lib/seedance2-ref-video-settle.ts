import { billsReferenceVideoSeconds, isSeedance2Provider } from "@nodaro/shared/models"
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
 * completes such a run: the i2v/t2v worker handlers and the reconcile cron's
 * generic recovery.
 *
 * `refVideoDurationsSec` is the reservation's own probe of the reference
 * clips, carried on the job (`input_data` and the queue payload) by both
 * reservation lanes; the settlement reads it instead of probing again.
 *
 * Core shim over the ee helper (dynamic import, the credit-guard pattern):
 * community/business never load a billing module.
 */
export async function measureSeedance2RefVideoBaseCredits(args: {
  provider: string | undefined
  resolution: string | undefined
  outputUrl: string
  referenceVideoUrls: unknown
  refVideoDurationsSec?: unknown
  /** The REQUESTED duration. Only Auto (-1) matters here: with no reference
   *  video wired it is the one other run reserved at a worst case. */
  duration?: unknown
}): Promise<number | undefined> {
  if (!hasCredits()) return undefined
  const { provider, referenceVideoUrls } = args
  // Every model whose reference-video runs bill the clips' seconds (Seedance 2,
  // Kling 4.0) settles here; only Seedance has the Auto-duration case below.
  if (!billsReferenceVideoSeconds(provider)) return undefined
  const hasVideoRef = Array.isArray(referenceVideoUrls) && referenceVideoUrls.length > 0
  if (!hasVideoRef) {
    if (!isSeedance2Provider(provider)) return undefined
    // AUTO duration, nothing wired: reserved at the model's longest clip, so
    // settle to the tier of the length the model actually chose.
    if (!isAutoVideoDuration(args.duration)) return undefined
    try {
      const { seedance2AutoDurationActualBaseCredits } = await import("../ee/billing/seedance2-ref-video-credits.js")
      return await seedance2AutoDurationActualBaseCredits({
        provider: provider as string,
        resolution: args.resolution,
        outputUrl: args.outputUrl,
      })
    } catch (err) {
      console.warn(`[billing] could not measure the delivered Seedance auto-duration run; committing the reservation:`, err)
      return undefined
    }
  }
  try {
    const { seedance2RefVideoActualBaseCredits } = await import("../ee/billing/seedance2-ref-video-credits.js")
    return await seedance2RefVideoActualBaseCredits({
      provider: provider as string,
      resolution: args.resolution ?? "720p",
      outputUrl: args.outputUrl,
      referenceVideoUrls,
      ...(Array.isArray(args.refVideoDurationsSec) ? { durationsSec: args.refVideoDurationsSec } : {}),
    })
  } catch (err) {
    console.warn(`[billing] could not measure the delivered Seedance reference run; committing the reservation:`, err)
    return undefined
  }
}
