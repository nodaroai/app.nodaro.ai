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
  // Beeble SwitchX (direct vendor v2v): persists the Beeble job id via
  // onTaskCreated; no recover handler (webhook deferred) → swept fail+refund
  // like heygen. idempotency_key=jobId dedupes any BullMQ re-submit on Beeble.
  "beeble",
  // fal.ai queue jobs (sync-lipsync-v3 etc.). The fal branch persists the
  // request_id via onTaskCreated; reconcileFalJob (Phase C) re-fetches the queue
  // result and finalizes (or exhausts→refund). Classified async — see
  // FAL_RECOVER_KINDS + the cron/inline dispatch branches.
  "fal-request",
  // 4b: an exclusive-node job relayed to the connected cloud
  // (workers/handlers/nodaro-exclusive-relay.ts persists the CLOUD job id
  // here). reconcileNodaroCloudJob re-polls that cloud job — idempotent, it
  // never creates a second one.
  "nodaro-cloud",
  // Workflow Copilot turn (ee/copilot): a metered LLM agent loop whose spend
  // is persisted per iteration. NOT a sync kind — the sweep's fail+refund
  // would refund tokens already burned; `reconcileCopilotTurn` commits the
  // persisted cost instead and refunds only when nothing was spent.
  "copilot-turn",
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
  // 20 min, NOT 10: gpt-image-2 at 4K legitimately runs 9-13 min of provider
  // time (plus download/upload), and several i2v models on this kind run
  // similarly long. At 10 min the cron routinely raced LIVE workers into a
  // double-finalize of the same job (incident 2026-06-10). The threshold must
  // exceed the longest legitimate runtime of the kind; dead-job recovery
  // moving 10 → 20 min is an acceptable trade.
  "kie-standard":             20 * MIN,
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
  // A copilot turn legitimately runs up to its 8-min wall clock (+ a 9-min
  // hard timer); a sweep at 5 min would hit live turns.
  "copilot-turn":             15 * MIN,
  // HeyGen avatar/cinematic: generateAvatarVideo persists the video_id via
  // onTaskCreated so a BullMQ stall-retry does NOT re-submit (double-bill the
  // provider). No recover handler yet, so it's swept like pre-task (fail+refund)
  // — HeyGen's own MAX_POLL_DURATION bounds a run well under 30 min, so this
  // never fails a still-rendering job (same effective threshold pre-task gave it).
  "heygen":                   30 * MIN,
  // Beeble SwitchX: same posture as heygen (persisted id, no recover handler).
  // 30 min comfortably exceeds a 240-frame relight render.
  "beeble":                   30 * MIN,
  // fal.ai queue jobs (sync-lipsync-v3): per-second media jobs that can run
  // several minutes. 5-min threshold (= the existing global min) keeps
  // MIN_STALE_THRESHOLD_MS unchanged while giving a live worker headroom before
  // reconcileFalJob (the async recover handler) re-fetches a stalled row.
  "fal-request":               5 * MIN,
  // Sentinel kind written when the worker transitions to `processing` BEFORE
  // any upstream provider call. If the handler crashes before firing
  // `onTaskCreated` (or `markProviderCallStart` for sync ops), the row would
  // otherwise be invisible to the cron filter forever. 30 min gives slow
  // input preprocessing (R2 download, JPEG re-encode for Hailuo, etc.) plenty
  // of headroom before the sync-sweep marks the row failed + refunds.
  "pre-task":                 30 * MIN,
  // 4b exclusive-node relay. gvp/evp-class cloud runs legitimately take an
  // hour+, and the relay's own live poll budget is ~85 min — reconcile only
  // matters when the WORKER died. 75 min is the documented envelope max
  // (18 attempts × 5-min cadence covers it with headroom); the recover poll
  // is a one-shot idempotent re-read of the cloud job, never a re-create,
  // so an early takeover costs one HTTP GET, not a double generation.
  "nodaro-cloud":             75 * MIN,
}

/** Smallest entry in `STALE_THRESHOLD_MS`. Drives the SQL pre-filter cutoff
 *  in `cron.ts` and the fallback threshold for unknown / null `provider_kind`
 *  rows. Derived rather than hardcoded so a future threshold tightening
 *  propagates automatically. */
export const MIN_STALE_THRESHOLD_MS = Math.min(
  ...Object.values(STALE_THRESHOLD_MS),
)

/**
 * TTL for the finalize claim (`jobs.finalize_claimed_at`, migration 210).
 *
 * `finalizeJobWithMedia` CAS-claims a job via the `claim_job_finalize` RPC
 * before doing any media work, so the worker and the reconcile cron never
 * download + upload the same job concurrently. The cron additionally skips
 * stale candidates whose claim is younger than this TTL ("a finalizer is
 * mid-flight"). A crashed claimant self-heals: once the claim is older than
 * the TTL it can be re-claimed by the next finalizer.
 *
 * Sized to comfortably exceed the longest legitimate finalize (download up to
 * 500 MB video + watermark + upload). If a legitimate finalize ever outlives
 * the TTL, the duplicate is benign: uploads to the deterministic key are
 * idempotent overwrites (the failure-path delete was removed from uploadToR2)
 * and `markJobCompleted` is CAS-guarded.
 */
