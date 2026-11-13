import { isSeedanceExtendPricedBySecondsSent, seedanceExtendPrice, type SeedanceExtendPrice } from "@nodaro/render-rules"
import { canonicalVideoProvider } from "@nodaro/shared/models"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"

/**
 * Seedance 2.5 Extend: the BASE (pre-markup) price of one run — its
 * resolution's rate row (`seedance-2-5-extend:<res>:per-2s`, admin-editable in
 * model_pricing, the price of two seconds) times (seconds sent + seconds
 * added) ÷ 2, rounded up once (`seedanceExtendPrice`, @nodaro/render-rules).
 *
 * One function for the route's credit guard, the workflow run's reservation
 * (node-executor) and the worker's settlement on the source it measured, so
 * an extend holds and is charged the same amount wherever it runs. A source
 * whose length is not known (`sourcePictureSec` undefined) is priced at the
 * whole 10-second window, the most a run sends. 0 when credits are off.
 */
export async function seedanceExtendBaseCredits(args: {
  duration: unknown
  resolution: unknown
  sourcePictureSec: number | null | undefined
}): Promise<number> {
  const price: SeedanceExtendPrice = seedanceExtendPrice(args)
  return unitRateBaseCredits(price.rateId, price.units)
}

/** The payload key the route and a workflow run put the source's measured picture length on (the length the hold is priced on). */
export const SEEDANCE_EXTEND_SOURCE_SEC_KEY = "sourcePictureSec"

/** Is this queued job a Seedance 2.5 Extend (priced by the seconds it sends)? A retired id counts as the provider it runs as. */
export function isSeedanceExtendSentPricedJob(jobName: string, payload: Record<string, unknown>): boolean {
  return jobName === "extend-video" && typeof payload.provider === "string" && isSeedanceExtendPricedBySecondsSent(canonicalVideoProvider(payload.provider))
}

/** A stamped length, when it is one: finite and above 0. */
function stampedSec(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * A workflow run's measurement of a Seedance 2.5 extend's source, before it is
 * held: the length of the source's picture (the video stream's own, else the
 * container's — the route's and the worker's reading), stamped on the payload
 * as {@link SEEDANCE_EXTEND_SOURCE_SEC_KEY}. Best effort, like the route's
 * probe: a source that cannot be measured from here (or is no safe http(s)
 * link) stamps nothing, so the run holds the whole 10-second window and the
 * worker settles it on the source it measures. Every other job: no patch.
 */
export async function stampSeedanceExtendSource(
  jobName: string,
  payload: Record<string, unknown>,
  onProbeError?: (err: unknown) => void,
): Promise<Record<string, unknown>> {
  if (!isSeedanceExtendSentPricedJob(jobName, payload)) return {}
  const url = payload.video
  if (typeof url !== "string" || !safeUrlSchema.safeParse(url).success) return { [SEEDANCE_EXTEND_SOURCE_SEC_KEY]: undefined }
  try {
    const probe = await probeVideoSource(url)
    return { [SEEDANCE_EXTEND_SOURCE_SEC_KEY]: stampedSec(probe.videoDurationSeconds ?? probe.durationSeconds) }
  } catch (err) {
    onProbeError?.(err)
    return { [SEEDANCE_EXTEND_SOURCE_SEC_KEY]: undefined }
  }
}

/**
 * The source length a Seedance 2.5 extend job's hold was priced on, when one
 * was measured: the route's guard (its preHandler's probe) and a workflow
 * run's stamp ({@link stampSeedanceExtendSource}) put it on the job under
 * {@link SEEDANCE_EXTEND_SOURCE_SEC_KEY}. Undefined when neither measured it
 * (the hold is then the whole 10-second window). The worker sends no more of
 * the source than this, so a run is never sent more than it was held for.
 */
export function seedanceExtendHeldSourceSec(jobData: Record<string, unknown>): number | undefined {
  return stampedSec(jobData[SEEDANCE_EXTEND_SOURCE_SEC_KEY])
}

/**
 * The BASE credits a Seedance 2.5 extend job holds in a workflow run: what the
 * route's guard charges for the same request, on the length stamped by
 * {@link stampSeedanceExtendSource} (the whole window when none). Undefined
 * for every other job.
 */
export async function seedanceExtendStampedBaseCredits(jobName: string, payload: Record<string, unknown>): Promise<number | undefined> {
  if (!isSeedanceExtendSentPricedJob(jobName, payload)) return undefined
  return seedanceExtendBaseCredits({
    duration: payload.duration,
    resolution: payload.resolution,
    sourcePictureSec: stampedSec(payload[SEEDANCE_EXTEND_SOURCE_SEC_KEY]),
  })
}
