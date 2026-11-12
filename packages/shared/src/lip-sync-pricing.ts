/**
 * Lip-sync per-second pricing helpers.
 *
 * KIE.ai Kling AI Avatar 2.0 (May 2026) raised the max input audio from 15s
 * to 5 minutes and bills per-second. We bucket the requested audio duration
 * into discrete tiers and use composite credit identifiers
 * (e.g. `kling-avatar:60s`) so credit reservation scales with input length.
 *
 * InfiniTalk still enforces a 15s upstream cap.
 *
 * A model listed in {@link LIP_SYNC_AUDIO_RATES} is priced differently: at a
 * per-second RATE times the seconds of its audio, never by bucket.
 */

import { unitQuoteCreditId } from "./credit-estimators/unit-quote.js"

/**
 * A lip-sync model charged at a per-second rate: the rate's one-second price
 * row times the seconds of the audio that drives it, rounded up once and marked
 * up once by the pricing chain that charges every per-unit rate.
 */
export interface LipSyncAudioRate {
  /** The one-second price row (`model_pricing`, else `STATIC_CREDIT_COSTS`). */
  readonly rateId: string
  /** The fewest seconds a run is charged. Shorter audio is padded with silence to this length before the model sees it. */
  readonly minSeconds: number
  /** The longest audio the model takes. Longer audio is refused before anything is held. */
  readonly maxSeconds: number
}

/** OmniHuman 2.0's one-second price row. */
export const OMNIHUMAN_2_0_PER_SECOND_CREDIT_ID = "omnihuman-2-0:per-second"

/**
 * The lip-sync models charged per second of audio at a rate (decided
 * 2026-11-11 for OmniHuman 2.0). Every price of such a run, its quote and its
 * hold are the rate × {@link lipSyncBilledSeconds}.
 */
export const LIP_SYNC_AUDIO_RATES: Readonly<Record<string, LipSyncAudioRate>> = {
  // OmniHuman 2.0 (KIE): audio from 4 to 300 seconds; the output is as long as the audio.
  "omnihuman-2-0": { rateId: OMNIHUMAN_2_0_PER_SECOND_CREDIT_ID, minSeconds: 4, maxSeconds: 300 },
}

/** The per-second rate a lip-sync model is charged at, or undefined for every model priced another way. */
export function lipSyncAudioRateOf(provider: unknown): LipSyncAudioRate | undefined {
  return typeof provider === "string" && Object.prototype.hasOwnProperty.call(LIP_SYNC_AUDIO_RATES, provider)
    ? LIP_SYNC_AUDIO_RATES[provider]
    : undefined
}

/**
 * The seconds a run of a per-second-rate model is charged for audio measured at
 * `measuredSec`: rounded up to a whole second, and at least the rate's minimum.
 * THE one place this rounding happens — the route, the workflow run, the
 * estimates and the provider's own cost all read it. Pass the length of the
 * audio as it was given, never of a copy padded to the minimum (a padded clip
 * runs a hair past it and would round up a whole second more).
 */
export function lipSyncBilledSeconds(rate: LipSyncAudioRate, measuredSec: number): number {
  if (!Number.isFinite(measuredSec) || measuredSec <= 0) return rate.minSeconds
  return Math.max(rate.minSeconds, Math.ceil(measuredSec))
}

/**
 * The length the editor quotes a lip-sync run on while its audio's length is
 * not known yet — the 15 seconds every model priced by its audio shows then
 * (a bucketed model's `:15s` row), marked as an estimate.
 */
export const LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS = 15

/**
 * The seconds an ESTIMATE prices a per-second-rate run at: the billed seconds
 * of the audio when its length is known (at most the model's maximum, the most
 * a run can be charged), else `unknownSec` — by default the maximum, so a
 * server estimate never quotes below what the run may hold; the editor passes
 * {@link LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS} and shows the figure as an estimate.
 */
export function lipSyncEstimateSeconds(rate: LipSyncAudioRate, knownSec: number | undefined, unknownSec: number = rate.maxSeconds): number {
  if (knownSec === undefined || !Number.isFinite(knownSec) || knownSec <= 0) return lipSyncBilledSeconds(rate, unknownSec)
  return lipSyncBilledSeconds(rate, Math.min(knownSec, rate.maxSeconds))
}

export const LIP_SYNC_DURATION_BUCKETS = [15, 30, 60, 120, 300] as const

export type LipSyncDurationBucket = typeof LIP_SYNC_DURATION_BUCKETS[number]

