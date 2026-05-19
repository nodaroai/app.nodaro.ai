/**
 * Provider kinds for reconciliation. Each kind maps 1:1 to one upstream
 * endpoint + one staleness threshold.
 */
export const PROVIDER_KIND_VALUES = [
  "kie-standard",
  "kie-veo",
  "kie-suno",
  "kie-kontext",
  "kie-luma",
  "kie-kling3",
  "kie-runway",
  "kie-lip-sync",
  "kie-llm",
  "replicate-prediction",
  "replicate-training",
  "elevenlabs-async",
  "elevenlabs-sync",
  "anthropic-sync",
] as const

export type ProviderKind = (typeof PROVIDER_KIND_VALUES)[number]

const MIN = 60 * 1000

/**
 * Per-kind staleness threshold (ms). A job whose `provider_call_started_at`
 * is older than this is a candidate for reconciliation. The retry cap of 18
 * attempts × 5-min cron cadence = 90-min budget covers the longest threshold
 * (`kie-lip-sync` 75 min) with 15-min headroom for legitimate long runs.
 */
export const STALE_THRESHOLD_MS: Record<ProviderKind, number> = {
  "kie-standard":         10 * MIN,
  "kie-veo":              25 * MIN,
  "kie-suno":             30 * MIN,
  "kie-kontext":          10 * MIN,
  "kie-luma":             25 * MIN,
  "kie-kling3":           25 * MIN,
  "kie-runway":           25 * MIN,
  "kie-lip-sync":         75 * MIN,
  "kie-llm":               5 * MIN,
  "replicate-prediction": 20 * MIN,
  "replicate-training":   30 * MIN,
  "elevenlabs-async":     15 * MIN,
  "elevenlabs-sync":       5 * MIN,
  "anthropic-sync":        5 * MIN,
}

/** Smallest entry in `STALE_THRESHOLD_MS`. Drives the SQL pre-filter cutoff
 *  and the fallback threshold for unknown / null `provider_kind` rows.
 *  Derived rather than hardcoded so a future threshold tightening propagates
 *  automatically. */
export const MIN_STALE_THRESHOLD_MS = Math.min(
  ...Object.values(STALE_THRESHOLD_MS),
)

const SYNC_KINDS: ReadonlySet<ProviderKind> = new Set([
  "kie-llm",
  "elevenlabs-sync",
  "anthropic-sync",
])

export function isSyncKind(kind: ProviderKind): boolean {
  return SYNC_KINDS.has(kind)
}

export function isAsyncKind(kind: ProviderKind): boolean {
  return !isSyncKind(kind)
}
