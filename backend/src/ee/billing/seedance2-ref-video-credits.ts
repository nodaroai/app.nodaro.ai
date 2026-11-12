import { MODEL_CATALOG, SEEDANCE_DRAFT_FINALIZE_PROVIDER, SEEDANCE_DRAFT_MODELS, VIDEO_DURATION_AUTO, isAutoVideoDuration } from "@nodaro/shared/model-catalog"
import {
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  VIDEO_REF_RATE_PROVIDERS,
  isGeminiOmniPerSecondProvider,
  isKling4Provider,
  normalizeKling4Resolution,
  isKling4FlashProvider,
  KLING_4_FLASH_RESOLUTION,
  listedSeedanceTaskType,
  pricedOutputDurationSec,
  supportsAutoVideoDuration,
} from "@nodaro/shared/models"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { CONTAINER_OVERHANG_SEC } from "@nodaro/shared/video"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError, getModelCreditBaseCost } from "./credits.js"
// The probe lives in CORE (lib/ref-video-probe.ts) because the routes' duration
// pre-check — plain input validation, not a credit feature — must run in
// community/business too, where no ee/ module may be loaded at runtime.
// ee -> core is the allowed direction; re-exported so existing importers of
// this module are unaffected.
import { probeRefVideoDurations, refVideoProbeCandidates } from "../../lib/ref-video-probe.js"
import { refVideoWorstCaseSecFor } from "../../lib/ref-video-worst-case.js"
import { geminiOmni12LadderSec, videoRefBilledDurations, type VideoSourceTrim } from "../../lib/gemini-omni-12-source.js"
import { probeMediaDuration } from "../../providers/video/ffmpeg-utils.js"

export { probeRefVideoDurations, refVideoCapFor } from "../../lib/ref-video-probe.js"
export { refVideoWorstCaseSecFor } from "../../lib/ref-video-worst-case.js"

const isUsableDuration = (d: number): boolean => Number.isFinite(d) && d > 0

/**
 * BASE (0%-markup) credit total for a Seedance 2 "with video input" reference run.
 *
 * KIE bills these runs by `unit × (input_video_duration + output_duration)`, but the
 * seeded `-ref` credit composites only encode the per-8s output rate. `commit_credits`
 * can only refund (never up-charge), so we must reserve the correct amount up front —
 * this helper scales the exact per-second base rate by the FULL billed duration
 * (sum of reference-video durations + output duration).
 *
 * The per-second base rate is derived EXACTLY from the seeded 8s `-ref` composite:
 * `perSecBase = STATIC_CREDIT_COSTS["{provider}:8s:{res}-ref"] / 8`
 * (e.g. 720p 50/8 = 6.25, 1080p 124/8 = 15.5, 4k 256/8 = 32, 480p 23/8 = 2.875).
 *
 * `resolution` is clamped to the provider's catalog resolutions (single source of
 * truth) — an unsupported tier (e.g. a stale 1080p on seedance-2-mini, which only
 * exposes 480p/720p) snaps to the model's top priced tier so the looked-up composite
 * is always seeded — mirrors `packages/shared/src/credit-identifiers.ts`.
 *
 * This is the EXACT arithmetic, with no worst-case rule: the reservation side
 * ({@link seedance2RefVideoBaseCreditsFromDurations}) decides what the billed
 * durations are, and the settlement side ({@link seedance2RefVideoActualBaseCredits})
 * feeds it the measured ones.
 *
 * Hard-fail policy: throws `PriceNotConfiguredError` (the same error
 * `getModelCreditBaseCost` throws) when the clamped 8s `-ref` composite is missing.
 */
export function seedance2RefVideoBaseCredits(args: {
  provider: string
  resolution: string
  outputDurationSec: number
  inputVideoDurationSec: number
}): number {
  const { provider, resolution, outputDurationSec, inputVideoDurationSec } = args

  // A per-second Gemini Omni edit bills the clip on the model's ordinary ladder:
  // no `-ref` rate and no input seconds of its own.
  if (isGeminiOmniPerSecondProvider(provider)) {
    const ladderId = buildVideoCreditModelIdentifier(
      provider, geminiOmni12LadderSec(outputDurationSec), undefined, undefined, undefined, resolution, /* hasVideoRef */ true,
    )
    const row = STATIC_CREDIT_COSTS[ladderId]
    if (row === undefined) throw new PriceNotConfiguredError(ladderId)
    return row
  }

  // Clamp the requested resolution to the provider's catalog resolutions, snapping
  // an unsupported tier to the top (last) priced tier — mirrors credit-identifiers.ts.
  // A VIDEO_REF_RATE_PROVIDERS model (Kling 4.0) renders through its own
  // normalizer instead, which collapses an unknown tier to 720p — billed the
  // same way, so render == billed. Kling 4.0 Flash renders 720p whatever it is
  // asked (it has no other tier, and no `1080p-ref` row).
  const supported = MODEL_CATALOG[provider]?.resolutions ?? ["480p", "720p", "1080p"]
  const want = resolution === "4k" ? "4k" : resolution === "1080p" ? "1080p" : resolution === "720p" ? "720p" : "480p"
  const res = isKling4FlashProvider(provider)
    ? KLING_4_FLASH_RESOLUTION
    : isKling4Provider(provider)
      ? normalizeKling4Resolution(resolution)
      : supported.includes(want) ? want : (supported[supported.length - 1] ?? "480p")

  const identifier = `${provider}:8s:${res}-ref`
  const composite8s = STATIC_CREDIT_COSTS[identifier]
  if (composite8s === undefined) {
    // Hard-fail: an unconfigured composite must never silently fall back to a wrong
    // (under-)reservation — matches getModelCreditBaseCost's policy.
    throw new PriceNotConfiguredError(identifier)
  }

  const perSecBase = composite8s / 8
  return Math.ceil(perSecBase * billedRefVideoSeconds(provider, outputDurationSec, inputVideoDurationSec))
}

