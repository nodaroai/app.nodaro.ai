/**
 * Provider kinds for reconciliation. Each kind maps 1:1 to one upstream
 * endpoint + one staleness threshold.
 */
export const PROVIDER_KIND_VALUES = [
  "kie-standard",
  "kie-veo",
  "kie-veo-1080p",
  "kie-suno",
  "kie-suno-voice-create",
  "kie-suno-voice-validate",
  "kie-kontext",
  "kie-luma",
  "kie-kling3",
  "kie-runway",
  "kie-aleph",
  "kie-lip-sync",
  "kie-llm",
  "replicate-prediction",
  "replicate-training",
  "elevenlabs-async",
  "elevenlabs-sync",
  "anthropic-sync",
  "heygen",
  "pre-task",
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
  "kie-standard":             10 * MIN,
  "kie-veo":                  25 * MIN,
  // VEO 1080p upscale: quasi-sync `/api/v1/veo/get-1080p-video` polling (~1-3 min).
  // Reconcile re-calls the endpoint with the parent kieTaskId. 10 min threshold
  // gives the worker headroom before the cron jumps in.
  "kie-veo-1080p":            10 * MIN,
  "kie-suno":                 30 * MIN,
  // Suno voice persona: user-driven multi-step modal. Credits reserved on
  // POST /voice/generate; commit happens when the frontend's poll of
  // GET /voice/record-info sees terminal status. If the user abandons the
  // modal, sync-sweep refunds at 2h. Validate has no credits — 24h cleanup.
  // Migrated from the standalone `sweepStaleVoiceJobs` cron (P5.2).
  "kie-suno-voice-create":   120 * MIN,
  "kie-suno-voice-validate": 24 * 60 * MIN,
  "kie-kontext":              10 * MIN,
  "kie-luma":                 25 * MIN,
  "kie-kling3":               25 * MIN,
  "kie-runway":               25 * MIN,
  // Runway Aleph (v2v): own endpoint `/api/v1/aleph/record-info`. Same poll
  // budget as Runway since it's the same provider family.
  "kie-aleph":                25 * MIN,
  "kie-lip-sync":             75 * MIN,
  "kie-llm":                   5 * MIN,
  "replicate-prediction":     20 * MIN,
  "replicate-training":       30 * MIN,
  "elevenlabs-async":         15 * MIN,
  "elevenlabs-sync":           5 * MIN,
  "anthropic-sync":            5 * MIN,
  // HeyGen avatar/cinematic: generateAvatarVideo persists the video_id via
  // onTaskCreated so a BullMQ stall-retry does NOT re-submit (double-bill the
  // provider). No recover handler yet, so it's swept like pre-task (fail+refund)
  // — HeyGen's own MAX_POLL_DURATION bounds a run well under 30 min, so this
  // never fails a still-rendering job (same effective threshold pre-task gave it).
  "heygen":                   30 * MIN,
  // Sentinel kind written when the worker transitions to `processing` BEFORE
  // any upstream provider call. If the handler crashes before firing
  // `onTaskCreated` (or `markProviderCallStart` for sync ops), the row would
  // otherwise be invisible to the cron filter forever. 30 min gives slow
  // input preprocessing (R2 download, JPEG re-encode for Hailuo, etc.) plenty
  // of headroom before the sync-sweep marks the row failed + refunds.
  "pre-task":                 30 * MIN,
}

/** Smallest entry in `STALE_THRESHOLD_MS`. Drives the SQL pre-filter cutoff
 *  in `cron.ts` and the fallback threshold for unknown / null `provider_kind`
 *  rows. Derived rather than hardcoded so a future threshold tightening
 *  propagates automatically. */
export const MIN_STALE_THRESHOLD_MS = Math.min(
  ...Object.values(STALE_THRESHOLD_MS),
)

/** Per-job reconcile attempt cap. After this many failed poll attempts the
 *  shared `bumpAttemptsOrExhaust` helper force-fails the job + refunds + logs
 *  a `reconcile_exhausted` anomaly. 18 × 5-min cron cadence = 90-min budget;
 *  15-min headroom above the longest legitimate threshold (`kie-lip-sync`
 *  75min). Spec ref: §5.5 + §7 edge case "reconcile_attempts ≥ 18". */
export const MAX_ATTEMPTS = 18

const SYNC_KINDS: ReadonlySet<ProviderKind> = new Set([
  "kie-llm",
  "kie-suno-voice-create",
  "kie-suno-voice-validate",
  "elevenlabs-sync",
  "anthropic-sync",
  // `pre-task` is sync-style: no upstream task to recover, so the sweep
  // marks failed + refunds the reservation. Same behavior path as a sync
  // route handler that crashed mid-call.
  "pre-task",
  // `heygen` persists a video_id (so stall-retry skips the re-call), but there's
  // no recover handler — treat a stalled HeyGen job like pre-task: fail + refund.
  "heygen",
])

export function isSyncKind(kind: ProviderKind): boolean {
  return SYNC_KINDS.has(kind)
}

export function isAsyncKind(kind: ProviderKind): boolean {
  return !isSyncKind(kind)
}
