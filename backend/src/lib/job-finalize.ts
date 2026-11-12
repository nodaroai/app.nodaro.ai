import { RENDER_NODE_TYPE_IDS } from "@nodaro/shared/nodes"
import { supabase } from "./supabase.js"
import { uploadToR2 } from "./storage.js"
import { requestedImageFormat, storeFormattedImages } from "./image-output-store.js"
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
import { heldCommitArgs, type HeldCommitReplay } from "./job-policy.js"
import { gptImage26AutoSettledBase } from "./gpt-image-2-6-settle.js"
import { recordedLengthBoundSec, recordedVideoLengthSec } from "./generated-video-recorded-length.js"
// @registry-enumerates NOT_GENERIC_RECOVERABLE carries every node unit with the "finalize:own-writer" capability
import { UNIT_NODE_DESCRIPTORS } from "./unit-descriptors.js"
import { composeSet, unitsWith } from "./unit-compose.js"
import { AUDIO_TYPES, IMAGE_TYPES, VIDEO_TYPES, type FinalizeJobType, type ProviderFinalizeResult } from "./job-finalize-types.js"
import { assertExtraImageSets, libraryImagesOf, storeExtraImageSets, storeWithAttempts, type DroppedExtraImages, type ExtraImageSet, type StoredExtraImages } from "./job-finalize-store.js"
import { DISCARD_AFTER_MISSED_BLOCK, DISCARD_STATUSES, discardUnfinishedStores, storeLedger } from "./job-finalize-discard.js"

// The job types, the provider result and the extra-image declarations live in their own modules; callers import them from here.
export { AUDIO_JOB_TYPES, FINALIZE_JOB_TYPES, IMAGE_JOB_TYPES, VIDEO_JOB_TYPES, isFinalizeJobType, type FinalizeJobType, type ProviderFinalizeResult } from "./job-finalize-types.js"
export { EXTRA_IMAGE_UPLOAD_CONCURRENCY, type DroppedExtraImages, type ExtraImageSet, type StoredExtraImages } from "./job-finalize-store.js"

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
   *  here for an image's requested `outputFormat` and the reference-video
   *  auto-attach intent fields (`attachToCharacterId` +
   *  `attachReferenceVideoVariant`). */
  input_data: Record<string, unknown> | null
}

/**
 * Job types that MUST NOT take the generic `finalizeJobWithMedia` path even if
 * their provider result could be re-fetched. Four reasons, all load-bearing:
 *
 *  - ENTITY handlers are their own completion writers — they write an
 *    entity-shaped `output_data` and then `setCharacterPortrait` /
 *    `attachAssetToCharacter` / `autoAttach*Asset`, none of which generic
 *    finalize performs. That is still true, but it is no longer a reason to
 *    DISCARD a recovered result: since PR "entity reconcile recovery" the 13
 *    entity MEDIA types finalize through the shared tail in
 *    `lib/entity-finalize.ts` (worker and cron call the same function) and the
 *    reconcile writers route them there BEFORE this denylist is consulted. Only
 *    `generate-script` remains listed: it is the LLM lane, never calls
 *    `onTaskCreated`, and so never persists a `provider_task_id` a reconcile
 *    tick could poll.
 *  - DAG rows are INSERTED with `job_type = node.type` (the
 *    `insertInternalJob("orchestrator", …)` call in `node-executor.ts`), while
 *    payload-builder dispatches under a different `jobName`
 *    (`scene`→generate-image, `upscale-image`→edit-image, …). The node type is
 *    what a reconcile tick reads on a row the video worker has not picked up
 *    yet, and it is not a finalize type. NB the node type is only the row's
 *    value UNTIL pickup: the `job_type: job.name` line in `video-worker.ts`
 *    OVERWRITES it with the queue name (unconditionally — that overwrite is
 *    what puts DAG output in the gallery). These entries therefore guard the
 *    pre-pickup window only; they stay listed because that window is real (a
 *    row can be swept before any worker touches it) and removing them would
 *    hand such a row to a generic finalize that throws.
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
 *
 * One exception, decided before this set is consulted: an own-writer node unit
 * with a recovery (its `recover.ts`, `lib/reconcile/unit-recovery.ts`) is still
 * listed — no GENERIC finalize may take its row — but the KIE reconcile
 * delivers its task's result through the unit's OWN delivery instead of
 * bumping it.
 */
