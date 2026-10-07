import { estimateLoopTrimAddonCredits, pricedOutputDurationSec } from "@nodaro/shared"

/**
 * The Loop Trim add-on for ONE image-to-video run, sized on the seconds the
 * model RENDERS (the catalog funnel: its own default when unset, the nearest
 * legal length when off-ladder, its ceiling for Auto). The route's reservation,
 * the worker's settlement and the stale-job reconcile all call this, so the
 * credits held, charged and refunded for a trim can never disagree.
 */
export function loopTrimAddonCreditsFor(
  loopTrim: { enabled?: boolean; framesToTest?: number } | undefined,
  provider: string,
  duration: number | string | undefined,
): number {
  return estimateLoopTrimAddonCredits(loopTrim, pricedOutputDurationSec(provider, duration))
}
