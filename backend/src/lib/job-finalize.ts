import { supabase } from "./supabase.js"
import { uploadToR2 } from "./storage.js"
import { runPostProcessing } from "./post-processing-error.js"
import { appendCharacterReferenceVideo } from "./character-auto-attach.js"
import { FINALIZE_CLAIM_TTL_MS } from "./reconcile/types.js"
import {
  uploadImageVariantsMaybeWatermark,
  uploadVideoMaybeWatermark,
  buildImageOutputData,
  markJobCompletedDetailed,
  commitJobCredits,
  refundLoopTrimAddon,
  createAssetFromJob,
} from "../workers/shared.js"
import { relayFieldsFrom } from "../providers/nodaro/relay-cost.js"

/**
 * Provider-side input to `finalizeJobWithMedia`. Mirrors the relevant fields
 * of `ProviderResult` (`backend/src/providers/provider.interface.ts`) but
 * pared down to the keys this function actually reads.
 *
 * `extraUrls` carries additional image variants when the provider returned
 * multiple outputs (e.g., GPT-Image n=4). Audio/video providers return a
 * single `url`.
 */
export interface ProviderFinalizeResult {
  url: string
  extraUrls?: readonly string[]
  cost: number | null
  /** See ProviderResult.meteredCost — true only for genuine GPU-time providers
   *  (commit trues-up from cost); fixed/composite providers commit reserved. */
  meteredCost?: boolean
  displayCost?: number | null
  providerUsed?: string | null
  kieTaskId?: string
  seed?: number
  fallbackFlag?: boolean
  providerMs?: number
  /** See ProviderResult.relayJobId/relayCredits (provider.interface.ts) — set
   *  ONLY by the NodaroCloud* providers, which relay the work to another
   *  instance. Mirrored here because this is where a router-lane result becomes
   *  a row: `relayFieldsFrom` turns the pair into migration 383's two columns
   *  in the completion UPDATE below. Absent on every vendor-direct result, so
   *  the mainline write is byte-identical to before. */
  relayJobId?: string
  relayCredits?: number | null
}

/**
 * The three `as const` arrays below are the SINGLE declaration each finalize
 * job-type category derives from: `FinalizeJobType` is `typeof` their union,
 * and the runtime `IMAGE_TYPES`/`VIDEO_TYPES`/`AUDIO_TYPES` sets are built
 * from the same arrays — so a job type added here updates the compile-time
 * union and the runtime set together, and cannot drift between them.
 * Exported so `job-finalize-types.test.ts` can assert the three arrays are
 * pairwise disjoint and jointly cover `FINALIZE_JOB_TYPES`.
 */
export const IMAGE_JOB_TYPES = [
  "generate-image", "image-to-image", "edit-image",
  // `reference-board` is handleGenerateImage under another name
  // (image-ai.ts:372) and finalizes as "generate-image" (:135); the reconcile
  // crons read the ROW's job_type, which is the alias.
  "reference-board",
] as const

export const VIDEO_JOB_TYPES = [
  "image-to-video", "text-to-video", "video-to-video",
  "motion-transfer", "video-upscale", "lip-sync", "extend-video",
  "video-retake", "video-sfx", "ai-avatar", "cinematic-avatar", "switchx",
  // Handlers whose job_type differs from the jobType they pass to finalize:
  // speech-to-video → "image-to-video" (video-ai.ts:891);
  // face-swap → "video-to-video" (video-ai.ts:1404);
  // voiced-video → "image-to-video" (video-ai.ts:1679) — handleVoicedVideo
  // (character-voice orchestration) has exactly ONE completion path, always
  // through finalizeJobWithMedia with this hardcoded jobType (no branch calls
  // its own markJobCompleted), so the alias is safe (Task 5 coverage guard).
  // Sync today: none of its imageToVideo calls registers a reconcile task
  // (video-ai.ts:1462-1469 — the 30-min pre-task sweep is the backstop), so
  // no reconcile tick reaches it. If it ever gains async wiring, settle the
  // voicedAudioAddon refund question (loop-trim P0.3 precedent) at that point:
  // a generic recovery would deliver the raw pre-mux clip.
  "speech-to-video", "face-swap", "voiced-video",
] as const

