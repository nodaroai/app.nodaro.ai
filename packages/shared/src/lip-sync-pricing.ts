/**
 * Lip-sync per-second pricing helpers.
 *
 * KIE.ai Kling AI Avatar 2.0 (May 2026) raised the max input audio from 15s
 * to 5 minutes and bills per-second. We bucket the requested audio duration
 * into discrete tiers and use composite credit identifiers
 * (e.g. `kling-avatar:60s`) so credit reservation scales with input length.
 *
 * InfiniTalk still enforces a 15s upstream cap.
 */

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
  // HeyGen Lipsync Precision + Sync Lipsync 2 Pro — billed per output second.
  // 5-min ceiling for credit bucketing (mirrors kling-avatar). MUST be set:
  // the default fallback below is 15s, which would clamp every request to the
  // 15s bucket and silently under-charge long clips.
  "heygen-lipsync-precision": 300,
  "lipsync-2-pro": 300,
}

export function getLipSyncMaxAudioSeconds(provider: string): number {
  return LIP_SYNC_MAX_AUDIO_SECONDS[provider] ?? 15
}

/** Providers whose credit cost varies with audio duration. */
const PER_SECOND_LIP_SYNC_PROVIDERS = new Set([
  "kling-avatar",
  "kling-avatar-pro",
  "heygen-lipsync-precision",
  "lipsync-2-pro",
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