/** Round a measured audio duration up to the next supported bucket. */
export function pickLipSyncBucket(seconds: number): LipSyncDurationBucket {
  if (!Number.isFinite(seconds) || seconds <= 0) return LIP_SYNC_DURATION_BUCKETS[0]
  for (const b of LIP_SYNC_DURATION_BUCKETS) {
    if (seconds <= b) return b
  }
  return 300
}

/**
 * Upper audio-duration limit per lip-sync provider, in seconds.
 * Anything longer must be trimmed (server-side) before sending upstream.
 */
export const LIP_SYNC_MAX_AUDIO_SECONDS: Record<string, number> = {
  "kling-avatar": 300,
  "kling-avatar-pro": 300,
  "infinitalk": 15,
  // OmniHuman 1.5 — KIE hard limit is < 60s; audio is auto-trimmed to this cap.
  "omnihuman-1-5": 60,
  // HeyGen Lipsync Precision + Sync Lipsync 2 Pro — billed per output second.
  // 5-min ceiling for credit bucketing (mirrors kling-avatar). MUST be set:
  // the default fallback below is 15s, which would clamp every request to the
  // 15s bucket and silently under-charge long clips.
  "heygen-lipsync-precision": 300,
  "lipsync-2-pro": 300,
  // Sync Lipsync v3 (fal.ai) — per-second dubbing, 5-min ceiling for bucketing.
  "sync-lipsync-v3": 300,
  // Volcengine (KIE) — video-to-video dubbing, per-second, 5-min ceiling.
  "volcengine-lipsync": 300,
  // The per-second-rate models: their own maximum (longer audio is refused, never trimmed).
  ...Object.fromEntries(Object.entries(LIP_SYNC_AUDIO_RATES).map(([provider, rate]) => [provider, rate.maxSeconds])),
}

export function getLipSyncMaxAudioSeconds(provider: string): number {
  return LIP_SYNC_MAX_AUDIO_SECONDS[provider] ?? 15
}

/**
 * The id whose price is a 15-second run of a lip-sync model priced by the
 * length of its audio — the bucket row of a bucketed model (`<provider>:15s`),
 * the 15-second quote of a per-second-rate model — or undefined for a model
 * with one price. A model menu shows a per-second rate from it.
 */
export function lipSyncFifteenSecondCreditId(provider: string): string | undefined {
  const rate = lipSyncAudioRateOf(provider)
  if (rate) return unitQuoteCreditId(rate.rateId, LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS)
  return isPerSecondLipSyncProvider(provider) ? `${provider}:${LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS}s` : undefined
}

/**
 * Providers whose credit cost varies with audio duration, priced by BUCKET
 * (`<provider>:<bucket>s`). A model charged at a per-second rate
 * ({@link LIP_SYNC_AUDIO_RATES}) is never listed here: every caller that
 * branches on this set would bucket it.
 */
const PER_SECOND_LIP_SYNC_PROVIDERS = new Set([
  "kling-avatar",
  "kling-avatar-pro",
  // OmniHuman 1.5 — /sec, bucketed by audio length (60s cap).
  "omnihuman-1-5",
  "heygen-lipsync-precision",
  "lipsync-2-pro",
  // Sync Lipsync v3 (fal.ai) — billed per output second (/min).
  "sync-lipsync-v3",
  // Volcengine (KIE) — video-to-video dubbing, billed per output second.
  "volcengine-lipsync",
])

export function isPerSecondLipSyncProvider(provider: string): boolean {
  return PER_SECOND_LIP_SYNC_PROVIDERS.has(provider)
}

/**
 * Build the credit identifier for a lip-sync request.
 *
 * For kling-avatar / kling-avatar-pro, returns `<provider>:<bucket>s`.
 * For other providers, returns the bare provider name (caller appends
 * any extra dimensions like resolution).
 *
 * If `audioDurationSec` is missing, defaults to the provider's max cap so
 * credit reservation covers the worst case and any overage is refunded
 * after the worker reconciles the actual KIE cost.
 */
export function buildLipSyncCreditId(
  provider: string,
  audioDurationSec: number | undefined,
): string {
  if (!isPerSecondLipSyncProvider(provider)) return provider
  const cap = getLipSyncMaxAudioSeconds(provider)
  const requested = audioDurationSec === undefined || audioDurationSec <= 0
    ? cap
    : Math.min(audioDurationSec, cap)
  return `${provider}:${pickLipSyncBucket(requested)}s`
}