export const AUDIO_JOB_TYPES = [
  "text-to-speech", "text-to-audio", "generate-music", "voice-clone",
  // NB: "speech-to-text" has no producer today — `transcribe` is the job_type
  // the route and handler map use (routes/transcribe.ts:71,
  // audio-ai.ts:800). Kept for the union's shape; the coverage guard in
  // reconcile/__tests__/finalize-job-type-coverage.test.ts asserts the
  // producer→set direction ONLY, never the reverse.
  "audio-isolation", "speech-to-text", "generate-dialogue",
  // `text-to-dialogue` is handleTextToDialogue under another name
  // (audio-ai.ts:804) and finalizes as "generate-dialogue" (:405). Sync today
  // (no makeOnTaskCreated → no provider_kind), so no reconcile tick reaches
  // it — but it is an ALIAS, not a denial, and listing it here rather than in
  // NOT_GENERIC_RECOVERABLE keeps that honest (M-3a).
  "text-to-dialogue",
  // voice-remix (audio-ai.ts:684) and voice-design (audio-ai.ts:713) are each
  // a single unconditional completion path through finalizeJobWithMedia with
  // jobType "voice-clone" hardcoded — no branch writes its own
  // markJobCompleted, so both are safe aliases (same M-3a shape; found by the
  // Task 5 coverage guard). Contrast with voice-changer and dubbing below,
  // which branch into an OWN markJobCompleted for video-mode output and so
  // are NOT safe generic-finalize aliases. Both are sync today: voice-remix
  // stamps no provider_kind at all; voice-design stamps "elevenlabs-sync"
  // (audio-ai.ts:701), a SYNC kind — so no reconcile tick reaches either.
  "voice-remix", "voice-design",
] as const

/**
 * The set of job types this function knows how to finalize. Anything outside
 * this union throws — by design, since the dispatch table has to know whether
 * to upload as image / video / audio. Derived from the three `as const`
 * arrays above via `typeof … [number]` so it cannot drift from them.
 */
export type FinalizeJobType =
  | (typeof IMAGE_JOB_TYPES)[number]
  | (typeof VIDEO_JOB_TYPES)[number]
  | (typeof AUDIO_JOB_TYPES)[number]

/**
 * Row shape we read from `jobs`. The orchestrator records the per-node owner
 * via `workflow_executions.node_states[nodeId].jobId` — there is no
 * `jobs.node_id` column on the schema today, so the reopen path looks up the
 * owning node from `node_states` instead of joining back via job columns.
 */
/**
 * `{ ok: false }` gained a REASON. Additive, so all 37 callers compile
 * unchanged — and not one of them throws on `{ ok: false }`, which is the
 * property that makes a hold safe on this funnel: the handler returns, the
 * BullMQ job completes normally, no retry, no failure write, no refund. A
 * caller that added a `throw` would turn every hold into a retry loop against a
 * `pending_review` row the pickup CAS refuses — which is exactly what
 * `workers/__tests__/job-policy-result-totality.test.ts` mechanises.
 */
export type FinalizeOutcome = { ok: true } | { ok: false; reason?: "lost_race" | "blocked" | "held" }

interface JobRow {
  id: string
  user_id: string | null
  should_watermark: boolean | null
  is_public: boolean | null
  job_type: string | null
  workflow_execution_id: string | null
  status: string
  /** The user-submitted request config (see `lib/job-input-data.ts`). Read
   *  here only for the reference-video auto-attach intent fields
   *  (`attachToCharacterId` + `attachReferenceVideoVariant`). */
  input_data: Record<string, unknown> | null
}

const IMAGE_TYPES: ReadonlySet<FinalizeJobType> = new Set(IMAGE_JOB_TYPES)

const VIDEO_TYPES: ReadonlySet<FinalizeJobType> = new Set(VIDEO_JOB_TYPES)

const AUDIO_TYPES: ReadonlySet<FinalizeJobType> = new Set(AUDIO_JOB_TYPES)

/** Every job type `finalizeJobWithMedia` can dispatch — the runtime twin of
 *  `FinalizeJobType`. Reconcile writers narrow through `isFinalizeJobType`
 *  instead of casting `row.job_type`. */
export const FINALIZE_JOB_TYPES: ReadonlySet<string> = new Set<string>([
  ...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES,
])

export function isFinalizeJobType(v: string | null | undefined): v is FinalizeJobType {
  return typeof v === "string" && FINALIZE_JOB_TYPES.has(v)
}

