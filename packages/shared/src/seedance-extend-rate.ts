/**
 * The price rows of the Extend Video providers priced by the seconds they
 * send (Seedance 2.5 Extend, Seedance 2.5 Flash Extend) — part of the public
 * credit-id contract:
 * the rows a run is charged a multiple of, and so the ids a client names to
 * ask what a run costs (`tailExtendCreditId`, `credit-identifiers.ts`).
 *
 * Such a run sends the source's last
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
import {
  pricedOutputDurationSec,
  SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  type SeedanceExtendProvider,
  type TailExtendProvider,
} from "./model-constants.js"
import { CONTAINER_OVERHANG_SEC } from "./video-duration.js"

/**
 * The Extend Video providers priced by the seconds they send, each on its own
 * rows (decided 2026-11-16: Seedance 2.5 Flash Extend beside Seedance 2.5
 * Extend). The window ({@link SEEDANCE_EXTEND_CONTEXT_MAX_SEC}), the two
 * seconds a row prices and the seconds rule are the same for all of them; the
 * rows are each provider's own, one per resolution its catalog entry offers.
 */
export const SEEDANCE_EXTEND_SENT_PRICED_PROVIDERS = [
  "seedance-2-5-extend",
  "seedance-2-5-flash-extend",
] as const satisfies readonly SeedanceExtendProvider[]

/** An Extend Video provider priced by the seconds it sends. */
export type SentPricedSeedanceExtendProvider = typeof SEEDANCE_EXTEND_SENT_PRICED_PROVIDERS[number]

/**
 * The first provider priced by the seconds it sends, Seedance 2.5 Extend: what
 * the helpers below price when a caller names no provider (their signatures
 * before Seedance 2.5 Flash Extend joined).
 */
export const SEEDANCE_EXTEND_SENT_PRICED_PROVIDER = "seedance-2-5-extend" satisfies SentPricedSeedanceExtendProvider

/** The most of the source's end a run sends as `@video_1`, in seconds. */
export const SEEDANCE_EXTEND_CONTEXT_MAX_SEC = 10

/** The seconds one rate row prices. */
export const SEEDANCE_EXTEND_RATE_SECONDS = 2

/** A provider's rate row at `resolution`: `<provider>:<resolution>:per-2s`. */
function rateRowId(provider: SentPricedSeedanceExtendProvider, resolution: string): string {
  return `${provider}:${resolution}:per-${SEEDANCE_EXTEND_RATE_SECONDS}s`
}

/**
 * Each sent-priced provider's rate rows, by resolution: one per resolution its
 * catalog entry offers (Seedance 2.5 Extend 480p / 720p / 1080p / 4K; Seedance 2.5
 * Flash Extend 480p / 720p), each the price of
 * {@link SEEDANCE_EXTEND_RATE_SECONDS} seconds. Read from the catalog, so a
 * provider's rows and the resolutions it renders cannot differ.
 */
export const SEEDANCE_EXTEND_RATE_CREDIT_IDS_BY_PROVIDER: Readonly<Record<SentPricedSeedanceExtendProvider, Readonly<Record<string, string>>>> =
  Object.fromEntries(
    SEEDANCE_EXTEND_SENT_PRICED_PROVIDERS.map((provider) => [
      provider,
      Object.fromEntries((MODEL_CATALOG[provider]?.resolutions ?? []).map((resolution) => [resolution, rateRowId(provider, resolution)])),
    ]),
  ) as Record<SentPricedSeedanceExtendProvider, Record<string, string>>

/** Seedance 2.5 Extend's rate row of each resolution: the price of {@link SEEDANCE_EXTEND_RATE_SECONDS} seconds. */
export const SEEDANCE_EXTEND_RATE_CREDIT_IDS: Readonly<Record<"480p" | "720p" | "1080p" | "4k", string>> = {
  "480p": "seedance-2-5-extend:480p:per-2s",
  "720p": "seedance-2-5-extend:720p:per-2s",
  "1080p": "seedance-2-5-extend:1080p:per-2s",
  "4k": "seedance-2-5-extend:4k:per-2s",
}

/** Is `provider` an Extend Video provider priced by the seconds it sends? A retired id answers false: pass it through `canonicalVideoProvider` first. */
export function isSeedanceExtendPricedBySecondsSent(provider: unknown): provider is SentPricedSeedanceExtendProvider {
  return typeof provider === "string" && (SEEDANCE_EXTEND_SENT_PRICED_PROVIDERS as readonly string[]).includes(provider)
}

/** Is `id` one of the rate rows (of any sent-priced provider)? */
export function isSeedanceExtendRateCreditId(id: unknown): boolean {
  return typeof id === "string" && Object.values(SEEDANCE_EXTEND_RATE_CREDIT_IDS_BY_PROVIDER).some((rows) => Object.values(rows).includes(id))
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

/**
 * The shortest source (its picture) each sent-priced provider continues, in
 * seconds: the shortest reference video its model takes. Seedance 2.5 Extend:
 * 1.8 s, measured on the 2.0 family (`SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC`; a
 * nominal 2 s clip that probes a frame short still runs). Seedance 2.5 Flash
 * Extend: Flash's documented 2 s (`VIDEO_REF_VIDEO_DURATION_LIMITS`, decided
 * 2026-11-16). The route and a quote refuse a shorter source, and the worker
 * again before it generates.
 */
export const SEEDANCE_EXTEND_MIN_SOURCE_SEC: Readonly<Record<SentPricedSeedanceExtendProvider, number>> = {
  "seedance-2-5-extend": SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC,
  "seedance-2-5-flash-extend": VIDEO_REF_VIDEO_DURATION_LIMITS["seedance-2-5-flash"]!.minSec,
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
 * Whether a sent-priced extend on `provider` refuses a source of this measured
 * picture length: a known length (positive, finite) under the shortest source
 * the provider takes ({@link SEEDANCE_EXTEND_MIN_SOURCE_SEC}: 1.8 s, 2 s on
 * Seedance 2.5 Flash Extend), compared as measured, as the route refuses it
 * before anything is reserved and the worker before it generates. A length
 * that is not known is never refused here (the run measures the source itself).
 */
export function seedanceExtendSourceRefused(provider: SentPricedSeedanceExtendProvider, sourcePictureSec: number | null | undefined): boolean {
  const known = knownSec(sourcePictureSec)
  return known !== undefined && known < SEEDANCE_EXTEND_MIN_SOURCE_SEC[provider]
}

/** Seedance 2.5 Extend's {@link seedanceExtendSourceRefused} (its 1.8 s floor). */
export function seedanceExtendRefusesSource(sourcePictureSec: number | null | undefined): boolean {
  return seedanceExtendSourceRefused(SEEDANCE_EXTEND_SENT_PRICED_PROVIDER, sourcePictureSec)
}

/** The units of a rate row a run that sends `sentSec` and adds `addedSec` is charged. */
export function seedanceExtendUnits(sentSec: number, addedSec: number): number {
  return (sentSec + addedSec) / SEEDANCE_EXTEND_RATE_SECONDS
}
