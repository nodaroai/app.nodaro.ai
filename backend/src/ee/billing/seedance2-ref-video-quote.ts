import { SEEDANCE_EDIT_REF_VIDEO_SEC, VIDEO_REF_VIDEO_DURATION_LIMITS, pricedOutputDurationSec } from "@nodaro/shared/models"
import { uiResolutionFill } from "@nodaro/shared/video"
import { isAutoVideoDuration } from "@nodaro/shared/model-catalog"
import { videoGenerationCreditId } from "@nodaro/shared/credits"
import { getAppSettings } from "../../lib/app-settings.js"
import { refVideoCapFor } from "../../lib/ref-video-probe.js"
import type { VideoSourceTrim } from "../../lib/gemini-omni-12-source.js"
import { resolveVideoRequestNorm, videoRequestAsRun, videoRequestReferenceMedia } from "../../lib/video-request-norm.js"
import { refVideoWorstCaseSecFor } from "../../lib/ref-video-worst-case.js"
import { seedance2RefVideoBaseCreditsFromDurations, seedance2RefVideoExpectedBaseCredits } from "./seedance2-ref-video-credits.js"
import { applyServiceMarkup } from "./service-margin.js"

/** What a Seedance 2 reference-video run is quoted at (charged credits). */
export interface Seedance2RefVideoQuote {
  /** The credits the run reserves — or, while a clip is unknown, the most it can reserve. */
  credits: number
  /** The least it can RESERVE: `credits` when exact, else the cheapest reservation the unknown clips'
   *  lengths allow. A run whose length the model decides settles to what it makes, which can be lower. */
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
 * every clip measured, the longest clip rounded up plus a second; otherwise
 * (and for a declared `reference` with an automatic length) the longer of the
 * priced output and the longest clip.
 *
 * `durationsSec` are the probed clips in request order (a NaN — an unreadable
 * clip — is the worst case, as the reservation counts it). `unknownClips` are
 * wired clips whose URL is not known yet: `credits` prices them at the
 * provider's worst case, so a quote is never below what the run can reserve,
 * and `min` is the least the run can reserve (a run whose length the model
 * decides settles to what it makes, which can be lower) — the unknown clips at the shortest
 * length the provider accepts, or, when the request carries a reference task
 * type, at the edit window's lower bound if that run is cheaper. Nothing beyond
 * the provider's clip cap is counted — the run sends no more.
 *
 * The request levers are read the way the run reads them: an omitted
 * resolution is the model's UI fill (what the run sends), a draft is 480p
 * (`resolveVideoRequestNorm`), the requested reference task type is resolved
 * by the run's own rule (the length an `edit` or `extend` forces replaces the
 * requested one, and the declared type sizes the hold), and the output length
 * is the provider's priced one (`pricedOutputDurationSec` — Auto = the longest
 * clip), held through the reservation's own rule.
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
  /**
   * The REQUESTED reference task type (`referenceTaskType` on the run's body;
   * `undefined`: none), unvalidated (anything the model does not list is Auto).
   * Declared by the run's own rule (`resolveVideoRequestNorm`) on the clips
   * below — a clip not known yet counted at the provider's worst case, so the
   * quote prices the declaration the most it can cost — and the resolved type
   * sizes the hold, at the length it runs at. Required so no quote can skip it.
   */
  referenceTaskType: unknown
  /** The probed clips, in request order (NaN = unreadable → the worst case). */
  durationsSec: readonly number[]
  /** Wired clips whose length is not known (the worst case; `min` = the cheapest length they can have). */
  unknownClips: number
  /** The node's trim of its source clip (per-second Gemini Omni: it decides what is billed). */
  videoTrim?: VideoSourceTrim
}

/**
 * The quote above with the markup supplied (`charge` marks a base total up once
 * at an identifier) — synchronous, so a workflow estimate prices through its
 * own price table (`ChargedPriceTable.charge`) with this same arithmetic.
 */