/**
 * Job types that MUST NOT take the generic `finalizeJobWithMedia` path even if
 * their provider result could be re-fetched. Four reasons, all load-bearing:
 *
 *  - ENTITY handlers are their own completion writers (`workers/handlers/
 *    entity.ts:199-300`, map at `:781-796`): they call `markJobCompleted` and then
 *    `setCharacterPortrait` / `attachAssetToCharacter` / `autoAttach*Asset`.
 *    Generic finalize writes `buildImageOutputData` + `createAssetFromJob` and
 *    NONE of the entity-row writes — the Studio would never see the result.
 *  - DAG rows carry `job_type = node.type` (`node-executor.ts:1290`),
 *    while payload-builder dispatches under a different `jobName`
 *    (`scene`→generate-image, `upscale-image`→edit-image, …). The node type is
 *    what a reconcile tick reads, and it is not a finalize type.
 *  - COMPOSITE writers shape their own `output_data`: generate-mask
 *    `{imageUrl, maskUrl}` (the repo says so at `video-ai.ts:1438-1440`),
 *    transcribe `{text, language, segments}` (`audio-ai.ts:279-280`), and
 *    generate-surround-continuation `{imageUrl: <composited>, direction, …}`
 *    (`surround.ts:128-138`) — the provider URL is an intermediate there.
 *  - Task 5 (B2c) coverage-guard additions: every remaining STATICALLY
 *    REGISTERED worker handler key (`ffmpeg.ts`, `suno.ts`, `reference-
 *    sheet.ts`, `motion-graphics-lottie.ts`, and the `audio-ai.ts`
 *    stragglers below) that is its own completion writer, or that branches
 *    into its own writer on at least one code path — see the block below
 *    for the per-handler evidence. `finalize-job-type-coverage.test.ts`
 *    fails the build if a new handler key lands in neither set.
 *
 * Membership means "bump with a named reason", never "cast and hope". The
 * previous cast (`(row.job_type ?? "generate-image") as FinalizeJobType`) sent
 * these rows into finalize, which threw, which rode `bumpAttemptsOrExhaust` to
 * 18 attempts and REFUNDED a job whose provider call had succeeded.
 */
export const NOT_GENERIC_RECOVERABLE: ReadonlySet<string> = new Set<string>([
  // Entity handlers — all 14 keys of workers/handlers/entity.ts:781-796.
  // `generate-script` is in that map too (it produces text, not media) and is
  // listed here for the same reason as the rest: the coverage guard in Task 5
  // requires a decision for every handler name (M-D8).
  "generate-character", "generate-face", "generate-character-asset",
  "generate-object", "generate-object-asset",
  "generate-creature", "generate-creature-asset",
  "generate-location", "generate-location-asset",
  "generate-script",
  "generate-character-motion", "generate-location-motion",
  "generate-object-motion", "generate-creature-motion",
  // DAG node types (node-executor.ts:1290 writes job_type = node.type)
  "character", "face", "object", "creature", "location", "scene",
  "modify-image", "upscale-image", "remove-background", "motion-graphics",
  // Composite / non-media completion writers
  "generate-mask", "transcribe", "generate-surround-continuation",

  // --- Task 5 (B2c) coverage-guard additions below ---------------------------
  // Handlers that never persist a recoverable provider task id, or that write
  // their own non-media output_data. Listed so the coverage guard has an
  // explicit decision for every handler name rather than an implicit gap.

  // ffmpeg.ts — all 24 keys of workers/handlers/ffmpeg.ts:968-991. Local
  // CPU-bound ffmpeg processing: no onTaskCreated is ever called, so no
  // async provider_kind is stamped and a reconcile tick never needs to
  // recover one of these by re-fetching a provider result. Each calls its
  // own markJobCompleted with a handler-specific output_data shape (e.g.
  // combine-videos → {videoUrl, thumbnailUrl}; trim-audio → {audioUrl}) —
  // never finalizeJobWithMedia.
  "combine-videos", "assemble-narrated-video", "image-collage",
  "merge-video-audio", "trim-audio", "trim-video", "extract-frame",
  "speed-ramp", "loop-video", "fade-video", "still-to-video",
  "gif-to-video", "slideshow", "resize-video", "adjust-volume",
  "audio-fx", "add-captions", "mix-audio", "combine-audio",
  "transcode-video", "social-media-format", "split-media",
  "extract-audio", "remove-audio",

  // suno.ts — all 12 keys of workers/handlers/suno.ts:580-593. None call
  // finalizeJobWithMedia (own markJobCompleted per handler); the async
  // "kie-suno" provider_kind IS recoverable, but reconcile/kie.ts:194
  // hardcodes the finalize jobType to "generate-music" regardless of which
  // suno-* job_type the row carries — the row's own job_type is never used
  // to dispatch, so it must not be treated as a generic-finalize type.
  "suno-generate", "suno-cover", "suno-extend", "suno-lyrics",
  "suno-separate", "suno-music-video", "suno-mashup",
  "suno-replace-section", "suno-add-instrumental", "suno-add-vocals",
  "suno-convert-wav", "suno-upload-extend",

  // reference-sheet.ts:181 and motion-graphics-lottie.ts:173 — single-key
  // maps, each handler calls its own markJobCompleted with a bespoke
  // output_data shape (never finalizeJobWithMedia).
  "reference-sheet", "motion-graphics-lottie",

  // audio-ai.ts stragglers:
  //  - extract-youtube-audio: own markJobCompleted ({audioUrl}).
  //  - audio-separation: own markJobCompleted with per-stem output_data
  //    (vocalUrl/instrumentalUrl/drumsUrl/...); no onTaskCreated (a crash
  //    fails+refunds rather than reconcile-recovering, which would flatten
  //    the stems — design §C(c)). Confirmed "verified not at risk" (audit).
  //  - forced-alignment: own markJobCompleted ({alignment, text}); sync
  //    provider_kind ("elevenlabs-sync") only.
  //  - voice-changer and dubbing: BRANCHING completion — the audio-only path
  //    finalizes via finalizeJobWithMedia (voice-changer → "voice-clone",
  //    audio-ai.ts:472; dubbing's shared deliverDubbedMedia → "text-to-audio",
  //    dubbing-delivery.ts:72), but the video-mode branch writes its own
  //    markJobCompleted ({videoUrl, audioUrl, thumbnailUrl}) instead. Because
  //    the row's job_type stays "voice-changer"/"dubbing" in BOTH modes, a
  //    generic reconcile recovery cannot know which branch would have run —
  //    unlike voice-remix/voice-design above, these are NOT safe aliases.
  //    dubbing is separately confirmed "verified not at risk" (audit): its
  //    async "elevenlabs-async" provider_kind is recovered by the DEDICATED
  //    reconcileElevenLabsJob → deliverDubbedMedia path, never by a generic
  //    row.job_type-keyed finalize.
  "extract-youtube-audio", "audio-separation", "forced-alignment",
  "voice-changer", "dubbing",
])