export const FINALIZE_CLAIM_TTL_MS = 10 * MIN

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
  // Beeble SwitchX: same — persisted job id, no recover handler → fail + refund.
  "beeble",
])

export function isSyncKind(kind: ProviderKind): boolean {
  return SYNC_KINDS.has(kind)
}

/** Kinds recovered by `ee/copilot/reconcile.ts` (cloud-only; loaded dynamically by the cron). */
export const COPILOT_KINDS: ReadonlySet<ProviderKind> = new Set(["copilot-turn"])

export function isAsyncKind(kind: ProviderKind): boolean {
  return !isSyncKind(kind)
}

// ---------------------------------------------------------------------------
// Recoverable-kind dispatch sets — SINGLE SOURCE OF TRUTH (audit M5).
//
// Consumed by: the cron dispatcher (cron.ts), the worker's stall-retry inline
// dispatcher (workers/inline-reconcile.ts), and the worker's post-provider
// leave-for-reconcile branch (video-worker.ts). These used to be duplicated
// per consumer; a kind added to one copy but not another silently changed
// behavior (cron-recoverable but inline-skipped, etc.). The parity test in
// types.test.ts pins ASYNC_RECOVERABLE_KINDS ≡ {k : isAsyncKind(k)} so the
// dispatch sets and the sync/async classification can never drift apart.
// ---------------------------------------------------------------------------

/** Kinds recovered via the KIE poll dispatchers (reconcileKieJob). */
export const KIE_RECOVER_KINDS: ReadonlySet<string> = new Set([
  "kie-standard", "kie-veo", "kie-veo-1080p", "kie-suno", "kie-kontext",
  "kie-luma", "kie-kling3", "kie-runway", "kie-aleph", "kie-lip-sync",
])

/** Kinds recovered via reconcileReplicateJob. */
export const REPLICATE_RECOVER_KINDS: ReadonlySet<string> = new Set([
  "replicate-prediction", "replicate-training",
])

/** Kinds recovered via reconcileElevenLabsJob. */
export const ELEVENLABS_RECOVER_KINDS: ReadonlySet<string> = new Set([
  "elevenlabs-async",
])

/** Kinds recovered via reconcileFalJob (fal.ai queue jobs — sync-lipsync-v3 etc.).
 *  The fal request_id is persisted via onTaskCreated; reconcileFalJob re-fetches
 *  the queue result from it (endpoint resolved off the job's input_data.provider)
 *  and finalizes, or exhausts→refund after MAX_ATTEMPTS. */
export const FAL_RECOVER_KINDS: ReadonlySet<string> = new Set([
  "fal-request",
])

/** Kinds recovered via reconcileNodaroCloudJob (4b exclusive-node relay —
 *  the persisted id is the CLOUD job's id; recovery is one idempotent poll). */
export const NODARO_CLOUD_RECOVER_KINDS: ReadonlySet<string> = new Set([
  "nodaro-cloud",
])

/** Every kind with an async recover handler — the provider result can be
 *  re-fetched from the persisted provider_task_id and the job completed. */
export const ASYNC_RECOVERABLE_KINDS: ReadonlySet<string> = new Set([
  ...KIE_RECOVER_KINDS,
  ...REPLICATE_RECOVER_KINDS,
  ...ELEVENLABS_RECOVER_KINDS,
  ...FAL_RECOVER_KINDS,
  ...NODARO_CLOUD_RECOVER_KINDS,
  // The copilot turn has no upstream task to re-fetch, but it DOES have a
  // recover handler (`ee/copilot/reconcile.ts`): it settles the turn from the
  // spend persisted per iteration, charging what the model really cost
  // instead of refunding it the way the sync sweep would.
  ...COPILOT_KINDS,
])

/**
 * Kinds the WORKER may leave at `processing` after a post-provider failure,
 * trusting the reconcile system to drive the row to a terminal state.
 *
 * = ASYNC_RECOVERABLE_KINDS (output re-fetched and the job completed, or
 *   exhausted to refund+anomaly after MAX_ATTEMPTS)
 * + "heygen" (decision D3): heygen has NO recover handler — the sync-sweep
 *   fail+refunds it at its 30-min threshold. "Recoverable" here means
 *   "reconcile owns the terminal outcome", not "output recovered": for
 *   heygen that outcome is refund-instead-of-charge.
 */
const WORKER_LEAVE_FOR_RECONCILE_KINDS: ReadonlySet<string> = new Set([
  ...ASYNC_RECOVERABLE_KINDS,
  "heygen",
])

/**
 * True when a post-provider failure on this row should be left to the
 * reconcile system instead of being marked failed+charged by the worker:
 * the provider task id is persisted AND the kind has a reconcile-owned
 * terminal path (recovery or sweep-refund).
 */
export function isReconcileRecoverable(row: {
  provider_kind: string | null
  provider_task_id: string | null
}): boolean {
  if (!row.provider_task_id) return false
  return WORKER_LEAVE_FOR_RECONCILE_KINDS.has(row.provider_kind ?? "")
}