// Legacy keys ∪ every node unit whose worker writes its own completion
// (capability "finalize:own-writer", tools/units/capabilities.mjs).
export const NOT_GENERIC_RECOVERABLE: ReadonlySet<string> = composeSet("NOT_GENERIC_RECOVERABLE", new Set<string>([
  // Entity handlers — the ONE non-media key of workers/handlers/entity.ts.
  // The other 13 are entity MEDIA types and now live in
  // `ENTITY_MEDIA_JOB_SPECS` (lib/entity-finalize.ts), which the reconcile
  // writers dispatch on before reaching this set — they are recovered through
  // the same completion tail the worker runs, not discarded. `generate-script`
  // produces text through the LLM lane and persists no provider task id, so it
  // stays here: listed, decided, unreachable.
  "generate-script",
  // DAG node types (node-executor.ts inserts job_type = node.type; the
  // video-worker pickup CAS overwrites it with the queue name, so these are
  // reachable only before a worker picks the row up — see the doc comment)
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
  "combine-videos", "assemble-narrated-video", "image-collage", "image-overlay",
  "merge-video-audio", "trim-audio", "trim-video", "extract-frame",
  "speed-ramp", "loop-video", "fade-video", "video-overlay", "still-to-video",
  "slideshow", "resize-video", "adjust-volume",
  "audio-fx", "pitch-tempo", "add-captions", "mix-audio", "combine-audio",
  "transcode-video", "social-media-format", "split-media",
  "extract-audio", "mask-composite",
  // Mask Erase — local ffmpeg on a mask (an internal child step), finished by
  // completeFfmpegVideoJob like the ffmpeg nodes above.
  "mask-erase",
  // Mask Outline — local drawing on a clip (an internal child step), its own
  // markJobCompleted with output_data.{frames, perOutline, ambiguous, …}.
  "mask-outline",
  // Video Face Mesh — local drawing (an internal child step), its own
  // markJobCompleted with output_data.{frames, facesDrawn, …}.
  "video-face-mesh",
  // Video Mask calls fal but registers no onTaskCreated (its RLE is rendered
  // locally — providers/fal/sam3-video.ts) and writes its own output_data.
  "video-mask",
  // silence-detect — a SYNC local-ffmpeg analysis (no provider_task_id, its own
  // markJobCompleted with output_data.json); never finalizeJobWithMedia.
  "silence-detect",
  // audio-sync — the same shape: a SYNC local analysis (ffmpeg decode +
  // in-process correlation), own markJobCompleted with output_data.json.
  "audio-sync",
  // The background scrapes (workers/handlers/background-scrape.ts): each runs
  // its provider to the end in the handler and writes its own data
  // output_data through markJobCompleted. They DO persist a provider_task_id
  // (their Apify run, `apify-run`, or their relay's cloud job, `nodaro-cloud`
  // — lib/background-scrape/scrape-run.ts), but only so their own handler can
  // re-attach to it on a re-pick; no generic finalize can settle one (the plan
  // it settles with lives in its worker payload, never on the row).
  "web-scrape", "site-capture", "meta-ads-scrape", "instagram-scrape",
  // Every render (RENDER_NODE_TYPES; Apply EDL today) — a local-ffmpeg EDL
  // render (no provider_task_id; chunked with its OWN R2 checkpoint-resume,
  // all-or-nothing, own markJobCompleted). Recovery is the worker's, not the
  // generic media-finalize path — like combine-videos above. A render that
  // joins the registry must complete that way too, or leave this spread.
  ...RENDER_NODE_TYPE_IDS,

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
]), unitsWith(UNIT_NODE_DESCRIPTORS, "finalize:own-writer"))

