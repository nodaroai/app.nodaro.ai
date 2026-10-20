import { MODEL_CATALOG, SEEDANCE_DRAFT_FINALIZE_PROVIDER, SEEDANCE_DRAFT_MODELS } from "@nodaro/shared/model-catalog"
import { VIDEO_REF_VIDEO_DURATION_LIMITS } from "@nodaro/shared/models"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError, getModelCreditBaseCost } from "./credits.js"
// The probe lives in CORE (lib/ref-video-probe.ts) because the routes' duration
// pre-check — plain input validation, not a credit feature — must run in
// community/business too, where no ee/ module may be loaded at runtime.
// ee -> core is the allowed direction; re-exported so existing importers of
// this module are unaffected.
import { probeRefVideoDurations } from "../../lib/ref-video-probe.js"
import { probeMediaDuration } from "../../providers/video/ffmpeg-utils.js"

export { probeRefVideoDurations, refVideoCapFor } from "../../lib/ref-video-probe.js"

/**
 * A reference clip we could not measure (rejected ffprobe, NaN/≤0 duration)
 * counts as the LONGEST clip the provider accepts — the per-clip cap in
 * `VIDEO_REF_VIDEO_DURATION_LIMITS` (30s on Seedance 2.5), or the 2.0 family's
 * 15s total-input ceiling when the provider declares no bound. We must NEVER
 * under-reserve, because `commit_credits` only refunds a surplus and can never
 * collect an upward delta.
 */
const REF_VIDEO_WORST_CASE_SEC = 15

export function refVideoWorstCaseSecFor(provider: string): number {
  return VIDEO_REF_VIDEO_DURATION_LIMITS[provider]?.maxSec ?? REF_VIDEO_WORST_CASE_SEC
}

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

  // Clamp the requested resolution to the provider's catalog resolutions, snapping
  // an unsupported tier to the top (last) priced tier — mirrors credit-identifiers.ts.
  const supported = MODEL_CATALOG[provider]?.resolutions ?? ["480p", "720p", "1080p"]
  const want = resolution === "4k" ? "4k" : resolution === "1080p" ? "1080p" : resolution === "720p" ? "720p" : "480p"
  const res = supported.includes(want) ? want : (supported[supported.length - 1] ?? "480p")

  const identifier = `${provider}:8s:${res}-ref`
  const composite8s = STATIC_CREDIT_COSTS[identifier]
  if (composite8s === undefined) {
    // Hard-fail: an unconfigured composite must never silently fall back to a wrong
    // (under-)reservation — matches getModelCreditBaseCost's policy.
    throw new PriceNotConfiguredError(identifier)
  }

  const perSecBase = composite8s / 8
  return Math.ceil(perSecBase * (inputVideoDurationSec + outputDurationSec))
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
 * BASE credits a RESERVATION must hold for a reference-video run, from
 * ALREADY-PROBED durations — the worst case the run can bill, so we can only
 * ever OVER-reserve, never under-reserve (the refund-only `commit_credits`
 * constraint). Callers that hold a probe result (the routes' duration pre-check
 * stashes one on the request) price through here instead of running a second
 * uncached ffprobe per clip.
 *
 * Two worst-case rules, both here and nowhere else:
 *  - an unusable probe (NaN/<=0) counts as the provider's per-clip cap
 *    ({@link refVideoWorstCaseSecFor});
 *  - the OUTPUT is billed at the longer of the requested duration and the
 *    longest reference clip. Seedance decides from the prompt whether a run
 *    with a video wired is a style run (renders the requested duration) or an
 *    EDIT of that clip, which renders the clip's own length — and the verdict
 *    arrives only as a rejection the provider layer answers by resubmitting
 *    (`runVideoTaskWithSeedanceEditRetry`). Reserving the requested duration
 *    alone under-billed every edit of a clip longer than the node's Duration.
 *
 * The settlement ({@link seedance2RefVideoActualBaseCredits}) measures what was
 * delivered and refunds the difference, so a style run still pays its exact
 * `unit × (input + requested)` price.
 */