/**
 * The seconds a reference-video run bills, from its output and its summed
 * input clips — the provider's own rule:
 *  - Seedance 2 family: input + output;
 *  - Kling 4.0 (VIDEO_REF_RATE_PROVIDERS): output + max(output, input) — "if the
 *    input is shorter than the output, the input is counted as the output
 *    duration" (kie.ai/kling-4-0 billing: a 10s output with a 5s input bills
 *    20s, with a 15s input 25s).
 *  - per-second Gemini Omni: the output alone, which follows the source clip
 *    (kie.ai/gemini-omni-1-2-flash: "billed for the length of the input video").
 */
export function billedRefVideoSeconds(provider: string, outputDurationSec: number, inputVideoDurationSec: number): number {
  if (isGeminiOmniPerSecondProvider(provider)) return outputDurationSec
  return VIDEO_REF_RATE_PROVIDERS.has(provider)
    ? outputDurationSec + Math.max(outputDurationSec, inputVideoDurationSec)
    : inputVideoDurationSec + outputDurationSec
}

/**
 * Whether the provider may render LONGER than the requested duration because
 * of its reference clip. Only Seedance does (an edit renders the clip's own
 * length); Kling 4.0 always renders the requested duration.
 */
function outputFollowsReferenceClip(provider: string): boolean {
  return !VIDEO_REF_RATE_PROVIDERS.has(provider)
}

/**
 * The input seconds a run bills for ALREADY-PROBED reference clips: a usable
 * probe verbatim, an unusable one (NaN / ≤0 / a `null` that a NaN became in
 * JSON) at the provider's per-clip worst case; the SUM capped at the
 * provider's declared total (`maxTotalSec`), past which the provider rejects
 * the run and nothing can be billed. The SINGLE place that rule lives — the
 * reservation and the settlement both read it, so the two agree on the input
 * side by construction.
 */
function billedInputSeconds(provider: string, durationsSec: readonly unknown[]): { perClip: number[]; totalSec: number } {
  const worst = refVideoWorstCaseSecFor(provider)
  const perClip = durationsSec.map((d) => (typeof d === "number" && isUsableDuration(d) ? d : worst))
  const sum = perClip.reduce((acc, d) => acc + d, 0)
  const cap = VIDEO_REF_VIDEO_DURATION_LIMITS[provider]?.maxTotalSec
  return { perClip, totalSec: cap === undefined ? sum : Math.min(sum, cap) }
}

/**
 * The seconds of margin an Auto-duration edit's hold adds over its source
 * clip, after rounding the clip up to a whole second.
 */
export const SEEDANCE_AUTO_EDIT_HOLD_MARGIN_SEC = 1

/**
 * The OUTPUT seconds a reference-video run's hold covers — the ONE rule the
 * reservation, every quote of it and the settlement's over-run check read:
 *
 *  - AUTO duration (the edit shape, `SEEDANCE_VIDEO_EDIT_SHAPE`) with every
 *    reference clip measured, on a model whose output follows its clip
 *    (Seedance): the edit renders the length of the clip it edits — usually
 *    the first, `@video_1`, but the model may edit any of them — so the hold
 *    is the LONGEST clip rounded up to a whole second plus
 *    {@link SEEDANCE_AUTO_EDIT_HOLD_MARGIN_SEC}, never above the model's
 *    longest clip. Every clip also counts on the input side. With one clip,
 *    that clip is the longest. NOT for a run that declared `reference`
 *    ({@link declaresAutoReference}): a reference runs at a length the model
 *    picks within its range, not a clip's, so it takes the worst case below.
 *  - Otherwise the longer of the priced output (`outputDurationSec`, from
 *    `pricedOutputDurationSec` — Auto = the model's longest clip) and the
 *    longest reference clip: Seedance decides from the prompt whether a run
 *    with a video wired is a style run (renders the requested duration) or an
 *    EDIT of that clip, which renders the clip's own length — and the verdict
 *    arrives only as a rejection the provider layer answers by resubmitting
 *    (`runVideoTaskWithSeedanceEditRetry`). An unmeasurable clip (NaN/<=0)
 *    counts as the provider's per-clip cap ({@link refVideoWorstCaseSecFor}),
 *    so an Auto run with one keeps that worst case.
 *  - Kling 4.0 renders exactly the requested duration: `outputDurationSec`.
 */