/**
 * Look up the reserved usage_log id for a job. There is no `usage_log_id`
 * column on `jobs` today (see D7 in `docs/design/external-call-reconciliation.md`),
 * so we query `usage_logs` directly. Returns `null` when no reserved row exists
 * — `commitJobCredits` then no-ops gracefully.
 *
 * Exported (Task 6, app-reports W4) so the transcribe reconcile-recovery
 * branch in `reconcile/replicate.ts` can reuse this exact lookup instead of
 * writing a second copy.
 */
export async function loadUsageLogId(jobId: string): Promise<string | null> {
  const { data } = await supabase
    .from("usage_logs")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "reserved")
    .limit(1)
  return (data?.[0] as { id: string } | undefined)?.id ?? null
}

/** Who is finalizing — drives same-claimant claim re-entry (audit H1): a
 *  BullMQ stall re-pick (claimant "worker", via inline reconcile) instantly
 *  re-claims its crashed predecessor's claim; the cron ("cron") still cannot
 *  steal a fresh worker claim before the TTL, and vice versa. */
export type FinalizeClaimant = "worker" | "cron"

/**
 * CAS-claim the finalize phase for a job via the `claim_job_finalize` RPC
 * (migrations 210 + 211). Returns the claim timestamp when won, `{ won:
 * false }` when ANOTHER claimant holds an unexpired claim (or the row went
 * terminal). A fresh claim held by the SAME claimant is re-claimable.
 *
 * This is the mutual exclusion between the worker and the reconcile cron:
 * both funnel through `finalizeJobWithMedia` for the same jobId and used to
 * download the provider result and upload the same deterministic R2 key
 * concurrently. The claim makes the loser exit BEFORE any media work.
 *
 * On RPC error we proceed unclaimed (availability over exclusion): with the
 * failure-path delete removed from `uploadToR2`, a duplicate finalize is
 * benign — an idempotent overwrite plus a CAS-guarded `markJobCompleted` —
 * while refusing to finalize would strand a deliverable job on a DB hiccup.
 */