export function seedance2RefVideoBaseCreditsFromDurations(args: {
  provider: string
  resolution: string
  outputDurationSec: number
  durationsSec: readonly number[]
}): number {
  const { provider, resolution, outputDurationSec, durationsSec } = args
  const { perClip, totalSec } = billedInputSeconds(provider, durationsSec)
  const billableOutputSec = Math.max(outputDurationSec, ...perClip)
  return seedance2RefVideoBaseCredits({ provider, resolution, outputDurationSec: billableOutputSec, inputVideoDurationSec: totalSec })
}

/**
 * BASE credits a reference-video run is EXPECTED to bill once delivered — a
 * quote's `expected`, beside the worst case the reservation holds. Same input
 * rule as the reservation ({@link billedInputSeconds}); the output is the
 * length the run will most likely render:
 *  - Auto duration (the edit shape, `SEEDANCE_VIDEO_EDIT_SHAPE`): an edit
 *    renders its SOURCE clip's length — the first clip (`@video_1`); any
 *    extra clips are references, even a longer one (the reservation's
 *    longest-clip rule still covers it);
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
  const renderedSec = autoDuration ? perClip[0]! : outputDurationSec
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
  referenceVideoUrls: readonly unknown[]
}): Promise<number> {
  const { provider, resolution, outputDurationSec, referenceVideoUrls } = args
  const durationsSec = await probeRefVideoDurations({ provider, referenceVideoUrls })
  return seedance2RefVideoBaseCreditsFromDurations({ provider, resolution, outputDurationSec, durationsSec })
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
 * Throws when the delivered clip cannot be measured — the caller then commits
 * the reservation, which is today's behaviour and never under-bills.
 */
export async function seedance2RefVideoActualBaseCredits(args: {
  provider: string
  resolution: string
  outputUrl: string
  referenceVideoUrls: readonly unknown[]
  /** The reservation's probe of `referenceVideoUrls`, when the job carries it. */
  durationsSec?: readonly unknown[]
}): Promise<number> {
  const { provider, resolution, outputUrl, referenceVideoUrls } = args
  const [outputDurationSec, durationsSec] = await Promise.all([
    probeMediaDuration(outputUrl),
    Array.isArray(args.durationsSec) ? args.durationsSec : probeRefVideoDurations({ provider, referenceVideoUrls }),
  ])
  return seedance2RefVideoBaseCredits({
    provider,
    resolution,
    outputDurationSec,
    inputVideoDurationSec: billedInputSeconds(provider, durationsSec).totalSec,
  })
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
 */
export async function seedance2AutoDurationActualBaseCredits(args: {
  provider: string
  resolution: string | undefined
  outputUrl: string
}): Promise<number> {
  const measured = await probeMediaDuration(args.outputUrl)
  if (!isUsableDuration(measured)) throw new Error(`unusable output duration: ${measured}`)
  const seconds = Math.max(1, Math.ceil(measured - 0.25))
  const identifier = buildVideoCreditModelIdentifier(
    args.provider, seconds, undefined, undefined, undefined, args.resolution, /* hasVideoRef */ false,
  )
  return (await getModelCreditBaseCost(identifier)).creditCost
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
export function seedanceDraftFinalizeRefBaseCredits(args: {
  /** The draft's delivered length, in whole billable seconds. */
  outputSec: number
  /** The draft's own reservation probe of its reference clips (`refVideoDurationsSec`). */
  refVideoDurationsSec: readonly unknown[]
}): number {
  const identifier = `${SEEDANCE_DRAFT_FINALIZE_PROVIDER}:8s-ref`
  const composite8s = STATIC_CREDIT_COSTS[identifier]
  if (composite8s === undefined) throw new PriceNotConfiguredError(identifier)
  const wholeSec = args.refVideoDurationsSec.map((d) =>
    typeof d === "number" && isUsableDuration(d) ? Math.max(1, Math.ceil(d - 0.25)) : d,
  )
  // The draft's model decides the input-side bounds (per-clip cap, total cap).
  const { totalSec } = billedInputSeconds(SEEDANCE_DRAFT_MODELS[0], wholeSec)
  return Math.ceil((composite8s / 8) * (totalSec + args.outputSec))
}