export function seedance2RefVideoHeldOutputSec(args: {
  provider: string
  /** `pricedOutputDurationSec(provider, requestedDuration)`. */
  outputDurationSec: number
  /** The request's own duration: Auto (-1) is the edit shape. */
  requestedDuration: unknown
  /** The run's DECLARED reference task type, as resolved (`resolveSeedanceTaskType`; a job's
   *  `input_data.referenceTaskType`); `undefined` when none is declared. Required so no path
   *  that holds, quotes or settles a run can skip it. */
  referenceTaskType: unknown
  durationsSec: readonly unknown[]
}): number {
  const { provider, outputDurationSec, requestedDuration, referenceTaskType, durationsSec } = args
  // A per-second Gemini Omni edit renders its source clip, rounded up to a whole
  // second so a clip a hair over a rung still holds the rung above it.
  if (isGeminiOmniPerSecondProvider(provider)) {
    const clipSec = billedInputSeconds(provider, durationsSec).perClip[0] ?? refVideoWorstCaseSecFor(provider)
    return Math.ceil(clipSec - 0.05)
  }
  if (!outputFollowsReferenceClip(provider)) return outputDurationSec
  const autoEdit = autoEditHeldOutputSec(provider, requestedDuration, referenceTaskType, durationsSec)
  if (autoEdit !== undefined) return autoEdit
  return Math.max(outputDurationSec, ...billedInputSeconds(provider, durationsSec).perClip)
}

/**
 * Whether the run DECLARED `reference` with an automatic length, on a model
 * that lists that type (`listedSeedanceTaskType`, the one membership test) and
 * takes an automatic length. Such a run renders a length the model picks
 * within its range (KIE: -1 follows the input video's length only for an edit),
 * so it is held at the worst case and charged what it makes, up to that hold.
 */
function declaresAutoReference(provider: string, requestedDuration: unknown, referenceTaskType: unknown): boolean {
  return listedSeedanceTaskType(provider, referenceTaskType) === "reference"
    && isAutoVideoDuration(requestedDuration) && supportsAutoVideoDuration(provider)
}

/** The Auto-edit hold of {@link seedance2RefVideoHeldOutputSec}, or undefined when the run is not that shape. */
function autoEditHeldOutputSec(provider: string, requestedDuration: unknown, referenceTaskType: unknown, durationsSec: readonly unknown[]): number | undefined {
  if (!outputFollowsReferenceClip(provider)) return undefined
  if (!isAutoVideoDuration(requestedDuration) || !supportsAutoVideoDuration(provider)) return undefined
  // A declared reference is no edit: it takes the worst case.
  if (declaresAutoReference(provider, requestedDuration, referenceTaskType)) return undefined
  if (durationsSec.length === 0 || !durationsSec.every((d) => typeof d === "number" && isUsableDuration(d))) return undefined
  // The longest clip, wherever it is: the model may edit any of them.
  const longestSec = Math.max(...(durationsSec as readonly number[]))
  // The model's longest clip: what Auto is priced at without a measured clip.
  const cap = pricedOutputDurationSec(provider, VIDEO_DURATION_AUTO)
  return Math.min(Math.ceil(longestSec) + SEEDANCE_AUTO_EDIT_HOLD_MARGIN_SEC, cap)
}

/**
 * BASE credits a RESERVATION must hold for a reference-video run, from
 * ALREADY-PROBED durations — the most the run can bill under the hold rule
 * ({@link seedance2RefVideoHeldOutputSec}), since `commit_credits` only ever
 * refunds. Callers that hold a probe result (the routes' duration pre-check
 * stashes one on the request) price through here instead of running a second
 * uncached ffprobe per clip.
 *
 * The input side is {@link billedInputSeconds}: an unusable probe counts as
 * the provider's per-clip cap. The settlement
 * ({@link seedance2RefVideoActualBaseCredits}) measures what was delivered and
 * refunds the difference, so a style run still pays its exact
 * `unit × (input + requested)` price.
 */
export function seedance2RefVideoBaseCreditsFromDurations(args: {
  provider: string
  resolution: string
  outputDurationSec: number
  /** The request's own duration (Auto = -1, the edit shape). Required so no reservation path can skip the rule. */
  requestedDuration: unknown
  /** The run's declared reference task type, resolved (`undefined`: none). Required for the same reason. */
  referenceTaskType: unknown
  durationsSec: readonly number[]
  /** The node's trim of its source clip (per-second Gemini Omni: it decides what is billed). */
  videoTrim?: VideoSourceTrim
}): number {
  const { provider, resolution } = args
  const durationsSec = videoRefBilledDurations(provider, args.durationsSec, args.videoTrim)
  const { totalSec } = billedInputSeconds(provider, durationsSec)
  return seedance2RefVideoBaseCredits({
    provider,
    resolution,
    outputDurationSec: seedance2RefVideoHeldOutputSec({ ...args, durationsSec }),
    inputVideoDurationSec: totalSec,
  })
}