async function claimJobFinalize(
  jobId: string,
  claimant: FinalizeClaimant,
): Promise<{ won: boolean; ts: string | null }> {
  const { data, error } = await supabase.rpc("claim_job_finalize", {
    p_job_id: jobId,
    p_ttl_seconds: Math.floor(FINALIZE_CLAIM_TTL_MS / 1000),
    p_claimant: claimant,
  })
  if (error) {
    console.warn(
      `[job-finalize] claim RPC failed for ${jobId} — proceeding unclaimed: ${error.message}`,
    )
    return { won: true, ts: null }
  }
  return data
    ? { won: true, ts: data as string }
    : { won: false, ts: null }
}

/**
 * Release a finalize claim after a failed media step so a BullMQ retry or the
 * next reconcile tick can re-claim immediately instead of waiting out the TTL.
 * Scoped to our own claim timestamp — never clears a claim a newer finalizer
 * took. Best-effort: the TTL is the backstop if this write fails.
 */
async function releaseJobFinalizeClaim(jobId: string, claimTs: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("jobs")
      .update({ finalize_claimed_at: null, finalize_claimed_by: null })
      .eq("id", jobId)
      .eq("finalize_claimed_at", claimTs)
    if (error) {
      // Surface PostgREST errors too (they resolve, not throw) — a silently
      // dead release means every failed finalize waits out the full TTL.
      console.warn(`[job-finalize] claim release failed for ${jobId}: ${error.message}`)
    }
  } catch (err) {
    console.warn(`[job-finalize] claim release failed for ${jobId}: ${String(err)}`)
  }
}

/**
 * If a workflow_execution was marked `failed` solely because of this job's node,
 * flip it back to `completed`. Used when reconciliation recovers a single stuck
 * node — the rest of the DAG already completed successfully on the prior attempt.
 *
 * Source of truth is `workflow_executions.node_states` — a jsonb
 * `Record<nodeId, { status, jobId, error, ... }>` populated by the orchestrator
 * (see `orchestrator-worker.ts:306` for the shape). We identify our owning node
 * by `state.jobId === jobId`, then verify it's the only `failed` entry across
 * all node_states before reopening.
 *
 * CAS-guarded on `.eq("status", "failed")` so a user cancellation that landed
 * between the SELECT and the UPDATE is NOT overwritten.
 */
async function reopenWorkflowExecutionIfSoleCause(
  workflowExecutionId: string,
  jobId: string,
): Promise<void> {
  const { data: exec } = await supabase
    .from("workflow_executions")
    .select("status, node_states, completed_nodes")
    .eq("id", workflowExecutionId)
    .single()

  if (!exec || exec.status !== "failed") return

  const nodeStates = (exec.node_states ?? {}) as Record<
    string,
    { status?: string; jobId?: string }
  >

  // Find which node owns this job, and count failed nodes overall.
  let ourNodeId: string | null = null
  let failedCount = 0
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    if (state.jobId === jobId) ourNodeId = nodeId
    if (state.status === "failed") failedCount++
  }

  // Only reopen when (a) we found our node, (b) it's the failed one, and
  // (c) no other node is currently failed.
  if (!ourNodeId) return
  if (nodeStates[ourNodeId]?.status !== "failed") return
  if (failedCount !== 1) return

  const updatedNodeStates = {
    ...nodeStates,
    [ourNodeId]: { ...nodeStates[ourNodeId], status: "completed" },
  }

  await supabase
    .from("workflow_executions")
    .update({
      status: "completed",
      node_states: updatedNodeStates,
      failed_nodes: 0,
      completed_nodes: ((exec.completed_nodes as number | null) ?? 0) + 1,
      error_message: null,
    })
    .eq("id", workflowExecutionId)
    .eq("status", "failed")  // CAS — preserve a user cancel that landed in this window
}

