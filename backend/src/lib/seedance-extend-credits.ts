import { isSeedanceExtendPricedBySecondsSent, seedanceExtendPrice, type SeedanceExtendPrice, type SentPricedSeedanceExtendProvider } from "@nodaro/render-rules"
import { canonicalVideoProvider, refVideoAspectProblem } from "@nodaro/shared/models"
import { seedanceExtendAddedSec, seedanceExtendSentSec } from "@nodaro/shared/credits"
import {
  GEMINI_OMNI_EXTEND_PROVIDER,
  GEMINI_OMNI_EXTEND_SOURCE_CREDIT_ID,
  geminiOmniExtendAddedCreditId,
  geminiOmniExtendBaseCredits,
  geminiOmniExtendResolution,
  isGeminiOmniExtendProvider,
} from "@nodaro/render-rules"
import { displayVideoSize, extendSourceAspectProblem } from "./extend-source-shape.js"
import { falEnabled } from "../providers/fal/enabled.js"
import { MissingProviderKeyError } from "../providers/provider-keys.js"
import { extendSourceTooShortMessage, TAIL_RECIPES } from "./extend-recipe.js"
import { baseCreditCostFor, unitRateBaseCredits } from "./credit-base-cost.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"

/**
 * Seedance 2.5 Extend and Seedance 2.5 Flash Extend: the BASE (pre-markup)
 * price of one run — its provider's rate row at its resolution
 * (`<provider>:<res>:per-2s`, admin-editable in
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
  provider: SentPricedSeedanceExtendProvider
  duration: unknown
  resolution: unknown
  sourcePictureSec: number | null | undefined
}): Promise<number> {
  const price: SeedanceExtendPrice = seedanceExtendPrice(args)
  return unitRateBaseCredits(price.rateId, price.units)
}

/**
 * Gemini Omni Flash 1.2 Extend: the BASE (pre-markup) price of one run
 * (decided 2026-11-17, `@nodaro/shared` `gemini-omni-extend-rate.ts`) — the
 * seconds sent × its per-second-sent row plus the seconds added × its
 * resolution's per-second-added row, both read from model_pricing (else the
 * static table), the total rounded up to the next 10 once. The seconds sent
 * are counted as the Seedance extends count them (`seedanceExtendSentSec`:
 * the picture's length by the container-overhang rule, at most 10 s; the
 * whole window when `sourcePictureSec` is not known); the seconds added are
 * the run's (`seedanceExtendAddedSec`, in its 3–10 s window). One function
 * for the route's credit guard, a workflow run's hold and the worker's
 * settlement. 0 when credits are off.
 */
export async function geminiOmniExtendRunBaseCredits(args: {
  duration: unknown
  resolution: unknown
  sourcePictureSec: number | null | undefined
}): Promise<number> {
  const [sourcePerSec, addedPerSec] = await Promise.all([
    baseCreditCostFor(GEMINI_OMNI_EXTEND_SOURCE_CREDIT_ID),
    baseCreditCostFor(geminiOmniExtendAddedCreditId(args.resolution)),
  ])
  return geminiOmniExtendBaseCredits({
    sourcePerSec,
    addedPerSec,
    sentSec: seedanceExtendSentSec(args.sourcePictureSec),
    addedSec: seedanceExtendAddedSec(GEMINI_OMNI_EXTEND_PROVIDER, args.duration),
  })
}

/** An Extend Video provider charged by the seconds of the source it sends: Seedance 2.5 / 2.5 Flash Extend, Gemini Omni Flash 1.2 Extend. */
export type SentChargedExtendProvider = SentPricedSeedanceExtendProvider | typeof GEMINI_OMNI_EXTEND_PROVIDER

/** Is `provider` (a current id) charged by the seconds of the source it sends? */
export function isExtendChargedBySecondsSent(provider: unknown): provider is SentChargedExtendProvider {
  return isSeedanceExtendPricedBySecondsSent(provider) || isGeminiOmniExtendProvider(provider)
}

/**
 * The BASE credits of one run of a provider charged by the seconds it sends,
 * on the source length given (the whole window when not known): the one
 * reading the route's guard, a workflow run's hold and the worker's
 * settlement share.
 */
export async function sentChargedExtendBaseCredits(args: {
  provider: SentChargedExtendProvider
  duration: unknown
  resolution: unknown
  sourcePictureSec: number | null | undefined
}): Promise<number> {
  if (isGeminiOmniExtendProvider(args.provider)) {
    return geminiOmniExtendRunBaseCredits({ duration: args.duration, resolution: args.resolution, sourcePictureSec: args.sourcePictureSec })
  }
  return seedanceExtendBaseCredits({ ...args, provider: args.provider })
}

/** The payload key the route and a workflow run put the source's measured picture length on (the length the hold is priced on). */
export const SEEDANCE_EXTEND_SOURCE_SEC_KEY = "sourcePictureSec"

/**
 * The Extend Video provider charged by the seconds it sends (Seedance 2.5 /
 * 2.5 Flash Extend, Gemini Omni Flash 1.2 Extend) a queued job runs, or
 * undefined for any other job. A retired id counts as the provider it runs as.
 */
export function seedanceExtendSentPricedProviderOf(jobName: string, payload: Record<string, unknown>): SentChargedExtendProvider | undefined {
  if (jobName !== "extend-video" || typeof payload.provider !== "string") return undefined
  const provider = canonicalVideoProvider(payload.provider)
  return isExtendChargedBySecondsSent(provider) ? provider : undefined
}

/** Is this queued job an extend charged by the seconds it sends (Seedance 2.5 / 2.5 Flash, Gemini Omni Flash 1.2)? A retired id counts as the provider it runs as. */
export function isSeedanceExtendSentPricedJob(jobName: string, payload: Record<string, unknown>): boolean {
  return seedanceExtendSentPricedProviderOf(jobName, payload) !== undefined
}