/**
 * BASE credits a reference-video run is EXPECTED to bill once delivered — a
 * quote's `expected`, beside the worst case the reservation holds. Same input
 * rule as the reservation ({@link billedInputSeconds}); the output is the
 * length the run will most likely render:
 *  - Auto duration (the edit shape, `SEEDANCE_VIDEO_EDIT_SHAPE`): an edit
 *    most likely renders its SOURCE clip's length — the first clip
 *    (`@video_1`); any extra clips are references, even a longer one (the
 *    reservation holds the LONGEST clip, rounded up, plus a second, since the
 *    model may edit another clip);
 *  - a fixed duration: the requested seconds (a style run).
 * The settlement still measures what was delivered, so this is an estimate a
 * client can show, not a price. Undefined when a clip could not be measured:
 * that clip's length is unknown, so the expected cost is too.
 */
export function seedance2RefVideoExpectedBaseCredits(args: {
  provider: string
  resolution: string
  outputDurationSec: number
  autoDuration: boolean
  durationsSec: readonly number[]
}): number | undefined {
  const { provider, resolution, outputDurationSec, autoDuration, durationsSec } = args
  if (durationsSec.length === 0 || !durationsSec.every(isUsableDuration)) return undefined
  const { perClip, totalSec } = billedInputSeconds(provider, durationsSec)
  const followsClip = isGeminiOmniPerSecondProvider(provider) || (autoDuration && outputFollowsReferenceClip(provider))
  const renderedSec = followsClip ? perClip[0]! : outputDurationSec
  return seedance2RefVideoBaseCredits({ provider, resolution, outputDurationSec: renderedSec, inputVideoDurationSec: totalSec })
}

/**
 * ffprobe the connected reference videos, sum their durations, and return the
 * BASE (0%-markup) credit total for the full `unit × (input + output)` Seedance 2
 * reference run. This is the SINGLE shared entry point for both the route
 * `computeCredits` hook (A2) and the orchestrator reservation (A3) — neither
 * duplicates the probe/sum/worst-case logic.
 *
 * Composed from the two halves above so there is exactly ONE probe
 * implementation and ONE worst-case implementation; a caller that already
 * probed (the routes' pre-check) skips straight to
 * {@link seedance2RefVideoBaseCreditsFromDurations}.
 */
export async function seedance2RefVideoBaseCreditsFromUrls(args: {
  provider: string
  resolution: string
  outputDurationSec: number
  /** The request's own duration (Auto = -1, the edit shape). */
  requestedDuration: unknown
  /** The run's declared reference task type, resolved (`undefined`: none). */
  referenceTaskType: unknown
  referenceVideoUrls: readonly unknown[]
  videoTrim?: VideoSourceTrim
}): Promise<number> {
  const { provider, resolution, outputDurationSec, requestedDuration, referenceTaskType, referenceVideoUrls, videoTrim } = args
  const durationsSec = await probeRefVideoDurations({ provider, referenceVideoUrls })
  return seedance2RefVideoBaseCreditsFromDurations({ provider, resolution, outputDurationSec, requestedDuration, referenceTaskType, durationsSec, videoTrim })
}

/**
 * BASE credits the run ACTUALLY billed, measured after the provider delivered:
 * `unit × (Σ reference clips + the delivered clip's length)`. The worker
 * commits this in place of the worst-case reservation above, so an edit is
 * charged for the length it rendered and a style run is refunded down to its
 * requested duration.
 *
 * The delivered clip is what KIE charged for — so the RAW provider output is
 * measured, before any post-process (a smart-loop-cut shortens what the user
 * keeps, not what was billed).
 *
 * The reference clips are NOT re-probed when the reservation's own probe is
 * on hand (`durationsSec` — both reservation lanes carry it on the job): the
 * settlement then reads the very numbers the reserve read, so the input side
 * cannot drift between the two, and a reference URL that has gone stale by
 * the time the run finishes cannot turn a refund into a worst-case charge.
 * Only a job that carries no probe (in flight across the deploy that added
 * it) re-probes, under the same worst-case rule.
 *
 * An Auto-duration edit is held for its longest reference clip plus a margin
 * ({@link seedance2RefVideoHeldOutputSec}), not the model's longest clip. A
 * delivered clip longer than that hold is charged at the hold — the most the
 * run reserved, all `commit_credits` could collect anyway — and logs an
 * `[ALERT]` naming the job, the held and the delivered seconds, because it
 * means the hold rule's assumption (an Auto run renders the length of one of
 * its clips, whichever it edits) did not hold. A run that declared `reference`
 * with an automatic length is held at the worst case instead and charged what
 * it delivered, up to that hold.
 *
 * Throws when the delivered clip cannot be measured — the caller then commits
 * the reservation, which is today's behaviour and never under-bills.
 *
 * The seconds are {@link seedance2RefVideoActualSeconds}'s. A caller that has
 * already measured them (the settle shim, which also records the run's
 * provider cost from them) passes that measurement in, so the delivered clip
 * is probed — and an over-run alerted — once.
 */