export interface FinalizeInput {
  jobId: string
  jobType: FinalizeJobType
  result: ProviderFinalizeResult
  /** Optional pre-uploaded R2 URL. When provided, finalize skips its own
   *  upload step and uses this URL directly. Used by video handlers that
   *  must upload before finalize (audio merge produces a local file the
   *  handler uploads + watermarks itself). Image and audio handlers + all
   *  reconcile paths leave this undefined and let finalize upload.
   *  For multi-variant outputs (image), pass the primary URL here and the
   *  variants via `extraMediaUrls`. */
  mediaUrl?: string
  /** Extra R2 URLs for multi-variant image outputs (used alongside
   *  `mediaUrl`). Ignored for video/audio. */
  extraMediaUrls?: readonly string[]
  /** Extra fields merged into `output_data` (e.g., `thumbnailUrl`,
   *  provider-meta extras). Useful for video handlers that need to record
   *  a thumbnail alongside the main URL. */
  extraOutputData?: Record<string, unknown>
  /** Credits for work NOT reflected in the provider's USD cost (e.g. a
   *  successful loop-trim add-on). Passed through to commitJobCredits so the
   *  provider-cost reconciliation doesn't refund it. Defaults to none. */
  extraNonProviderCredits?: number
  /** Who is finalizing (audit H1). Worker handlers omit it (default
   *  "worker"); the reconcile cron passes "cron"; the stall re-pick's inline
   *  reconcile passes "worker" so it can re-claim its predecessor's claim. */
  claimant?: FinalizeClaimant
  /** Loop-trim add-on credits to take OFF the commit (audit P0.3, review F7).
   *  TWO callers: reconcile recovery, which delivers the RAW i2v clip without
   *  the smart-loop-cut, and the i2v worker itself when the post-process threw.
   *  Applied AFTER markJobCompleted wins (committing reserved − addon via
   *  refundLoopTrimAddon) — never before, so a failed finalize leaves the log
   *  `reserved`: the exhaustion refund stays effective, and so does every
   *  result-gate refund (block / reject / hold expiry / cancel), all of which
   *  only touch `reserved` logs. Also parked in `held_completion_fields` so
   *  `approveHeldJob` can replay the same settlement. Ignored for orchestrated jobs
   *  (base-only reservation — the addon was never charged). */
  loopTrimAddonRefundCredits?: number
}

/**
 * Post-success completion path shared by worker handlers and the reconciliation
 * cron. Claims the finalize phase → uploads media → CAS-guarded markCompleted
 * → commit credits → create asset → reopen workflow_executions if this was the
 * sole-cause failure.
 *
 * Safe under worker+cron race at TWO layers: the `claim_job_finalize` CAS
 * makes the losing finalizer exit before any media work (no duplicate
 * download/upload of the same deterministic R2 key), and `markJobCompleted`'s
 * CAS UPDATE guarantees a single completion writer even if a claim expires
 * mid-flight. Never delete the deterministic key on a failed upload — see
 * uploadToR2's catch (incident 2026-06-10).
 *
 * Returns `{ ok: true }` only when the CAS UPDATE succeeded AND we committed
 * credits + created the asset. `{ ok: false }` covers five cases:
 *  - jobs row not found (callsite probably wrong)
 *  - jobs.status already terminal (cancelled / completed / failed)
 *  - finalize claim lost (another finalizer is mid-flight on this job)
 *  - markJobCompleted CAS missed (concurrent cancel won)
 */
