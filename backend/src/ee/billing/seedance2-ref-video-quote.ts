import { VIDEO_REF_VIDEO_DURATION_LIMITS, pricedOutputDurationSec, uiResolutionFill, videoGenerationCreditId } from "@nodaro/shared"
import { getAppSettings } from "../../lib/app-settings.js"
import { refVideoCapFor } from "../../lib/ref-video-probe.js"
import { resolveVideoRequestNorm } from "../../lib/video-request-norm.js"
import { seedance2RefVideoBaseCreditsFromDurations } from "./seedance2-ref-video-credits.js"
import { applyServiceMarkup } from "./service-margin.js"

/** What a Seedance 2 reference-video run is quoted at (charged credits). */
export interface Seedance2RefVideoQuote {
  /** The credits the run reserves — or, while a clip is unknown, the most it can reserve. */
  credits: number
  /** The least it can cost: `credits` when exact, else every unknown clip at the shortest length accepted. */
  min: number
  /** False while a reference clip's length is unknown (its URL is not known yet). */
  exact: boolean
}

/**
 * The CHARGED price of a Seedance 2 run with reference video(s), from the
 * probed durations — the same arithmetic, at the same resolution, duration and
 * markup basis, as the run's reservation (the routes' `computeCredits`, the
 * orchestrator's `computeSeedance2RefVideoCreditOverride`):
 *
 *   markup(ceil(perSec × (Σ clips + max(output, longest clip))))
 *
 * `durationsSec` are the probed clips in request order (a NaN — an unreadable
 * clip — is the worst case, as the reservation counts it). `unknownClips` are
 * wired clips whose URL is not known yet: `credits` prices them at the
 * provider's worst case, so a quote is never below what the run can reserve,
 * and `min` at the shortest clip the provider accepts. Nothing beyond the
 * provider's clip cap is counted — the run sends no more.
 *
 * The request levers are read the way the run reads them: an omitted
 * resolution is the model's UI fill (what the run sends), a draft is 480p
 * (`resolveVideoRequestNorm`), and the output length is the provider's priced
 * one (`pricedOutputDurationSec` — Auto = the longest clip).
 */
export async function seedance2RefVideoChargedQuote(args: {
  provider: string
  resolution?: string
  duration?: number | string
  draft?: boolean
  durationsSec: readonly number[]
  unknownClips: number
}): Promise<Seedance2RefVideoQuote> {
  const { provider, duration } = args
  const norm = resolveVideoRequestNorm({
    provider,
    resolution: args.resolution ?? uiResolutionFill(provider),
    duration,
    draft: args.draft === true,
  })
  const priceArgs = {
    provider,
    resolution: norm.resolution ?? "720p",
    outputDurationSec: pricedOutputDurationSec(provider, duration),
  }
  const cap = refVideoCapFor(provider)
  const known = args.durationsSec.slice(0, cap)
  const unknown = Math.max(0, Math.min(args.unknownClips, cap - known.length))
  const shortest = VIDEO_REF_VIDEO_DURATION_LIMITS[provider]?.minSec ?? 1

  const ceilingBase = seedance2RefVideoBaseCreditsFromDurations({ ...priceArgs, durationsSec: [...known, ...Array<number>(unknown).fill(Number.NaN)] })
  const floorBase = seedance2RefVideoBaseCreditsFromDurations({ ...priceArgs, durationsSec: [...known, ...Array<number>(unknown).fill(shortest)] })

  // Marked up once, at the identifier the run's reservation is marked up at.
  const identifier = videoGenerationCreditId({ provider, duration, resolution: priceArgs.resolution, hasVideoRef: true })
  const settings = await getAppSettings()
  const credits = applyServiceMarkup(ceilingBase, settings, identifier)
  return { credits, min: unknown === 0 ? credits : applyServiceMarkup(floorBase, settings, identifier), exact: unknown === 0 }
}