export async function seedance2RefVideoActualBaseCredits(
  args: Seedance2RefVideoActualArgs,
  measured?: Pick<Seedance2RefVideoActualSeconds, "chargedOutputSec" | "inputSec">,
): Promise<number> {
  const { chargedOutputSec, inputSec } = measured ?? await seedance2RefVideoActualSeconds(args)
  return seedance2RefVideoBaseCredits({
    provider: args.provider,
    resolution: args.resolution,
    outputDurationSec: chargedOutputSec,
    inputVideoDurationSec: inputSec,
  })
}

/** What {@link seedance2RefVideoActualSeconds} measures a delivered reference-video run with. */
export interface Seedance2RefVideoActualArgs {
  provider: string
  resolution: string
  outputUrl: string
  referenceVideoUrls: readonly unknown[]
  /** The reservation's probe of `referenceVideoUrls`, when the job carries it. */
  durationsSec?: readonly unknown[]
  /** The request's own duration (Auto = -1): what the hold was sized from. */
  requestedDuration: unknown
  /** The run's declared reference task type (a job's `input_data.referenceTaskType`, present only
   *  when one was declared): what the hold was sized from too. */
  referenceTaskType: unknown
  /** For the over-run alert only. */
  jobId?: string
}

/** The seconds a delivered reference-video run bills — see {@link seedance2RefVideoActualSeconds}. */
export interface Seedance2RefVideoActualSeconds {
  /** What was rendered: the measured length (Kling 4.0's rounded to the whole second it bills), never capped. */
  deliveredSec: number
  /** `deliveredSec` capped at the hold of an Auto edit or of a declared reference with an automatic
   *  length — the output seconds the charge bills. */
  chargedOutputSec: number
  /** The reference clips' seconds, as the run bills them ({@link billedInputSeconds}). */
  inputSec: number
  /** The delivered clip's length as it was measured, unrounded — the length it really is. */
  measuredSec: number
}

/**
 * The seconds the settlement ({@link seedance2RefVideoActualBaseCredits})
 * prices, measured from the delivered clip and the reservation's probe of the
 * reference clips (re-probed only when the job carries none). Exported so the
 * run's recorded provider cost reads the very seconds its charge was measured
 * from.
 *
 * A delivered clip longer than an Auto edit's hold is charged at the hold
 * (`chargedOutputSec`) and logs the `[ALERT]` naming the job, the held and the
 * delivered seconds; `deliveredSec` stays what was rendered. A run that
 * declared `reference` with an automatic length is held at the worst case and
 * charged what it delivered, never above that hold
 * ({@link chargedWithinWorstCaseHold}). Any other run delivered past its hold
 * (a fixed length, a declared `extend`) logs the same kind of `[ALERT]` and is
 * charged as measured ({@link alertOverrunPastHold}).
 *
 * Throws when the delivered clip cannot be measured.
 */
export async function seedance2RefVideoActualSeconds(args: Seedance2RefVideoActualArgs): Promise<Seedance2RefVideoActualSeconds> {
  const { provider, outputUrl, referenceVideoUrls, requestedDuration, referenceTaskType } = args
  const reserved = Array.isArray(args.durationsSec) ? args.durationsSec : undefined
  const [measuredOutputSec, durationsSec] = await Promise.all([
    probeMediaDuration(outputUrl),
    reserved ? remeasureUnreadClips(provider, reserved, referenceVideoUrls) : probeRefVideoDurations({ provider, referenceVideoUrls }),
  ])
  // Kling 4.0 renders whole seconds (a 3s clip measures 3.04s — live
  // 2026-10-23), so the measured length rounds to the second it was billed at.
  const deliveredSec = outputFollowsReferenceClip(provider)
    ? measuredOutputSec
    : Math.max(1, Math.round(measuredOutputSec))
  if (!isUsableDuration(deliveredSec)) throw new Error(`unusable output duration: ${measuredOutputSec}`)
  // The hold is what the RESERVATION held, so it reads the reservation's own
  // probe — a clip measured only now never re-sizes it. Every hold below
  // (the Auto edit's, a declared reference's, the over-run alert's) reads it;
  // only the input side reads the re-measured clips.
  const heldClipsSec = reserved ?? durationsSec
  const heldSec = autoEditHeldOutputSec(provider, requestedDuration, referenceTaskType, heldClipsSec)
  let chargedOutputSec = deliveredSec
  if (heldSec !== undefined && deliveredSec > heldSec) {
    console.error(
      `[ALERT] [billing] Seedance Auto edit delivered more than it held; charging the hold: job=${args.jobId ?? "unknown"} provider=${provider} heldSec=${heldSec} deliveredSec=${deliveredSec}`,
    )
    chargedOutputSec = heldSec
  } else if (heldSec === undefined && outputFollowsReferenceClip(provider) && declaresAutoReference(provider, requestedDuration, referenceTaskType)) {
    chargedOutputSec = chargedWithinWorstCaseHold(args, deliveredSec, heldClipsSec)
  } else if (heldSec === undefined) {
    alertOverrunPastHold(args, deliveredSec, heldClipsSec)
  }
  return { deliveredSec, chargedOutputSec, inputSec: billedInputSeconds(provider, durationsSec).totalSec, measuredSec: measuredOutputSec }
}