export async function finalizeJobWithMedia(
  input: FinalizeInput,
): Promise<FinalizeOutcome> {
  const { jobId, jobType, result } = input

  // 1. Load job row (the shape we need for upload / asset / reopen).
  const { data: jobRow } = await supabase
    .from("jobs")
    .select("id, user_id, should_watermark, is_public, job_type, workflow_execution_id, status, input_data")
    .eq("id", jobId)
    .single()
  const job = jobRow as JobRow | null
  if (!job) {
    console.warn(`[job-finalize] job ${jobId} not found`)
    return { ok: false }
  }
  if (job.status !== "pending" && job.status !== "processing") {
    // Already terminal — finalize is a no-op so we don't trample a prior
    // completion / cancellation. Caller should treat this as a successful
    // skip (the work was already done).
    return { ok: false }
  }

  const watermark = job.should_watermark ?? false

  // 1.5. CAS-claim the finalize phase. The loser (a concurrent finalizer of a
  //    DIFFERENT claimant, or a row that just went terminal) exits here with
  //    the standard graceful-skip contract — BEFORE downloading the provider
  //    result or touching the deterministic R2 key. A claimant that fails
  //    mid-upload releases the claim below; a crashed one is covered by the
  //    TTL, and its own stall re-pick re-claims immediately (same claimant).
  const claim = await claimJobFinalize(jobId, input.claimant ?? "worker")
  if (!claim.won) return { ok: false }

  // 2. Look up usage_log_id from usage_logs (NOT from a jobs.* column —
  //    that column doesn't exist; see D7 in the design spec §3).
  const usageLogId = await loadUsageLogId(jobId)

  // 3. Upload media — dispatch by jobType. Callers that have already uploaded
  //    (e.g., video handlers after audio-merge produces a local file) pass
  //    `input.mediaUrl` so we skip the upload and use it directly.
  let outputData: Record<string, unknown>
  // Captured for the reference-video auto-attach below — set only on the video
  // path (the R2 URL we record as the clip's canonical location).
  let videoR2Url: string | undefined
  try {
    if (IMAGE_TYPES.has(jobType)) {
      const r2Urls = input.mediaUrl !== undefined
        ? [input.mediaUrl, ...(input.extraMediaUrls ?? [])]
        : await uploadImageVariantsMaybeWatermark(
            [result.url, ...(result.extraUrls ?? [])],
            jobId,
            job.user_id ?? undefined,
            watermark,
          )
      outputData = buildImageOutputData(
        result as Parameters<typeof buildImageOutputData>[0],
        r2Urls,
      )
    } else if (VIDEO_TYPES.has(jobType)) {
      const r2Url = input.mediaUrl !== undefined
        ? input.mediaUrl
        : await uploadVideoMaybeWatermark(
            result.url,
            jobId,
            job.user_id ?? undefined,
            watermark,
          )
      videoR2Url = r2Url
      outputData = { videoUrl: r2Url }
    } else if (AUDIO_TYPES.has(jobType)) {
      // Audio is never watermarked. Callers with a pre-uploaded R2 URL pass it
      // through `input.mediaUrl`; otherwise finalize uploads via `uploadToR2`.
      // POST-PROVIDER: `result.url` is the provider's delivered audio — an R2
      // upload failure here is post-delivery, so tag it (refund guard skips).
      const r2Url = input.mediaUrl !== undefined
        ? input.mediaUrl
        : await runPostProcessing(() => uploadToR2(result.url, jobId, "audio", job.user_id ?? undefined))
      outputData = { audioUrl: r2Url }
    } else {
      throw new Error(`[job-finalize] unknown jobType: ${jobType}`)
    }
  } catch (err) {
    // Failed media step: release our claim so a BullMQ retry or the next
    // reconcile tick can re-attempt immediately, then surface the error
    // unchanged (refund classification stays the caller's concern).
    if (claim.ts) await releaseJobFinalizeClaim(jobId, claim.ts)
    throw err
  }

  if (input.extraOutputData) {
    outputData = { ...outputData, ...input.extraOutputData }
  }

  // 4. CAS-guarded markJobCompleted (live statuses only). Null provider /
  //    cost fields are OMITTED, not written: the reconcile path passes
  //    cost:null + providerUsed:null ("actual cost unknown post-reconcile"),
  //    and writing those NULLs clobbered whatever the worker/route had
  //    already recorded — every cron-completed job lost its provider
  //    metadata (admin data-quality residual from the 2026-06-10 audit).
  const outcome = await markJobCompletedDetailed(
    jobId,
    {
      output_data: outputData,
      ...(result.providerUsed != null && { provider: result.providerUsed }),
      ...(result.cost != null && { provider_cost: result.cost }),
      ...(result.displayCost != null && { display_cost: result.displayCost }),
      ...(result.kieTaskId && { provider_task_id: result.kieTaskId }),
      // Relay provenance (spec §8.2 lane 1, migration 383). `{}` for every
      // result no NodaroCloud* provider produced, so a vendor-direct
      // completion writes exactly the columns it wrote before. On a HOLD the
      // gate parks these two in `held_completion_fields` with the other
      // caller columns and `approveHeldJob` spreads them back onto the row —
      // they are ordinary `jobs` columns, NOT settlement inputs, so they must
      // never appear in HELD_COMMIT_REPLAY_KEYS or the commitReplay below.
      ...relayFieldsFrom(result),
    },
    // THE hold-eligible funnel: this is the only completion whose tail
    // (runCompletionTail) a review APPROVE can replay, which is what makes a
    // hold honest here and a downgrade-to-block honest everywhere else.
    "finalize",
    // The settlement inputs that are not jobs columns, so approve can replay
    // the metered true-up instead of committing a ceiling (Q2) — and, when the
    // smart-loop-cut failed, the add-on that must come OFF that commit (F7).
    // The worker deliberately no longer settles the add-on itself, so this is
    // the only carrier: without it the held row has no record of the add-on at
    // all and approve can only replay a FULL commit, overcharging the user for
    // a trim that never happened.
    {
      metered: result.meteredCost,
      extraNonProviderCredits: input.extraNonProviderCredits,
      meteredCost: result.cost,
      loopTrimAddonRefundCredits: input.loopTrimAddonRefundCredits,
    },
  )
  if (outcome !== "completed") {
    // A HELD row is not terminal: release OUR finalize claim so the approve
    // path (and any later re-pick) sees a clean row instead of waiting out
    // FINALIZE_CLAIM_TTL_MS. A blocked row is terminal and keeps its claim
    // (harmless — claim_job_finalize's own status gate refuses it anyway).
    if (outcome === "held" && claim.ts) await releaseJobFinalizeClaim(jobId, claim.ts)
    return { ok: false, reason: outcome }
  }

  // 5. Commit credits (idempotent: CAS on usage_logs.status='reserved' inside
  //    both branches; null usageLogId is a graceful no-op). When a loop-trim
  //    addon must come off (reconcile-recovered raw i2v clip, single-node
  //    reservation only), commit at (reserved − addon) via refundLoopTrimAddon
  //    INSTEAD of the plain commit — deliberately here, AFTER the CAS win,
  //    so a failed finalize never strands the log outside `reserved` (which
  //    silently defeated the exhaustion refund — audit P0.3).
  const loopTrimRefund = input.loopTrimAddonRefundCredits ?? 0
  if (loopTrimRefund > 0 && !job.workflow_execution_id) {
    await refundLoopTrimAddon(jobId, usageLogId, loopTrimRefund)
  } else {
    await commitJobCredits(usageLogId, jobId, result.cost, input.extraNonProviderCredits, result.meteredCost)
  }

  // 6-8. The shared completion tail.
  await runCompletionTail(job, videoR2Url)

  return { ok: true }
}

