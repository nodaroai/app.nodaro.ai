import { estimateLoopTrimAddonCredits } from "@nodaro/shared/credits"
import { pricedOutputDurationSec } from "@nodaro/shared/models"

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

/** The routed workflow hold includes only the add-ons its actual worker will run.
 * The DAG produces ordinary text/image video jobs. A voiced worker payload
 * carries its precomputed speech amount from the dispatching route. */
export function routedWorkflowVideoAddonBase(jobType: string, payload: Record<string, unknown>): number {
  if (jobType !== "image-to-video" && jobType !== "voiced-video") return 0
  const trim = payload.loopTrim as { enabled?: boolean; framesToTest?: number } | undefined
  const loop = trim?.enabled && typeof payload.provider === "string"
    ? loopTrimAddonCreditsFor(trim, payload.provider, payload.duration as number | string | undefined) : 0
  const voiced = jobType === "voiced-video" && typeof payload.voicedAudioAddon === "number" && Number.isFinite(payload.voicedAudioAddon)
    ? Math.max(0, payload.voicedAudioAddon) : 0
  return loop + voiced
}