/**
 * The output seconds the reservation held for a run that is NOT an Auto edit
 * ({@link seedance2RefVideoHeldOutputSec}: the longer of the priced output and
 * the longest clip), recomputed from what the settlement carries.
 */
function worstCaseHeldOutputSec(args: Seedance2RefVideoActualArgs, durationsSec: readonly unknown[]): number {
  const { provider, requestedDuration, referenceTaskType } = args
  const requested = typeof requestedDuration === "number" || typeof requestedDuration === "string" ? requestedDuration : undefined
  return seedance2RefVideoHeldOutputSec({
    provider,
    outputDurationSec: pricedOutputDurationSec(provider, requested),
    requestedDuration,
    referenceTaskType,
    durationsSec,
  })
}

/**
 * The charged output seconds of a run that declared `reference` with an
 * automatic length ({@link declaresAutoReference}): what it delivered, never
 * above the worst-case hold it reserved. A delivery past the hold by more than
 * a container's overhang also logs an `[ALERT]` naming the job, the held and
 * the delivered seconds — the hold is already the model's longest output.
 */
function chargedWithinWorstCaseHold(args: Seedance2RefVideoActualArgs, deliveredSec: number, durationsSec: readonly unknown[]): number {
  const heldSec = worstCaseHeldOutputSec(args, durationsSec)
  if (deliveredSec <= heldSec) return deliveredSec
  if (deliveredSec > heldSec + CONTAINER_OVERHANG_SEC) {
    console.error(
      `[ALERT] [billing] Seedance reference run delivered more than it held; charging the hold: job=${args.jobId ?? "unknown"} provider=${args.provider} heldSec=${heldSec} deliveredSec=${deliveredSec}`,
    )
  }
  return heldSec
}

/**
 * The over-run alert for a run that is NOT an Auto edit — a fixed length (a
 * declared `extend`, a style run) or an Auto run held at the worst case —
 * on a model whose output follows its reference clip (Seedance). The hold is
 * the reservation's own ({@link worstCaseHeldOutputSec}), and a delivery past
 * it by more than a container's overhang costs more than was reserved, a
 * shortfall `commit_credits` cannot collect. Log only: the charge stays what
 * was measured, exactly as without the alert. A per-second Gemini Omni edit is
 * left out (its hold reads the node's trim, which the settlement does not
 * carry).
 */
function alertOverrunPastHold(args: Seedance2RefVideoActualArgs, deliveredSec: number, durationsSec: readonly unknown[]): void {
  const { provider } = args
  if (!outputFollowsReferenceClip(provider) || isGeminiOmniPerSecondProvider(provider)) return
  const heldSec = worstCaseHeldOutputSec(args, durationsSec)
  if (deliveredSec <= heldSec + CONTAINER_OVERHANG_SEC) return
  console.error(
    `[ALERT] [billing] Seedance run delivered more than it held; the shortfall is not collected: job=${args.jobId ?? "unknown"} provider=${provider} heldSec=${heldSec} deliveredSec=${deliveredSec}`,
  )
}

/**
 * How long the settlement's re-measure ({@link remeasureUnreadClips}) may take.
 * It runs between the provider's delivery and the job's finalize, so it holds
 * a FINISHED clip back from the user, and it probes only clips that already
 * failed at the reservation — the likeliest to be slow or unreachable. Without
 * a budget each probe could wait out ffprobe's 120 s watchdog, four at a time.
 *
 *  - Per clip, 5 s: ffprobe reads only a clip's container header, which a
 *    reachable host serves in a second or two, so 5 s is generous for a host
 *    that has recovered and short for one that has not. The ffprobe process
 *    is killed at the budget.
 *  - In all, 10 s: four clips are probed at a time, so ten clips would take
 *    three rounds of 5 s; the ceiling allows two — a short wait set against
 *    a run that took minutes, and far inside any node's timeout.
 *
 * A clip not read within the budget keeps the worst case the run reserved, so
 * the budget can only leave a charge where it was, never raise it.
 */
