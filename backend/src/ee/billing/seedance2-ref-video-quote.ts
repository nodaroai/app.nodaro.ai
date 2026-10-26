import { VIDEO_REF_VIDEO_DURATION_LIMITS, pricedOutputDurationSec } from "@nodaro/shared/models"
import { uiResolutionFill } from "@nodaro/shared/video"
import { isAutoVideoDuration } from "@nodaro/shared/model-catalog"
import { videoGenerationCreditId } from "@nodaro/shared/credits"
import { getAppSettings } from "../../lib/app-settings.js"
import { refVideoCapFor } from "../../lib/ref-video-probe.js"
import { resolveVideoRequestNorm } from "../../lib/video-request-norm.js"
import { seedance2RefVideoBaseCreditsFromDurations, seedance2RefVideoExpectedBaseCredits } from "./seedance2-ref-video-credits.js"
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
 *   markup(ceil(perSec × (Σ clips + held output)))
 *
 * with the held output from `seedance2RefVideoHeldOutputSec` — for Auto with
 * every clip measured, the first clip rounded up plus a second; otherwise the
 * longer of the priced output and the longest clip.
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
 * one (`pricedOutputDurationSec` — Auto = the longest clip), held through the
 * reservation's own rule.
 */
export async function seedance2RefVideoChargedQuote(args: Seedance2RefVideoQuoteRequest): Promise<Seedance2RefVideoQuote> {
  const settings = await getAppSettings()
  return seedance2RefVideoQuote({ ...args, charge: (identifier, base) => applyServiceMarkup(base, settings, identifier) })
}

/** What a reference-video quote is asked to price. */
export interface Seedance2RefVideoQuoteRequest {
  provider: string
  resolution?: string
  duration?: number | string
  draft?: boolean
  /** The probed clips, in request order (NaN = unreadable → the worst case). */
  durationsSec: readonly number[]
  /** Wired clips whose length is not known (the worst case; `min` = the shortest clip). */
  unknownClips: number
}

/**
 * The quote above with the markup supplied (`charge` marks a base total up once
 * at an identifier) — synchronous, so a workflow estimate prices through its
 * own price table (`ChargedPriceTable.charge`) with this same arithmetic.
 */
export function seedance2RefVideoQuote(
  args: Seedance2RefVideoQuoteRequest & { charge: (identifier: string, baseCredits: number) => number },
): Seedance2RefVideoQuote {
  const { provider } = args
  const { priceArgs, identifier } = quoteBasis(args)
  const cap = refVideoCapFor(provider)
  const known = args.durationsSec.slice(0, cap)
  const unknown = Math.max(0, Math.min(args.unknownClips, cap - known.length))
  const shortest = VIDEO_REF_VIDEO_DURATION_LIMITS[provider]?.minSec ?? 1

  const ceilingBase = seedance2RefVideoBaseCreditsFromDurations({ ...priceArgs, durationsSec: [...known, ...Array<number>(unknown).fill(Number.NaN)] })
  const floorBase = seedance2RefVideoBaseCreditsFromDurations({ ...priceArgs, durationsSec: [...known, ...Array<number>(unknown).fill(shortest)] })

  // Marked up once, at the identifier the run's reservation is marked up at.
  const credits = args.charge(identifier, ceilingBase)
  return { credits, min: unknown === 0 ? credits : args.charge(identifier, floorBase), exact: unknown === 0 }
}

/**
 * The request levers read the way the run reads them: an omitted resolution
 * is the model's UI fill (what the run sends), a draft is 480p
 * (`resolveVideoRequestNorm`), the output is the provider's priced length, and
 * the markup identifier is the one the run's reservation is marked up at.
 */
function quoteBasis(args: Pick<Seedance2RefVideoQuoteRequest, "provider" | "resolution" | "duration" | "draft">) {
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
    requestedDuration: duration,
  }
  const identifier = videoGenerationCreditId({ provider, duration, resolution: priceArgs.resolution, hasVideoRef: true })
  return { priceArgs, identifier }
}

/** What a run with already-measured reference clips holds and is expected to settle at (charged credits). */
export interface Seedance2RefVideoHoldQuote {
  /** The credits the run reserves — exactly the quote's `credits` with every clip known. */
  hold: number
  /** The credits it should settle at once delivered; null when a clip could not be measured. */
  expected: number | null
}

/**
 * The CHARGED hold and expected settlement of a reference-video run whose clip
 * lengths are already measured — for a caller that knows the lengths of clips
 * it will cut after quoting (the Cast Swap plugin, through
 * `tk.http.quoteSeedanceRefVideo`). The hold is {@link seedance2RefVideoQuote}
 * with every clip known (the reservation's own rule); `expected` is
 * `seedance2RefVideoExpectedBaseCredits`, marked up at the same identifier —
 * the figure `/v1/quote` states as `expected`.
 */
export async function seedance2RefVideoChargedHoldQuote(args: {
  provider: string
  resolution?: string
  duration?: number | string
  draft?: boolean
  /** Measured clip lengths in request order; NaN / null = unmeasurable (the worst case). */
  durationsSec: ReadonlyArray<number | null>
}): Promise<Seedance2RefVideoHoldQuote> {
  const settings = await getAppSettings()
  const charge = (identifier: string, base: number) => applyServiceMarkup(base, settings, identifier)
  const durationsSec = args.durationsSec.map((d) => (typeof d === "number" ? d : Number.NaN))
  const hold = seedance2RefVideoQuote({ ...args, durationsSec, unknownClips: 0, charge }).credits
  const { priceArgs, identifier } = quoteBasis(args)
  const expectedBase = seedance2RefVideoExpectedBaseCredits({
    provider: priceArgs.provider,
    resolution: priceArgs.resolution,
    outputDurationSec: priceArgs.outputDurationSec,
    autoDuration: isAutoVideoDuration(args.duration),
    durationsSec: durationsSec.slice(0, refVideoCapFor(args.provider)),
  })
  return { hold, expected: expectedBase === undefined ? null : charge(identifier, expectedBase) }
}