/** A stamped length, when it is one: finite and above 0. */
function stampedSec(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

/** What {@link stampSeedanceExtendSource} answers: the payload patch, or why the source is refused. */
export type SeedanceExtendSourceStamp =
  /** `modelIdentifier`: the id the job is now held at, when the stamp moved it (Gemini Omni Flash 1.2's capped tier). */
  | { readonly ok: true; readonly patch: Record<string, unknown>; readonly modelIdentifier?: string }
  | { readonly ok: false; readonly code: "video_aspect_unsupported" | "video_too_short" | "provider_unavailable"; readonly message: string }

/**
 * The providers whose workflow run refuses a source shorter than their
 * shortest one (`seedanceExtendSourceRefused`, the shared minimum table)
 * before anything is held, as the route does (decided 2026-11-16 for Seedance
 * 2.5 Flash Extend). Seedance 2.5 Extend is not here: its workflow run leaves
 * a source under 1.8 s to the worker, which refuses it before it generates
 * and refunds the hold, as it always has.
 */
const WORKFLOW_REFUSES_SHORT_SOURCE: ReadonlySet<SentChargedExtendProvider> = new Set(["seedance-2-5-flash-extend", "gemini-omni-flash-1-2-extend"])

/**
 * A workflow run's measurement of a sent-priced extend's source, before it is
 * held: the length of the source's picture (the video stream's own, else the
 * container's — the route's and the worker's reading), stamped on the payload
 * as {@link SEEDANCE_EXTEND_SOURCE_SEC_KEY}. Best effort, like the route's
 * probe: a source that cannot be measured from here (or is no safe http(s)
 * link) stamps nothing, so the run holds the whole 10-second window and the
 * worker settles it on the source it measures. A measured source whose shape
 * the provider's model does not take as a reference video
 * (`refVideoAspectProblem`; Seedance 2.5 Flash: 1:2.5 to 2.5:1) is refused, as
 * the route refuses it, before anything is held, and so is a Seedance 2.5
 * Flash source under its 2 s ({@link WORKFLOW_REFUSES_SHORT_SOURCE}). Gemini
 * Omni Flash 1.2 Extend alike: a source that is not 16:9 or 9:16
 * (`extendSourceAspectProblem`) or under its 4 s is refused before anything
 * is held. Every other job: no patch.
 */
export async function stampSeedanceExtendSource(
  jobName: string,
  payload: Record<string, unknown>,
  onProbeError?: (err: unknown) => void,
): Promise<SeedanceExtendSourceStamp> {
  const provider = seedanceExtendSentPricedProviderOf(jobName, payload)
  if (provider === undefined) return { ok: true, patch: {} }
  // Gemini Omni Flash 1.2 runs on fal: an install with no fal key is refused
  // before anything is probed or held, as the route refuses it.
  if (isGeminiOmniExtendProvider(provider) && !falEnabled()) {
    return { ok: false, code: "provider_unavailable", message: new MissingProviderKeyError("FAL_KEY", undefined, { coveredByConnection: false }).message }
  }
  const url = payload.video
  if (typeof url !== "string" || !safeUrlSchema.safeParse(url).success) return { ok: true, patch: { [SEEDANCE_EXTEND_SOURCE_SEC_KEY]: undefined } }
  try {
    const probe = await probeVideoSource(url)
    // Gemini Omni Flash 1.2 judges the DISPLAY size (its sample aspect applied).
    const display = displayVideoSize(probe)
    const shape = refVideoAspectProblem(TAIL_RECIPES[provider].genModel, probe.width, probe.height)
      ?? extendSourceAspectProblem(provider, display.width, display.height)
    if (shape) return { ok: false, code: "video_aspect_unsupported", message: shape }
    const pictureSec = stampedSec(probe.videoDurationSeconds ?? probe.durationSeconds)
    if (pictureSec !== undefined && WORKFLOW_REFUSES_SHORT_SOURCE.has(provider) && pictureSec < TAIL_RECIPES[provider].minSourceSec) {
      return { ok: false, code: "video_too_short", message: extendSourceTooShortMessage(provider, pictureSec) }
    }
    // Gemini Omni Flash 1.2: a tier above the source's runs, and is held, at
    // the source's (decided 2026-11-17) — the job's resolution AND the id it
    // is held at move together, as the route moves them.
    if (isGeminiOmniExtendProvider(provider)) {
      const tier = geminiOmniExtendResolution(payload.resolution, display)
      // Only a tier the source's size lowered moves anything: a job with no
      // resolution, or one the engine does not render, is already held at 720p.
      if (tier !== geminiOmniExtendResolution(payload.resolution)) {
        return { ok: true, patch: { [SEEDANCE_EXTEND_SOURCE_SEC_KEY]: pictureSec, resolution: tier }, modelIdentifier: geminiOmniExtendAddedCreditId(tier) }
      }
    }
    return { ok: true, patch: { [SEEDANCE_EXTEND_SOURCE_SEC_KEY]: pictureSec } }
  } catch (err) {
    onProbeError?.(err)
    return { ok: true, patch: { [SEEDANCE_EXTEND_SOURCE_SEC_KEY]: undefined } }
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
  const provider = seedanceExtendSentPricedProviderOf(jobName, payload)
  if (provider === undefined) return undefined
  return sentChargedExtendBaseCredits({
    provider,
    duration: payload.duration,
    resolution: payload.resolution,
    sourcePictureSec: stampedSec(payload[SEEDANCE_EXTEND_SOURCE_SEC_KEY]),
  })
}