export const SETTLE_REMEASURE_CLIP_TIMEOUT_MS = 5_000
export const SETTLE_REMEASURE_TOTAL_MS = 10_000

/**
 * The reservation's probe of the reference clips, with every clip it could not
 * measure (NaN, ≤0, or the `null` a NaN becomes in JSON) measured again now.
 * A clip that reads now counts at its length, never above the worst case the
 * reservation held for it ({@link refVideoWorstCaseSecFor}); one that still
 * cannot be read stays unusable, so {@link billedInputSeconds} keeps the worst
 * case. Each clip's figure can only fall, so the settlement can only lower
 * the charge. The probe is aligned to its clips by
 * `refVideoProbeCandidates`, the rule that made it; a probe of another length
 * (a stale job) is kept as it is. The re-measure runs within
 * {@link SETTLE_REMEASURE_CLIP_TIMEOUT_MS} per clip and
 * {@link SETTLE_REMEASURE_TOTAL_MS} in all, and never throws.
 */
async function remeasureUnreadClips(
  provider: string,
  reserved: readonly unknown[],
  referenceVideoUrls: readonly unknown[],
): Promise<unknown[]> {
  const clips = refVideoProbeCandidates(provider, referenceVideoUrls)
  const unread = reserved.flatMap((d, i) => (typeof d === "number" && isUsableDuration(d) ? [] : [i]))
  if (unread.length === 0 || clips.length !== reserved.length) return [...reserved]
  const fresh = await probeRefVideoDurations({
    provider,
    referenceVideoUrls: unread.map((i) => clips[i]!),
    budget: { clipTimeoutMs: SETTLE_REMEASURE_CLIP_TIMEOUT_MS, totalMs: SETTLE_REMEASURE_TOTAL_MS },
  }).catch(() => [] as number[])
  const worst = refVideoWorstCaseSecFor(provider)
  const out = [...reserved]
  unread.forEach((clip, k) => {
    const d = fresh[k]
    if (typeof d === "number" && isUsableDuration(d)) out[clip] = Math.min(d, worst)
  })
  return out
}

/**
 * BASE credits an AUTO-duration run with NO reference video actually billed.
 *
 * Such a run is reserved at the model's longest clip (`pricedOutputDurationSec`
 * maps Auto to the top duration tier) because only the model knows the length
 * it will pick. Once delivered, the clip is priced exactly as a fixed-duration
 * request of that length would have been: the measured seconds go back through
 * `buildVideoCreditModelIdentifier`, so the tier ladder, the resolution clamp
 * and the DB-first price lookup are the reservation's own — no second formula.
 *
 * A container reports a hair over the nominal length (5.04s for a 5s clip), so
 * the seconds are rounded UP only past a quarter second; a genuinely
 * in-between clip still lands on the next tier, never the cheaper one.
 *
 * Throws when the clip cannot be measured or the tier is unpriced — the caller
 * then commits the reservation (never under-bills).
 *
 * The seconds are {@link seedance2AutoDurationActualSeconds}'s; a caller that
 * has already measured them (the settle shim) passes them in, so the clip is
 * probed once.
 */
export async function seedance2AutoDurationActualBaseCredits(
  args: {
    provider: string
    resolution: string | undefined
    outputUrl: string
  },
  measuredSec?: number,
): Promise<number> {
  const seconds = measuredSec ?? await seedance2AutoDurationActualSeconds(args)
  const identifier = buildVideoCreditModelIdentifier(
    args.provider, seconds, undefined, undefined, undefined, args.resolution, /* hasVideoRef */ false,
  )
  return (await getModelCreditBaseCost(identifier)).creditCost
}

/**
 * The whole seconds an AUTO-duration run with no reference video bills (see
 * {@link seedance2AutoDurationActualBaseCredits}): the delivered clip's
 * length, rounded UP only past a quarter second. Exported so the run's
 * recorded provider cost reads the very seconds its charge was priced from.
 * Throws when the clip cannot be measured.
 */
export async function seedance2AutoDurationActualSeconds(args: { outputUrl: string }): Promise<number> {
  return (await seedance2AutoDurationMeasure(args)).outputSec
}

/**
 * One measurement of an AUTO-duration run's delivered clip: `outputSec`, the
 * whole seconds it bills ({@link seedance2AutoDurationActualSeconds}), and
 * `measuredSec`, its length as measured, unrounded — the length it really is,
 * which the run records for the step after it. Throws when the clip cannot be
 * measured.
 */
export async function seedance2AutoDurationMeasure(args: { outputUrl: string }): Promise<{ outputSec: number; measuredSec: number }> {
  const measured = await probeMediaDuration(args.outputUrl)
  if (!isUsableDuration(measured)) throw new Error(`unusable output duration: ${measured}`)
  return { outputSec: Math.max(1, Math.ceil(measured - CONTAINER_OVERHANG_SEC)), measuredSec: measured }
}