export function seedance2RefVideoQuote(
  args: Seedance2RefVideoQuoteRequest & { charge: (identifier: string, baseCredits: number) => number },
): Seedance2RefVideoQuote {
  const { provider, videoTrim } = args
  const cap = refVideoCapFor(provider)
  const known = args.durationsSec.slice(0, cap)
  const unknown = Math.max(0, Math.min(args.unknownClips, cap - known.length))
  const withUnknownAt = (sec: number) => [...known, ...Array<number>(unknown).fill(sec)]

  // The ceiling: the declaration decided with every unknown clip at the
  // provider's worst case, whose amount counts them as unmeasurable.
  const ceiling = quoteBasis(args, withUnknownAt(refVideoWorstCaseSecFor(provider)))
  const ceilingBase = seedance2RefVideoBaseCreditsFromDurations({ ...ceiling.priceArgs, videoTrim, durationsSec: withUnknownAt(Number.NaN) })
  // Marked up once, at the identifier the run's reservation is marked up at.
  const credits = args.charge(ceiling.identifier, ceilingBase)
  if (unknown === 0) return { credits, min: credits, exact: true }

  // The floor: the cheapest run the unknown clips' lengths allow. A run costs
  // more as a clip grows, except where a longer clip flips the declaration —
  // an edit is declared only from the edit window's lower bound — so the floor
  // is the cheaper of those two runs, each declared (or not) and priced at its
  // own length by `quoteBasis`. A request that declares nothing has only the first.
  const shortest = VIDEO_REF_VIDEO_DURATION_LIMITS[provider]?.minSec ?? 1
  const editFrom = SEEDANCE_EDIT_REF_VIDEO_SEC.min
  const floorLengths = args.referenceTaskType !== undefined && editFrom > shortest && editFrom <= refVideoWorstCaseSecFor(provider)
    ? [shortest, editFrom]
    : [shortest]
  const min = Math.min(...floorLengths.map((sec) => {
    const clips = withUnknownAt(sec)
    const { priceArgs, identifier } = quoteBasis(args, clips)
    return args.charge(identifier, seedance2RefVideoBaseCreditsFromDurations({ ...priceArgs, videoTrim, durationsSec: clips }))
  }))
  return { credits, min, exact: false }
}

/**
 * The request levers read the way the run reads them: an omitted resolution
 * is the model's UI fill (what the run sends), a draft is 480p, and the
 * requested reference task type is decided on the clips the figure being
 * priced assumes — all by `resolveVideoRequestNorm`, the routes' and the
 * workflow run's own rule, fed `clips`: every reference clip's length in
 * request order (NaN = unmeasured). The declaration is resolved ONCE here and
 * every figure below reads it: the length the run is SENT at (`runDuration`,
 * `videoRequestAsRun`: an `edit` moves it to Auto, an `extend` from Auto to a
 * set length) prices the output, the reservation's held-output rule and the
 * markup identifier, and the resolved type (`priceArgs.referenceTaskType`)
 * sizes the hold. A request that declares nothing is priced exactly as before.
 */
function quoteBasis(
  args: Pick<Seedance2RefVideoQuoteRequest, "provider" | "resolution" | "duration" | "draft" | "referenceTaskType">,
  clips: readonly number[],
) {
  const { provider } = args
  const norm = resolveVideoRequestNorm({
    provider,
    resolution: args.resolution ?? uiResolutionFill(provider),
    duration: args.duration,
    draft: args.draft === true,
    referenceTaskType: args.referenceTaskType,
    // Only reference videos are known here; any declaration needs one, and the
    // quote always has one (known or unknown).
    referenceMedia: videoRequestReferenceMedia({ referenceVideoUrls: clips }, clips),
  })
  const runDuration = videoRequestAsRun({ duration: args.duration }, norm).duration
  const priceArgs = {
    provider,
    resolution: norm.resolution ?? "720p",
    outputDurationSec: pricedOutputDurationSec(provider, runDuration),
    requestedDuration: runDuration,
    referenceTaskType: norm.referenceTaskType,
  }
  const identifier = videoGenerationCreditId({ provider, duration: runDuration, resolution: priceArgs.resolution, hasVideoRef: true })
  return { priceArgs, identifier, runDuration }
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
  /** The requested reference task type, as the run's body carries it; absent = none
   *  (see `Seedance2RefVideoQuoteRequest.referenceTaskType`). */
  referenceTaskType?: unknown
  /** Measured clip lengths in request order; NaN / null = unmeasurable (the worst case). */
  durationsSec: ReadonlyArray<number | null>
}): Promise<Seedance2RefVideoHoldQuote> {
  const settings = await getAppSettings()
  const charge = (identifier: string, base: number) => applyServiceMarkup(base, settings, identifier)
  const durationsSec = args.durationsSec.map((d) => (typeof d === "number" ? d : Number.NaN))
  const request = { ...args, referenceTaskType: args.referenceTaskType, durationsSec }
  const hold = seedance2RefVideoQuote({ ...request, unknownClips: 0, charge }).credits
  const known = durationsSec.slice(0, refVideoCapFor(args.provider))
  const { priceArgs, identifier, runDuration } = quoteBasis(request, known)
  const expectedBase = seedance2RefVideoExpectedBaseCredits({
    provider: priceArgs.provider,
    resolution: priceArgs.resolution,
    outputDurationSec: priceArgs.outputDurationSec,
    autoDuration: isAutoVideoDuration(runDuration),
    durationsSec: known,
  })
  return { hold, expected: expectedBase === undefined ? null : charge(identifier, expectedBase) }
}
