/**
 * Seedance 2.5 Extend's price rows — part of the public credit-id contract:
 * the rows a run is charged a multiple of, and so the ids a client names to
 * ask what a run costs (`tailExtendCreditId`, `credit-identifiers.ts`).
 *
 * A Seedance 2.5 Extend run sends the source's last
 * {@link SEEDANCE_EXTEND_CONTEXT_MAX_SEC} seconds (all of a shorter source)
 * and is charged per second sent and added. A per-second price is not a
 * whole credit, so each resolution's row is the price of
 * {@link SEEDANCE_EXTEND_RATE_SECONDS} seconds, and a run is that row × (seconds
 * sent + seconds added) ÷ 2, rounded up once.
 *
 * The seconds rule lives here too (decided 2026-11-13), so a client prices a
 * run on a known source by the same rule the server charges it by
 * (`seedanceExtendSourceCreditId`, credit-identifiers.ts): how many seconds of
 * the source are sent ({@link seedanceExtendSentSec}, a picture's length read
 * by the container-overhang rule), how many are added
 * ({@link seedanceExtendAddedSec}) and the units of a rate row they make
 * ({@link seedanceExtendUnits}). `@nodaro/render-rules`
 * (`seedance-extend-pricing.ts`) and the backend read them from here.
 */
import { MODEL_CATALOG } from "./model-catalog.js"
import { pricedOutputDurationSec, SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC, type SeedanceExtendProvider, type TailExtendProvider } from "./model-constants.js"
import { CONTAINER_OVERHANG_SEC } from "./video-duration.js"

/** The Extend Video provider priced by the seconds it sends. */
export const SEEDANCE_EXTEND_SENT_PRICED_PROVIDER = "seedance-2-5-extend" satisfies SeedanceExtendProvider

/** The Extend Video provider priced by the seconds it sends. */
export type SentPricedSeedanceExtendProvider = typeof SEEDANCE_EXTEND_SENT_PRICED_PROVIDER

/** The most of the source's end a run sends as `@video_1`, in seconds. */
export const SEEDANCE_EXTEND_CONTEXT_MAX_SEC = 10

/** The seconds one rate row prices. */
export const SEEDANCE_EXTEND_RATE_SECONDS = 2

/** The rate row of each resolution: the price of {@link SEEDANCE_EXTEND_RATE_SECONDS} seconds. */
export const SEEDANCE_EXTEND_RATE_CREDIT_IDS: Readonly<Record<"480p" | "720p" | "1080p", string>> = {
  "480p": "seedance-2-5-extend:480p:per-2s",
  "720p": "seedance-2-5-extend:720p:per-2s",
  "1080p": "seedance-2-5-extend:1080p:per-2s",
}

/** Is `provider` the Extend Video provider priced by the seconds it sends? A retired id answers false: pass it through `canonicalVideoProvider` first. */
export function isSeedanceExtendPricedBySecondsSent(provider: unknown): provider is SentPricedSeedanceExtendProvider {
  return provider === SEEDANCE_EXTEND_SENT_PRICED_PROVIDER
}

/** Is `id` one of the rate rows? */
export function isSeedanceExtendRateCreditId(id: unknown): boolean {
  return typeof id === "string" && (Object.values(SEEDANCE_EXTEND_RATE_CREDIT_IDS) as string[]).includes(id)
}

/**
 * The seconds a tail-recipe extend run (Seedance 2.5 / 2.0, Kling 4) adds for a requested `duration`: the
 * seconds its price counts (`pricedOutputDurationSec`, the provider's catalog
 * default when unset or unreadable), held in the provider's catalog window.
 * The one reading of the length: the route queues it, the worker generates
 * it, and every price and quote counts it.
 */
export function seedanceExtendAddedSec(provider: TailExtendProvider, duration: unknown): number {
  const requested = typeof duration === "number" || typeof duration === "string" ? duration : undefined
  const offered = MODEL_CATALOG[provider]?.durations ?? []
  const min = offered.length > 0 ? Math.min(...offered) : 1
  const max = offered.length > 0 ? Math.max(...offered) : Number.POSITIVE_INFINITY
  return Math.min(max, Math.max(min, Math.round(pricedOutputDurationSec(provider, requested))))
}

/** A length the source gives, when it is one: finite and above 0. */
function knownSec(sec: number | null | undefined): number | undefined {
  return typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? sec : undefined
}

/**
 * A picture's measured length as the seconds it is charged as — the
 * platform's container-overhang rule: at most `CONTAINER_OVERHANG_SEC` (a
 * quarter second) past a whole second is that whole second (8.04 s is 8 s,
 * 8.25 s is 8 s); anything else is exactly as measured (8.3 s is 8.3 s).
 * Under a second there is no whole second to read it as.
 */
export function seedanceExtendSourceSec(pictureSec: number): number {
  const whole = Math.floor(pictureSec)
  return whole >= 1 && pictureSec - whole <= CONTAINER_OVERHANG_SEC ? whole : pictureSec
}

/**
 * The seconds of the source a run is charged for sending: its last
 * {@link SEEDANCE_EXTEND_CONTEXT_MAX_SEC}, or all of a shorter source, its
 * picture's length read by the container-overhang rule
 * ({@link seedanceExtendSourceSec}). A source whose length is not known (a
 * quote before the upstream video exists, or a length that is not a positive
 * finite number) counts the whole window: the most a run sends.
 */
export function seedanceExtendSentSec(sourcePictureSec: number | null | undefined): number {
  const known = knownSec(sourcePictureSec)
  return known === undefined ? SEEDANCE_EXTEND_CONTEXT_MAX_SEC : Math.min(SEEDANCE_EXTEND_CONTEXT_MAX_SEC, seedanceExtendSourceSec(known))
}

/**
 * Whether a Seedance Extend run refuses a source of this measured picture
 * length: a known length (positive, finite) under the shortest source the
 * extend takes, `SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC`, compared as measured, as
 * the route refuses it before anything is reserved and the worker before it
 * generates. A length that is not known is never refused here (the run
 * measures the source itself).
 */
export function seedanceExtendRefusesSource(sourcePictureSec: number | null | undefined): boolean {
  const known = knownSec(sourcePictureSec)
  return known !== undefined && known < SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC
}

/** The units of a rate row a run that sends `sentSec` and adds `addedSec` is charged. */
export function seedanceExtendUnits(sentSec: number, addedSec: number): number {
  return (sentSec + addedSec) / SEEDANCE_EXTEND_RATE_SECONDS
}