/**
 * Finalize steps 6-8, verbatim — gallery asset → reopen a sole-cause-failed
 * execution → best-effort reference-video auto-attach.
 *
 * EXTRACTED so the policy-review APPROVE path replays the REAL tail instead of
 * a copy that drifts. Approve cannot re-enter `finalizeJobWithMedia` itself:
 * its status guard admits only `pending`/`processing` and `claim_job_finalize`'s
 * SQL predicate says the same (migration 211:57), so approve does its own CAS
 * and calls this. The one step it does NOT share is the credit commit, which is
 * caller-parameterised — approve replays it from `held_completion_fields`.
 *
 * Never throws: a failed attach must not undo a committed completion.
 */
export async function runCompletionTail(
  job: Pick<JobRow, "id" | "user_id" | "workflow_execution_id" | "input_data">,
  videoR2Url: string | undefined,
): Promise<void> {
  const jobId = job.id

  // 6. Create asset record so the output appears in /library.
  await createAssetFromJob(jobId, job.user_id ?? undefined)

  // 7. Reopen workflow_execution if this was the sole-cause failure
  if (job.workflow_execution_id) {
    await reopenWorkflowExecutionIfSoleCause(job.workflow_execution_id, jobId)
  }

  // 8. Best-effort reference-video auto-attach. When the generate-video request
  //    carried an explicit "save this clip to a character" intent
  //    (attachToCharacterId + attachReferenceVideoVariant, persisted in
  //    input_data), append the completed R2 clip to
  //    characters.reference_videos_by_variant. Runs for BOTH the worker and
  //    reconcile paths (this is the shared completion point) and only after the
  //    job actually completed (we're past the markJobCompleted CAS), so a clip
  //    is never attached for a job that lost the completion race. `videoR2Url`
  //    is set only on the video path, so this naturally no-ops for image/audio.
  //    The atomic RPC re-verifies ownership against job.user_id (the
  //    authoritative job owner, NOT a body field), so a forged
  //    attachToCharacterId pointing at another user's character is a no-op.
  //    Never throws — a failed attach must not undo a committed completion.
  if (videoR2Url && job.user_id) {
    const inputData = job.input_data ?? {}
    const characterId =
      typeof inputData.attachToCharacterId === "string" ? inputData.attachToCharacterId : null
    const variant =
      typeof inputData.attachReferenceVideoVariant === "string"
        ? inputData.attachReferenceVideoVariant.trim()
        : ""
    if (characterId && variant) {
      try {
        await appendCharacterReferenceVideo({
          characterId,
          userId: job.user_id,
          variant,
          url: videoR2Url,
        })
      } catch (e) {
        console.warn(`[job-finalize] reference-video auto-attach threw for job ${jobId}: ${String(e)}`)
      }
    }
  }
}