/**
 * Look up the OPEN reservation for a job: the `usage_logs` row keyed by its
 * `job_id` that is still `reserved`. Deliberately not `jobs.usage_log_id`
 * (which exists, and which `CreditsService.reserveCredits` writes for every
 * reservation that names a job): finalize wants only a hold that is still
 * open — a settled or refunded one must not be committed again — and rows
 * reserved before every lane wrote the link have none. Returns `null` when no
 * reserved row exists — `commitJobCredits` then no-ops gracefully.
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
 * An unclaimed finalize never deletes what it stored (it has no claim to
 * fence, lib/job-finalize-discard.ts), and a claimed one deletes only on a row
 * that already went terminal without a completion (cancelled or failed) —
 * never a live row another finalizer may still complete naming the same keys.
 */
export async function claimJobFinalize(
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
export async function releaseJobFinalizeClaim(jobId: string, claimTs: string): Promise<void> {
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
   *  handler uploads + watermarks itself) and by audio handlers.
   *  REFUSED for image job types: finalize's image upload is the one place an
   *  image is watermarked and charged to the user's storage, so a handler that
   *  produced its own image (the inpaint composite) passes it as `result.url`
   *  instead and lets finalize upload it (#2386). */
  mediaUrl?: string
  /** Extra fields merged into `output_data` (e.g., `thumbnailUrl`,
   *  provider-meta extras). Useful for video handlers that need to record
   *  a thumbnail alongside the main URL. A function is handed the stored URLs
   *  of `extraImageSets` (by key), for fields that name them (each layer's
   *  data beside its stored file), and the result's own stored URL — exactly
   *  what this finalize writes to `output_data.imageUrl` (`videoUrl` /
   *  `audioUrl` for a video or audio job), for fields that name it (each
   *  layer's data names the base it was cut from). */
  extraOutputData?: Record<string, unknown> | ((stored: StoredExtraImages, dropped: DroppedExtraImages, resultUrl: string) => Record<string, unknown>)
  /** Extra images an IMAGE job delivers beside its result (every layer of a
   *  split image): stored like the result, their URLs on `output_data[key]`,
   *  and — for a set with `library` — filed in the Library under their names.
   *  Absent: finalize is exactly as before. */
  extraImageSets?: ReadonlyArray<ExtraImageSet>
  /** How many times each image is tried before its store fails (an IMAGE job's
   *  result, unless it asked for a format, and every extra image). Absent: 1,
   *  exactly as before. A failed attempt stores and counts nothing. */
  storeAttempts?: number
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
  /** The charge the handler measured for this job, in BASE (pre-markup)
   *  credits — a Seedance reference-video run priced from the clip the
   *  provider actually delivered (`measureSeedance2RefVideoBaseCredits`). The
   *  reservation for such a run is a worst case (an edit renders the source
   *  clip's length, not the requested duration), so the commit settles to the
   *  measured price instead of the reserved tier: count-based, marked up once,
   *  never above the reservation, `extraNonProviderCredits` on top. Parked in
   *  `held_completion_fields` so approve replays the same settlement. Takes
   *  precedence over `loopTrimAddonRefundCredits` — the measured charge already
   *  excludes an add-on that was not delivered. A function is handed what the
   *  extra image sets stored and dropped, so the charge counts only the images
   *  really stored (a split image settles on its base plus its stored layers). */
  meteredBaseCredits?: number | ((stored: StoredExtraImages, dropped: DroppedExtraImages) => Promise<number | undefined>)
  /** The length, in seconds, of the video stored as this job's output, from a
   *  measurement the handler already took: of the provider's take, passed only
   *  when nothing after it changed the take's length (a watermark re-encode or a
   *  re-upload keeps it; a loop cut, an audio merge or a voice mux may not, and
   *  then nothing is passed). Read only for a length-following video generation
   *  run (`recordedLengthBoundSec`), which records its length; without it that
   *  run's stored file is probed once. Every other job ignores it. */
  deliveredVideoSec?: number
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
 * uploadToR2's catch (incident 2026-06-10). What a finalize DID store and will
 * not complete with (a later step threw, or a cancel won the completion) it
 * deletes itself, under its claim and before releasing it
 * (lib/job-finalize-discard.ts), so no object is left unreferenced and counted.
 *
 * Returns `{ ok: true }` only when the CAS UPDATE succeeded AND we committed
 * credits + created the asset. `{ ok: false }` covers five cases:
 *  - jobs row not found (callsite probably wrong)
 *  - jobs.status already terminal (cancelled / completed / failed)
 *  - finalize claim lost (another finalizer is mid-flight on this job)
 *  - markJobCompleted CAS missed (concurrent cancel won) — what this finalize
 *    stored is deleted when the row is cancelled or failed
 *  - the result gate held or blocked the result (`reason`)
 */
export async function finalizeJobWithMedia(
  input: FinalizeInput,
): Promise<FinalizeOutcome> {
  const { jobId, jobType, result } = input
  if (IMAGE_TYPES.has(jobType) && input.mediaUrl !== undefined) {
    // A pre-uploaded image would skip the watermark and the user's storage
    // accounting (#2386). Fail before any claim or write.
    throw new Error(`[job-finalize] ${jobType}: pass the image as result.url, not mediaUrl`)
  }
  assertExtraImageSets(jobType, input.extraImageSets)

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

  // 2. The job's open reservation, read from usage_logs by job_id (see
  //    loadUsageLogId for why not jobs.usage_log_id).
  const usageLogId = await loadUsageLogId(jobId)

  // 3. Upload media — dispatch by jobType. Callers that have already uploaded
  //    (e.g., video handlers after audio-merge produces a local file) pass
  //    `input.mediaUrl` so we skip the upload and use it directly. Images
  //    always upload here (mediaUrl is refused above).
  let outputData: Record<string, unknown>
  // Captured for the reference-video auto-attach below — set only on the video
  // path (the R2 URL we record as the clip's canonical location).
  let videoR2Url: string | undefined
  // The extra image sets' stored URLs and dropped images, by key (none without extraImageSets).
  let storedExtras: StoredExtraImages = {}
  let droppedExtras: DroppedExtraImages = {}
  // The handler's measured charge, resolved inside the claim (a function reads what was stored).
  let meteredBaseCredits: number | undefined
  // Every object THIS finalize stored, as each store lands — what it deletes
  // again if it does not complete the job (lib/job-finalize-discard.ts).
  const ledger = storeLedger()
  const attempts = input.storeAttempts ?? 1
  try {
    if (IMAGE_TYPES.has(jobType) && requestedImageFormat(job.input_data)) {
      // A run that asked for JPEG, WebP, a GIF or an SVG: stored as what its
      // bytes are, an SVG made safe first (a refused one fails the job with a
      // refund, lib/image-output-store.ts), with a PNG still of a GIF or SVG.
      const stored = await storeFormattedImages({
        sourceUrls: [result.url, ...(result.extraUrls ?? [])],
        jobId,
        userId: job.user_id ?? undefined,
        watermark,
      })
      ledger.add(...stored.urls, ...(stored.thumbnailUrl !== undefined ? [stored.thumbnailUrl] : []))
      outputData = {
        ...buildImageOutputData(result as Parameters<typeof buildImageOutputData>[0], stored.urls),
        imageMimeType: stored.mimeType,
        ...(stored.thumbnailUrl !== undefined && { thumbnailUrl: stored.thumbnailUrl }),
      }
    } else if (IMAGE_TYPES.has(jobType)) {
      const r2Urls = await storeWithAttempts(attempts, () => uploadImageVariantsMaybeWatermark(
        [result.url, ...(result.extraUrls ?? [])],
        jobId,
        job.user_id ?? undefined,
        watermark,
      ))
      ledger.add(...r2Urls)
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
      if (input.mediaUrl === undefined) ledger.add(r2Url)
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
      if (input.mediaUrl === undefined) ledger.add(r2Url)
      outputData = { audioUrl: r2Url }
    } else {
      throw new Error(`[job-finalize] unknown jobType: ${jobType}`)
    }
    // The result's stored URL, as written to output_data above — what a
    // caller's extra fields may name (each layer's data names its base).
    const resultUrl = String(outputData.imageUrl ?? outputData.videoUrl ?? outputData.audioUrl)
    // Extra images beside the result (an image job only — refused above
    // otherwise): stored inside the claim, so a failure releases it below.
    const sets = input.extraImageSets ?? []
    if (sets.length > 0) {
      const extras = await storeExtraImageSets(sets, jobId, job.user_id ?? undefined, watermark, attempts, ledger.add)
      storedExtras = extras.stored
      droppedExtras = extras.dropped
      const library = libraryImagesOf(sets, storedExtras, droppedExtras)
      outputData = { ...outputData, ...storedExtras, ...(library.length > 0 ? { libraryImages: library } : {}) }
    }
    // The caller's extra fields — inside the claim too: a function handed the
    // stored URLs runs the caller's code, and a throw there must release the
    // claim like a failed upload, not leave the job waiting out its lifetime.
    if (input.extraOutputData) {
      const extra = typeof input.extraOutputData === "function" ? input.extraOutputData(storedExtras, droppedExtras, resultUrl) : input.extraOutputData
      outputData = { ...outputData, ...extra }
    }
    meteredBaseCredits = typeof input.meteredBaseCredits === "function"
      ? await input.meteredBaseCredits(storedExtras, droppedExtras)
      : input.meteredBaseCredits
  } catch (err) {
    // Failed media step. On a row that already went terminal without a
    // completion (cancelled or failed while we stored), nothing will ever name
    // what this finalize stored: delete it and give its bytes back. On a LIVE
    // row leave it — a finalizer that took the row over may complete it naming
    // the same keys; a retry re-stores them. Then release our claim so a
    // BullMQ retry or the next reconcile tick can re-attempt immediately, and
    // surface the error unchanged (refund classification stays the caller's).
    if (claim.ts) {
      const fenced = await discardUnfinishedStores(jobId, job.user_id ?? undefined, ledger.urls(), claim.ts, DISCARD_STATUSES)
      await releaseJobFinalizeClaim(jobId, fenced ?? claim.ts)
    }
    throw err
  }

  // 3b. A length-following video generation run (its model offers an
  //    automatic length, and it went out at one or declared a reference task
  //    type) records the length its video really is, at most the run's upper
  //    bound, so the step after it is charged by that (Trim, Loop, Combine
  //    Videos — the run reads `durationSec` first). Before the completion
  //    write, so a held completion's approve replays it too. A failed probe
  //    records nothing; every other job is neither probed nor changed.
  const lengthBoundSec = videoR2Url !== undefined ? recordedLengthBoundSec(job.job_type, jobType, job.input_data) : undefined
  if (lengthBoundSec !== undefined && videoR2Url !== undefined) {
    const durationSec = await recordedVideoLengthSec({ boundSec: lengthBoundSec, measuredSec: input.deliveredVideoSec, videoUrl: videoR2Url, jobId })
    if (durationSec !== undefined) outputData = { ...outputData, durationSec }
  }

  // 4. CAS-guarded markJobCompleted (live statuses only). Null provider /
  //    cost fields are OMITTED, not written: the reconcile path passes
  //    cost:null + providerUsed:null ("actual cost unknown post-reconcile"),
  //    and writing those NULLs clobbered whatever the worker/route had
  //    already recorded — every cron-completed job lost its provider
  //    metadata (admin data-quality residual from the 2026-06-10 audit).
  // The settlement inputs, built ONCE: parked on a HELD row for approve to
  // replay, and mapped onto commitJobCredits below through the same
  // `heldCommitArgs` approve uses — so the two settlements cannot drift.
  const commitReplay: HeldCommitReplay = {
    metered: result.meteredCost,
    extraNonProviderCredits: input.extraNonProviderCredits,
    meteredCost: result.cost,
    loopTrimAddonRefundCredits: input.loopTrimAddonRefundCredits,
    // A handler's own measure wins; a GPT Image 2.6 Auto run settles on KIE's bill.
    meteredBaseCredits: meteredBaseCredits ?? await gptImage26AutoSettledBase(result.autoQualityKieCredits),
  }
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
    commitReplay,
  )
  if (outcome !== "completed") {
    // A HELD row is not terminal: release OUR finalize claim so the approve
    // path (and any later re-pick) sees a clean row instead of waiting out
    // FINALIZE_CLAIM_TTL_MS. Its objects stay: they are what the reviewer
    // looks at.
    // A gate that answers "held" may have missed its own compare-and-set: the
    // row went cancelled while the verdict was being applied, and then nothing
    // holds — or will ever name — what we stored. The fence tells the two
    // apart in the database (it never matches pending_review), so a real hold
    // keeps its objects and a missed one deletes and gives them back.
    if (outcome === "held" && claim.ts) {
      const fenced = await discardUnfinishedStores(jobId, job.user_id ?? undefined, ledger.urls(), claim.ts, DISCARD_STATUSES)
      await releaseJobFinalizeClaim(jobId, fenced ?? claim.ts)
    }
    // A block the gate APPLIED already deleted every owned object and gave the
    // bytes back (its row is failed with the policy's hint). A block that
    // missed its compare-and-set (the row went cancelled first) deleted
    // nothing: the cancelled row is fenced and discarded here. Only a
    // cancelled row — a failed one is the applied block itself.
    if (outcome === "blocked" && claim.ts) {
      const fenced = await discardUnfinishedStores(jobId, job.user_id ?? undefined, ledger.urls(), claim.ts, DISCARD_AFTER_MISSED_BLOCK)
      if (fenced) await releaseJobFinalizeClaim(jobId, fenced)
    }
    // A lost completion is a row that went terminal while we stored: a cancel
    // (or a failure) — then nothing will ever name what we stored, so it is
    // deleted and given back — or another finalizer's completion, which names
    // the SAME keys and must keep them (incident 2026-06-10). The fence tells
    // the two apart in the database: it matches a cancelled or failed row
    // that still carries our claim, never a completed or held one.
    if (outcome === "lost_race" && claim.ts) {
      const fenced = await discardUnfinishedStores(jobId, job.user_id ?? undefined, ledger.urls(), claim.ts, DISCARD_STATUSES)
      if (fenced) await releaseJobFinalizeClaim(jobId, fenced)
    }
    return { ok: false, reason: outcome }
  }

  // 5. Commit credits (idempotent: CAS on usage_logs.status='reserved' inside
  //    both branches; null usageLogId is a graceful no-op). When a loop-trim
  //    addon must come off (reconcile-recovered raw i2v clip, single-node
  //    reservation only), commit at (reserved − addon) via refundLoopTrimAddon
  //    INSTEAD of the plain commit — deliberately here, AFTER the CAS win,
  //    so a failed finalize never strands the log outside `reserved` (which
  //    silently defeated the exhaustion refund — audit P0.3).
  //    A metered charge (`meteredBaseCredits`) takes the plain commit instead:
  //    it already prices exactly what was delivered, add-on included only when
  //    it was — and `heldCommitArgs` is the one mapping approve replays too.
  const loopTrimRefund = input.loopTrimAddonRefundCredits ?? 0
  if (commitReplay.meteredBaseCredits == null && loopTrimRefund > 0 && !job.workflow_execution_id) {
    await refundLoopTrimAddon(jobId, usageLogId, loopTrimRefund)
  } else {
    await commitJobCredits(usageLogId, jobId, ...heldCommitArgs(commitReplay, result.cost))
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