/**
 * BASE credits for the 1080p FINALIZE of a Seedance 2.5 draft that was made
 * with a reference VIDEO (`seedance-2-5-hd:{N}s-ref`).
 *
 * Same rule as the generation reference lane: the provider bills
 * `unit × (input + output)` seconds, and the seeded `-ref` row only encodes the
 * per-second rate, so the per-second base comes from the 8 s `-ref` row and is
 * scaled by the full span. Unlike a generation, nothing about a finalize is
 * unknown at reservation: it re-renders the draft at the draft's own length, and
 * the draft carries the reservation's probe of its reference clips. So this is
 * the EXACT price, not a worst case.
 *
 * Seconds are whole: the provider bills a 4.04 s clip as 4 s (measured), so a
 * usable probe is rounded by `seedanceDraftFinalizeBillableSec`'s rule. An
 * unusable probe still counts as the per-clip worst case, and the summed input
 * is capped at the provider's total — {@link billedInputSeconds}, shared with
 * the generation lane.
 *
 * Throws `PriceNotConfiguredError` when the 8 s `-ref` row is missing.
 */
export function seedanceDraftFinalizeRefBaseCredits(args: SeedanceDraftFinalizeRefArgs): number {
  const identifier = `${SEEDANCE_DRAFT_FINALIZE_PROVIDER}:8s-ref`
  const composite8s = STATIC_CREDIT_COSTS[identifier]
  if (composite8s === undefined) throw new PriceNotConfiguredError(identifier)
  return Math.ceil((composite8s / 8) * seedanceDraftFinalizeRefBilledSec(args))
}

/** A reference-video draft's finalize, as {@link seedanceDraftFinalizeRefBaseCredits} prices it. */
export interface SeedanceDraftFinalizeRefArgs {
  /** The draft's delivered length, in whole billable seconds. */
  outputSec: number
  /** The draft's own reservation probe of its reference clips (`refVideoDurationsSec`). */
  refVideoDurationsSec: readonly unknown[]
}

/**
 * The seconds a reference-video draft's finalize bills — what
 * {@link seedanceDraftFinalizeRefBaseCredits} prices: each usable probe in
 * whole seconds (`seedanceDraftFinalizeBillableSec`'s rule), an unusable one
 * passed through to {@link billedInputSeconds}'s per-clip worst case, the
 * input capped at the provider's total, plus the draft's output seconds.
 * Exported so the finalize's recorded provider cost reads the very seconds its
 * charge bills.
 */
export function seedanceDraftFinalizeRefBilledSec(args: SeedanceDraftFinalizeRefArgs): number {
  const wholeSec = args.refVideoDurationsSec.map((d) =>
    typeof d === "number" && isUsableDuration(d) ? Math.max(1, Math.ceil(d - CONTAINER_OVERHANG_SEC)) : d,
  )
  // The draft's model decides the input-side bounds (per-clip cap, total cap).
  const { totalSec } = billedInputSeconds(SEEDANCE_DRAFT_MODELS[0], wholeSec)
  return totalSec + args.outputSec
}

/**
 * A Seedance draft's own run, as its job records it (`input_data`): what its
 * reservation held, and so the most its 1080p finalize bills for output.
 */
export interface SeedanceDraftRun {
  provider: string
  /** The length the run was sent at, as recorded (Auto = -1): the resolved one when a task type moved it. */
  duration: unknown
  /** The run's resolved reference task type (`input_data.referenceTaskType`); absent = none declared, as a draft
   *  recorded before drafts could declare one ran. */
  referenceTaskType: unknown
  /** The reservation's probe of its reference clips, in order (NaN = unmeasured: the worst case); empty without one. */
  refVideoDurationsSec: readonly unknown[]
}

/**
 * The OUTPUT seconds a Seedance draft's run held (decided 2026-11-12): the ONE
 * rule a finalize of that draft is quoted, reserved, estimated and charged
 * by, since a finalize never bills more output than its draft reserved.
 *
 *  - with reference video(s): the reference-video hold the run's reservation
 *    held ({@link seedance2RefVideoHeldOutputSec}, at its recorded length and
 *    task type, from its probe of the clips);
 *  - without: the length it was priced at (`pricedOutputDurationSec`: Auto =
 *    the model's longest clip).
 *
 * Seconds as held, not yet the finalize's whole billed seconds
 * (`seedanceDraftFinalizeBillableSec`).
 */
export function seedanceDraftHeldOutputSec(run: SeedanceDraftRun): number {
  const { provider, duration, referenceTaskType, refVideoDurationsSec } = run
  const requested = typeof duration === "number" || typeof duration === "string" ? duration : undefined
  const outputDurationSec = pricedOutputDurationSec(provider, requested)
  if (refVideoDurationsSec.length === 0) return outputDurationSec
  return seedance2RefVideoHeldOutputSec({ provider, outputDurationSec, requestedDuration: duration, referenceTaskType, durationsSec: refVideoDurationsSec })
}
