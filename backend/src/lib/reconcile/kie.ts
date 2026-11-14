import { variantJobId } from "@nodaro/shared/workflow"
import { SEEDANCE_DRAFT_FINALIZE_PROVIDER, isSeedanceDraftCapable } from "@nodaro/shared/model-catalog"
import { supabase } from "../supabase.js"
import { markJobFailed } from "../job-failure.js"
import { uploadToR2 } from "../storage.js"
import { providerDetailOf, logProviderFailure } from "../provider-error-detail.js"
import { userFacingMessage } from "../user-facing-error.js"
import { isDrainAbortError } from "../worker-drain.js"
import type { UnitRecover } from "../../nodes/kit.js"
import { unitRecoverOf } from "./unit-recovery.js"
import {
  safetyBlockOf,
  inputVideoRefusedOf,
  inputImageRefusedOf,
  promptRefusedOf,
  audioRefusedOf,
  requestRefusedHintOf,
  sentVideoInput,
  refusalHintFor,
  jobModelIdOf,
  type ErrorHint,
} from "../safety-block.js"
import {
  pollKieTask,
  pollVeoTask,
  runVeo1080pTask,
  isUpstreamKieFailure,
  type KieResultJson,
} from "../../providers/kie/client.js"
import { pollKling3Task } from "../../providers/kie/kling3-client.js"
import { pollKontextTask } from "../../providers/kie/kontext-client.js"
import { pollLumaTask } from "../../providers/kie/luma-client.js"
import { pollRunwayTask, pollAlephTask } from "../../providers/kie/runway-client.js"
import { pollSunoTask, type SunoTaskResult } from "../../providers/kie/suno-client.js"
import {
  finalizeJobWithMedia,
  isFinalizeJobType,
  NOT_GENERIC_RECOVERABLE,
  loadUsageLogId,
  type FinalizeClaimant,
} from "../job-finalize.js"
import { markJobCompleted } from "../../workers/shared.js"
import { nemotronOutputFromResult } from "../../providers/kie/nemotron-transcribe.js"
import { settleNemotronTranscribe } from "../nemotron-transcribe-settle.js"
import { loopTrimAddonForReconcile } from "./loop-trim-refund.js"
import { measureSeedance2Settle } from "../seedance2-ref-video-settle.js"
import { gptImage26AutoSettledBase } from "../gpt-image-2-6-settle.js"
import { kieTaskCreditsConsumed } from "../../providers/kie/image-cost.js"
import { isGptImage26AutoRun } from "@nodaro/shared/model-catalog"
import { measureSeedanceDraftRenderSec, draftRenderOutputData } from "../seedance-draft-finalize.js"
import { readDraftAudioMux, draftAudioMuxOutputData } from "../seedance-draft-audio.js"
import { applyDraftAudioMux, draftAudioWarningOutputData, type DraftAudioMuxResult } from "../seedance-draft-audio-apply.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { bumpAttemptsOrExhaust } from "./bump-attempts.js"
import { recoveredMaskComposite } from "./mask-paste-back.js"
import { isEntityMediaJobType, recoverEntityJob } from "./entity-recovery.js"
import { resubmitSeedanceEdit } from "./seedance-edit-resubmit.js"
import { requestedAspectRatioOf } from "../../providers/kie/aspect-ratio-sentence.js"
import { geminiSpeechJobOf, recoverGeminiSpeechJob } from "../gemini-speech.js"

export interface KieJobRow {
  id: string
  provider_kind: string | null
  provider_task_id: string | null
  reconcile_attempts: number
  job_type: string | null
  input_data?: Record<string, unknown> | null
}

/** Caller identity for the finalize claim (audit H1). The cron omits it
 *  (default "cron"); the worker's stall re-pick passes "worker" via
 *  tryInlineReconcile so it can re-claim its crashed predecessor's claim. */
export interface ReconcileOpts {
  claimant?: FinalizeClaimant
  /** Poll attempt budget for the upstream probe. Defaults to 1 (the cron's
   *  one-shot probe). The worker's stall re-pick (inline reconcile) passes a
   *  full budget so a job re-picked while the provider is STILL RUNNING
   *  resumes polling to completion inside the live BullMQ handler, instead of
   *  burning one probe and parking the row for the cron's staleness threshold
   *  (incident 2026-07-15: 15–20 min user-visible stalls). Honored by the
   *  kinds whose pollers take an attempt budget (kie-standard, kie-lip-sync,
   *  kie-kontext, kie-luma); the rest keep their existing one-shot semantics. */
  pollAttempts?: number
}

/** Suno music job_types whose poll shape matches `SunoTaskResult` (multi-track
 *  audio). Other Suno operations (lyrics, separate, music-video, wav) use
 *  different poll endpoints + return shapes; bumped via the shared cap helper
 *  and force-failed at attempt 18 if still stuck. */
const SUNO_MUSIC_JOB_TYPES: ReadonlySet<string> = new Set([
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-upload-extend",
])

/** A Seedance DRAFT generation row (not its finalize). */
function isDraftGeneration(input: Record<string, unknown>): boolean {
  return input.draft === true && isSeedanceDraftCapable(typeof input.provider === "string" ? input.provider : undefined)
}

/**
 * The delivered clip (and any audio warning) of a recovered Seedance draft
 * finalize that carries an audio mux to re-apply; undefined for every other
 * row (finalize then uploads the raw result as usual).
 */
async function draftFinalizeMedia(
  row: KieJobRow,
  input: Record<string, unknown>,
  resultUrl: string,
): Promise<DraftAudioMuxResult | undefined> {
  if (row.job_type !== "video-upscale" || input.provider !== SEEDANCE_DRAFT_FINALIZE_PROVIDER) return undefined
  const mux = readDraftAudioMux(input.draftAudioMux)
  if (!mux) return undefined
  const { data } = await supabase.from("jobs").select("user_id, should_watermark").eq("id", row.id).single()
  const job = (data ?? {}) as { user_id?: string | null; should_watermark?: boolean | null }
  return applyDraftAudioMux({
    videoUrl: resultUrl,
    mux,
    draftVideoUrl: typeof input.draftVideoUrl === "string" ? input.draftVideoUrl : undefined,
    jobId: row.id,
    userId: job.user_id ?? undefined,
    watermark: job.should_watermark ?? false,
  })
}

/**
 * The KIE credits to settle a recovered GPT Image 2.6 Auto run on, as the worker
 * would have. Any other run: undefined. An Auto run whose record has no figure
 * commits its reservation, the Max price, so that is said out loud.
 */
function autoQualityCreditsOf(row: KieJobRow, kieCredits: number | undefined): number | undefined {
  const input = row.input_data ?? {}
  if (!isGptImage26AutoRun(input.provider, input.quality)) return undefined
  if (kieCredits === undefined) {
    console.error(`[ALERT] job ${row.id} (${String(input.provider)} at quality auto): KIE's task record has no credits figure, so it commits its reservation (the Max price).`)
  }
  return kieCredits
}

/** The kinds polled on KIE's standard `/jobs/recordInfo` endpoint, whose finished task carries a whole `resultJson`. */
const RECORD_INFO_KINDS: ReadonlySet<string> = new Set(["kie-standard", "kie-seedance-draft", "kie-lip-sync"])

/**
 * One read of a record-info task (Kling avatar / InfiniTalk use it too): its
 * whole parsed `resultJson`, and what it took and cost. Throws, as the poll
 * does, while the task is still running or when it failed upstream. The job's
 * own settings name the ratio the person chose, for the sentence if the model
 * refused it.
 */
async function readRecordInfoTask(row: KieJobRow, pollAttempts: number): Promise<{
  result: KieResultJson
  providerMs?: number
  kieCredits?: number
}> {
  if (!row.provider_task_id) throw new Error("no provider_task_id")
  if (!RECORD_INFO_KINDS.has(row.provider_kind ?? "")) throw new Error(`not a record-info task: ${row.provider_kind}`)
  const r = await pollKieTask(row.provider_task_id, pollAttempts, undefined, { requestedAspectRatio: requestedAspectRatioOf(row.input_data) })
  return { result: r.resultJson, providerMs: r.providerMs, kieCredits: kieTaskCreditsConsumed(r.rawRecordInfo) }
}

/** Single-attempt poll dispatcher. Returns the recovered URL(s) on success;
 *  throws when the upstream task is still running OR has terminally failed.
 *  Caller distinguishes terminal failure via `isUpstreamKieFailure(err)` (the
 *  structured flag) vs transient (timeout/network → bump). */
async function singlePoll(row: KieJobRow, pollAttempts = 1): Promise<{
  url: string
  extraUrls: readonly string[]
  providerMs?: number
  /** What the task really used, where the poll reads the task record. */
  kieCredits?: number
}> {
  if (!row.provider_task_id) throw new Error("no provider_task_id")
  const id = row.provider_task_id

  switch (row.provider_kind) {
    case "kie-standard":
    case "kie-seedance-draft":
    case "kie-lip-sync": {
      const r = await readRecordInfoTask(row, pollAttempts)
      const urls = r.result.resultUrls ?? (
        r.result.videoUrl ? [r.result.videoUrl]
        : r.result.audioUrl ? [r.result.audioUrl]
        : []
      )
      if (!urls[0]) throw new Error("KIE success but no result URL")
      return { url: urls[0]!, extraUrls: urls.slice(1), providerMs: r.providerMs, kieCredits: r.kieCredits }
    }
    case "kie-veo": {
      const r = await pollVeoTask(id, "VEO")
      const urls = r.resultUrls
      if (!urls?.[0]) throw new Error("VEO success but no resultUrls")
      return { url: urls[0]!, extraUrls: urls.slice(1), providerMs: r.providerMs }
    }
    case "kie-veo-1080p": {
      // Quasi-sync GET /api/v1/veo/get-1080p-video with the PARENT kieTaskId
      // (the 1080p endpoint reuses the original VEO task's id; there is no
      // separate 1080p task). One-shot poll — `runVeo1080pTask` itself retries
      // internally if still processing, but for the reconcile path we just
      // attempt once and let `bumpAttemptsOrExhaust` re-fire on the next tick.
      const r = await runVeo1080pTask(id)
      return { url: r.url, extraUrls: [] }
    }
    case "kie-kling3": {
      const videoUrl = await pollKling3Task(id)
      return { url: videoUrl, extraUrls: [] }
    }
    case "kie-kontext": {
      const r = await pollKontextTask(id, pollAttempts)
      const urls = r.resultJson.resultUrls ?? []
      if (!urls[0]) throw new Error("Kontext success but no resultUrls")
      return { url: urls[0]!, extraUrls: urls.slice(1) }
    }
    case "kie-luma": {
      const r = await pollLumaTask(id, pollAttempts)
      const urls = r.resultJson.resultUrls ?? []
      if (!urls[0]) throw new Error("Luma success but no resultUrls")
      return { url: urls[0]!, extraUrls: urls.slice(1) }
    }
    case "kie-runway": {
      const videoUrl = await pollRunwayTask(id, "Runway")
      return { url: videoUrl, extraUrls: [] }
    }
    case "kie-aleph": {
      // Runway Aleph (v2v) uses `/api/v1/aleph/record-info` — DIFFERENT
      // endpoint from `kie-runway` (`/api/v1/runway/record-detail`). Wiring
      // through `kie-standard` (the old default) sent reconcile to the wrong
      // endpoint and force-failed every Aleph row after 18 attempts.
      const videoUrl = await pollAlephTask(id)
      return { url: videoUrl, extraUrls: [] }
    }
    case "kie-suno": {
      // Suno reconcile is handled via reconcileKieSunoJob (multi-track output).
      // singlePoll is only used for single-URL kinds; this path is unreachable
      // because the caller branches on kie-suno before reaching singlePoll.
      throw new Error("kie-suno should be handled by reconcileKieSunoJob")
    }
    default:
      throw new Error(`unknown KIE provider_kind: ${row.provider_kind}`)
  }
}

/**
 * Suno-specific reconcile: poll the music task, upload all tracks to R2 under
 * variant-suffixed keys, then call finalize with `mediaUrl` = primary track
 * and `extraOutputData` carrying the full multi-track metadata. This preserves
 * the same output_data shape the worker handler writes via uploadAllSunoTracks.
 */
async function reconcileKieSunoJob(row: KieJobRow, opts?: ReconcileOpts): Promise<void> {
  if (!row.provider_task_id) return
  if (!row.job_type || !SUNO_MUSIC_JOB_TYPES.has(row.job_type)) {
    // Suno variant we don't recover (lyrics, separate, music-video, wav).
    await bumpAttemptsOrExhaust(row.id, `suno variant not recoverable: ${row.job_type}`)
    return
  }

  // Get user_id for the R2 upload key (variantJobId paths land under the user's
  // namespace).
  const { data: jobUser } = await supabase
    .from("jobs")
    .select("user_id")
    .eq("id", row.id)
    .single()
  const userId = (jobUser as { user_id?: string } | null)?.user_id ?? undefined

  let result: SunoTaskResult
  try {
    result = await pollSunoTask(row.provider_task_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Same shared classifier as reconcileKieJob — pollSunoTask sets the flag via
    // createUpstreamFailureError, so a terminal Suno failure fails fast + refunds
    // instead of riding to the 18-attempt exhaustion (the old msg.includes match
    // never matched the sanitized message).
    if (isUpstreamKieFailure(err)) {
      await markFailed(row.id, msg, providerDetailOf(err), refusalHintOf(err, row))
      await refundReservedCreditsForJob(row.id)
    } else {
      await bumpAttemptsOrExhaust(row.id, err)
    }
    return
  }

  const validTracks = result.tracks.filter((t) => t.audioUrl)
  if (validTracks.length === 0) {
    await markFailed(row.id, "Suno returned no tracks")
    await refundReservedCreditsForJob(row.id)
    return
  }

  // P0.1 (audit Blocker B1): uploads + finalize must bump on failure — same
  // rationale as reconcileKieJob's post-poll wrap (deterministic failures
  // must exhaust to refund+anomaly, never loop forever).
  try {
    // Upload each track to R2 under variant-suffixed keys (matches the worker
    // handler's uploadAllSunoTracks).
    const r2Urls = await Promise.all(
      validTracks.map((t, i) =>
        uploadToR2(t.audioUrl, variantJobId(row.id, i), "audio", userId),
      ),
    )
    const primary = validTracks[0]!

    await finalizeJobWithMedia({
      jobId: row.id,
      jobType: "generate-music",
      claimant: opts?.claimant ?? "cron",
      // "kie", not "suno": the jobs.provider vocabulary names the SERVING
      // provider (the registry ids + "elevenlabs-direct"), and this path
      // only ever recovers KIE-keyed runs — it polls KIE's task API with the
      // instance's own key. "suno" named the model vendor and split Suno
      // attribution three ways ("kie"/"nodaro"/"suno") depending on which
      // machinery completed the job (#753 review).
      result: { url: r2Urls[0]!, cost: null, providerUsed: "kie" },
      mediaUrl: r2Urls[0]!,
      extraOutputData: {
        ...(r2Urls.length > 1 ? { audioUrls: r2Urls } : {}),
        sunoTrackId: primary.id,
        sunoTitle: primary.title,
        sunoDuration: primary.duration,
        sunoImageUrl: primary.imageUrl,
        sunoTaskId: result.taskId,
        sunoTracks: validTracks.map((t, i) => ({
          id: t.id,
          title: t.title,
          duration: t.duration,
          imageUrl: t.imageUrl,
          audioUrl: r2Urls[i]!,
        })),
        trackCount: validTracks.length,
      },
    })
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err)
  }
}

/** The `error_hint` the worker would have written for this terminal failure
 *  (`refusalHintFor`, the one shared mapping): a job re-picked after a worker
 *  restart is failed HERE instead of in the worker's catch, and a caller that
 *  acts on the hint (offer the fallback model, send a different clip) must see
 *  the same verdict either way. The thrown poll error carries the provider's
 *  classification (`contentPolicyClass` / `inputVideoRefused`, decided on its
 *  bare failMsg by the poll client; `requestRefused`, on its status); the job's `input_data` is the request it
 *  was enqueued with, so it answers the worker's model + "sent a video" reads.
 *  `retried` is false: the re-picked job never ran the worker's inline retry. */
function refusalHintOf(err: unknown, row: KieJobRow): ErrorHint | null {
  const input = row.input_data ?? null
  return refusalHintFor(
    safetyBlockOf(err, jobModelIdOf(input)),
    false,
    inputVideoRefusedOf(err) && sentVideoInput(input),
    inputImageRefusedOf(err),
    requestRefusedHintOf(err, input),
    promptRefusedOf(err),
    audioRefusedOf(err),
  )
}

/** True when THIS write flipped the row failed (`markJobFailed`'s answer). */
async function markFailed(
  jobId: string,
  reason: string,
  detail: string | null = null,
  hint: ErrorHint | null = null,
  /** What `reconcile_last_error` records: the upstream task failed, or (a unit's recovery) its result could not be delivered. */
  lastError: "upstream_failed" | "delivery_failed" = "upstream_failed",
): Promise<boolean> {
  // Log BEFORE the write: this module had no per-job output at all, so a
  // cron-failed job was invisible in Railway (spec §11.3).
  logProviderFailure("reconcile/kie", jobId, reason, detail)
  // The CAS lives in markJobFailed now (FAILABLE_STATUSES): never trample a job
  // a concurrent writer flipped to completed/cancelled, and never take a
  // `pending_review` row — a held job is out of every reconcile sweep's reach
  // by construction (spec D11).
  return markJobFailed(jobId, {
    error_message: reason,
    error_detail: detail,
    reconcile_last_error: lastError,
    ...(hint ? { error_hint: hint } : {}),
  })
}

/**
 * A poll that threw. A task that failed upstream (`isUpstreamKieFailure`, the
 * structured flag — never the message text: KieError.message is sanitized, so
 * a string match silently missed every terminal failure and bumped it toward
 * the 18-attempt / 90-min exhaustion) fails fast + refunds; ALL KIE poll
 * clients set the flag (createUpstreamFailureError), so every provider fails
 * fast here. A task still running, a transient read failure or an unsupported
 * kind bumps, and the next tick looks again.
 */
async function failOrBumpPolled(row: KieJobRow, err: unknown, opts?: ReconcileOpts): Promise<void> {
  if (isUpstreamKieFailure(err)) {
    const msg = err instanceof Error ? err.message : String(err)
    // The worker's one retry on this rejection died with the worker: it is done here instead.
    const resubmit = await resubmitSeedanceEdit(row, err)
    if (resubmit.outcome === "taken") return
    if (resubmit.outcome === "resent") {
      return reconcileKieJob({ ...row, provider_task_id: resubmit.taskId, reconcile_attempts: 0 }, opts)
    }
    await markFailed(row.id, msg, providerDetailOf(err), refusalHintOf(err, row))
    await refundReservedCreditsForJob(row.id)
  } else {
    // still pending / transient / unsupported kind — try again next tick
    await bumpAttemptsOrExhaust(row.id, err)
  }
}

/**
 * Recover an own-writer node unit's job (its `recover.ts`, through
 * unit-recovery.ts): read its record-info task's WHOLE result — the unit's own
 * parser decides what it holds, so no URL is required of it here — and hand it
 * to the unit's recovery, the same delivery its worker runs after the provider
 * call (finalize included: claim, store, commit on what was stored).
 *
 *   - the poll threw: the shared failure path (`failOrBumpPolled`) — a task
 *     that failed upstream fails fast + refunds on this tick, a running one
 *     bumps; a unit row on a kind that is not record-info bumps toward the
 *     exhaustion (refund) like any unrecoverable row;
 *   - the delivery threw (its result unreadable, no base, a base that could not
 *     be stored after its attempts): the task is done and its result will not
 *     change, so the job fails and is REFUNDED now — the same funnel as an
 *     upstream failure, never the 18-tick bump. Refunded only when THIS write
 *     flipped the row: a delivery that completed the job before it threw keeps
 *     its charge. A drain (the worker's re-pick during a deploy) is rethrown:
 *     the replacement process re-picks the job;
 *   - the delivery's `{ ok: false }` (another finalizer won, or a held or
 *     blocked result) is not a failure.
 */
async function reconcileKieUnitJob(row: KieJobRow, recover: UnitRecover, opts?: ReconcileOpts): Promise<void> {
  let task: Awaited<ReturnType<typeof readRecordInfoTask>>
  try {
    task = await readRecordInfoTask(row, opts?.pollAttempts ?? 1)
  } catch (err) {
    return failOrBumpPolled(row, err, opts)
  }
  try {
    await recover({
      jobId: row.id,
      input: row.input_data ?? {},
      taskId: row.provider_task_id!,
      providerKind: row.provider_kind!,
      result: task.result,
      ...(task.kieCredits !== undefined ? { providerCredits: task.kieCredits } : {}),
      ...(task.providerMs !== undefined ? { providerMs: task.providerMs } : {}),
      claimant: opts?.claimant ?? "cron",
    })
  } catch (err) {
    if (isDrainAbortError(err)) throw err
    // The words the worker's own failure path writes for the same error (video-worker.ts).
    const message = userFacingMessage(err, "The result could not be delivered.")
    const flipped = await markFailed(row.id, message, providerDetailOf(err), null, "delivery_failed")
    if (flipped) await refundReservedCreditsForJob(row.id)
  }
}

/**
 * Recover a Nemotron 3.5 Transcribe job (the transcribe worker saves its KIE
 * task id under `kie-standard`): read the task's whole result and write the
 * SAME `output_data` the worker writes (`nemotronOutputFromResult` — never
 * finalize, which would treat the transcript as media), then settle exactly as
 * the worker does — at the minutes KIE decoded, up or down, in one commit
 * (`settleNemotronTranscribe`) — recording what KIE billed as `provider_cost`.
 *
 *   - the poll threw: the shared failure path (`failOrBumpPolled`) — a task
 *     that failed upstream fails fast + refunds, a running one bumps;
 *   - the result could not be mapped (word timings asked and not delivered —
 *     the worker's own contract — or no resultObject): the task is done and
 *     will not change, so the job fails and is refunded now, never the 18-tick
 *     bump. Refunded only when THIS write flipped the row.
 */
async function reconcileKieTranscribeJob(row: KieJobRow, opts?: ReconcileOpts): Promise<void> {
  let task: Awaited<ReturnType<typeof readRecordInfoTask>>
  try {
    task = await readRecordInfoTask(row, opts?.pollAttempts ?? 1)
  } catch (err) {
    return failOrBumpPolled(row, err, opts)
  }
  const input = (row.input_data ?? {}) as Record<string, unknown>
  const measuredSec = typeof input.duration_seconds === "number" ? input.duration_seconds : undefined
  let output: Awaited<ReturnType<typeof nemotronOutputFromResult>>
  try {
    output = await nemotronOutputFromResult(task.result, {
      wordTimestamps: input.wordTimestamps === true,
      targetLanguage: typeof input.targetLanguage === "string" && input.targetLanguage ? input.targetLanguage : undefined,
      fallbackDurationSec: measuredSec,
      ...(task.kieCredits !== undefined ? { kieCredits: task.kieCredits } : {}),
    })
  } catch (err) {
    if (isDrainAbortError(err)) throw err
    const message = userFacingMessage(err, "The provider returned a transcript we could not read. Your credits were refunded.")
    const flipped = await markFailed(row.id, message, providerDetailOf(err), null, "delivery_failed")
    if (flipped) await refundReservedCreditsForJob(row.id)
    return
  }
  const outputData: Record<string, unknown> = { text: output.text, language: output.language, json: output.json }
  if (output.segments) outputData.segments = output.segments
  if (output.words) outputData.words = output.words
  if (output.truncated) outputData.truncated = true
  const ok = await markJobCompleted(row.id, {
    output_data: outputData,
    ...(output.cost !== undefined ? { provider_cost: output.cost } : {}),
  })
  if (!ok) return
  await settleNemotronTranscribe({
    usageLogId: await loadUsageLogId(row.id),
    jobId: row.id,
    heldId: typeof input.bucketKey === "string" ? input.bucketKey : undefined,
    measuredSec,
    kieSec: output.durationSec,
    kieCredits: task.kieCredits,
  })
}

/**
 * Reconcile a stuck KIE job. Polls the upstream task once via the right
 * `pollX` for the row's `provider_kind`, then:
 *   - on success: forwards the result URLs to `finalizeJobWithMedia` so
 *     output_data gets written, credits commit, asset row created, workflow
 *     execution reopens if sole-cause.
 *   - on upstream failure (`isUpstreamKieFailure(err)`): marks the job
 *     failed + refunds reserved credits.
 *   - on transient (still running, network blip): bumps `reconcile_attempts`
 *     and leaves the row in place for the next cron tick.
 * An own-writer node unit with a recovery delivers through its own delivery
 * instead (`reconcileKieUnitJob`).
 */
export async function reconcileKieJob(row: KieJobRow, opts?: ReconcileOpts): Promise<void> {
  if (!row.provider_task_id) return

  // Suno is a special case: multi-track output, dedicated upload + finalize path.
  if (row.provider_kind === "kie-suno") {
    return reconcileKieSunoJob(row, opts)
  }

  // An own-writer node unit with a recovery (its recover.ts) is finished from
  // its task's whole result through its OWN delivery — still after a poll, so a
  // genuinely failed task fails fast + refunds here too (M-4a below) — and so
  // never reaches the NOT_GENERIC_RECOVERABLE bump it is listed in.
  const unitRecover = unitRecoverOf(row.job_type)
  if (unitRecover) return reconcileKieUnitJob(row, unitRecover, opts)

  // A transcription's result is text, not media: recovered through the worker's
  // own mapping (only Nemotron saves a KIE task id on this job type), and never
  // through the NOT_GENERIC_RECOVERABLE bump it is listed in.
  if (row.job_type === "transcribe") return reconcileKieTranscribeJob(row, opts)

  let result: Awaited<ReturnType<typeof singlePoll>>
  try {
    result = await singlePoll(row, opts?.pollAttempts ?? 1)
  } catch (err) {
    return failOrBumpPolled(row, err, opts)
  }

  // Entity studios (Character / Face / Object / Creature / Location — images,
  // asset variants, motion clips) are their own completion writers, so they
  // cannot take the generic finalize below. They are NOT unrecoverable: the
  // worker's completion tail is shared code (`lib/entity-finalize.ts`) and this
  // lane runs it with the attach spec read off `jobs.input_data`. Before this,
  // a finished provider result was discarded here and refunded ~90 min later.
  if (isEntityMediaJobType(row.job_type)) {
    try {
      await recoverEntityJob({
        jobId: row.id,
        jobType: row.job_type,
        url: result.url,
        claimant: opts?.claimant ?? "cron",
        autoQualityKieCredits: autoQualityCreditsOf(row, result.kieCredits),
      })
    } catch (err) {
      await bumpAttemptsOrExhaust(row.id, err)
    }
    return
  }

  // Types with their own completion writer, and unknown/NULL types, must not
  // reach finalize (an own-writer unit WITH a recovery was routed to its own
  // delivery above). DELIBERATELY AFTER the poll (M-4a): the catch above
  // (`failOrBumpPolled`) fails-fast + refunds a genuinely-failed task on tick 1, and skipping the
  // poll to "save a provider call" would instead ride all 18 reconcile ticks
  // (~90 min of a stuck `processing` row) because the bump reason below
  // matches no DETERMINISTIC_RECONCILE_ERRORS pattern. Same bump-with-reason
  // shape as reconcileKieSunoJob's variant guard (:148-152).
  if (NOT_GENERIC_RECOVERABLE.has(row.job_type ?? "")) {
    await bumpAttemptsOrExhaust(row.id, `not generically recoverable: ${row.job_type}`)
    return
  }
  if (!isFinalizeJobType(row.job_type)) {
    await bumpAttemptsOrExhaust(row.id, `unknown job_type for finalize: ${row.job_type ?? "null"}`)
    return
  }

  // A Gemini speech task is delivered through the worker's own path
  // (lib/gemini-speech.ts): its WAV made into the format asked for, with the
  // same billedCharacters, audioMimeType and cost — never the raw WAV the
  // generic finalize below would store.
  if (geminiSpeechJobOf(row)) {
    try {
      await recoverGeminiSpeechJob(row, result, opts?.claimant ?? "cron")
    } catch (err) {
      await bumpAttemptsOrExhaust(row.id, err)
    }
    return
  }

  // P0.1 (audit Blocker B1): the post-poll completion phase MUST bump
  // reconcile_attempts on failure. Without this, a poll-success-but-
  // finalize-failure propagated to the cron's per-row catch (errors++ only)
  // and a deterministic failure (size cap, bad transcode) looped at every
  // tick FOREVER — user charged, credits stranded `reserved`, no refund, no
  // anomaly. Bumping routes it into the 18-attempt exhaustion path
  // (forceFailExhausted → refund + credit_anomalies), which terminates.
  try {
    // i2v + loopTrim.enabled (single-node): the recovered RAW clip never got
    // the smart-loop-cut, so the addon comes OFF the commit. Computed here
    // (pure), applied by finalize AFTER markJobCompleted wins — committing it
    // up-front flipped the log out of `reserved` and defeated the exhaustion
    // refund when finalize kept failing (audit P0.3).
    const loopTrimAddon = loopTrimAddonForReconcile(row.job_type, row.input_data ?? null)

    // A Seedance reference-video run was reserved at a worst case (an edit
    // renders the source clip's length); the worker would have measured the
    // delivered clip, so the recovery does the same — otherwise a run whose
    // worker died would pay the whole worst case. `input_data` carries the
    // request (provider, resolution, the reference clips and the
    // reservation's probe of them); `undefined` = not such a run, or
    // unmeasurable → the reservation is committed as before.
    const input = (row.input_data ?? {}) as Record<string, unknown>
    const gptImageBase = await gptImage26AutoSettledBase(autoQualityCreditsOf(row, result.kieCredits))
    // One measurement of the recovered clip: the settlement's credits and, for
    // a run that records its length, that length (finalize records it from
    // this instead of probing the clip again).
    const settle = gptImageBase === undefined
      ? await measureSeedance2Settle({
        provider: typeof input.provider === "string" ? input.provider : undefined,
        resolution: typeof input.resolution === "string" ? input.resolution : undefined,
        outputUrl: result.url,
        referenceVideoUrls: input.referenceVideoUrls,
        refVideoDurationsSec: input.refVideoDurationsSec,
        characterReferences: input.characterReferences,
        duration: input.duration,
        // Recorded only when a type was declared: the hold the reservation sized.
        referenceTaskType: input.referenceTaskType,
        jobId: row.id,
      })
      : undefined
    const meteredBaseCredits = gptImageBase ?? settle?.baseCredits
    // A recovered clip is the RAW take, so a Seedance draft records its length
    // here exactly as the worker would (the 1080p finalize bills it).
    const draftRenderSec = await measureSeedanceDraftRenderSec({
      draft: input.draft,
      provider: typeof input.provider === "string" ? input.provider : undefined,
      outputUrl: result.url,
    })

    // A recovered Seedance draft FINALIZE re-applies the draft's post-render
    // audio mux exactly as the worker would (recipe stamped on the job).
    const finalizeMedia = await draftFinalizeMedia(row, input, result.url)
    const mediaUrl = finalizeMedia?.url
    // A recovered inpaint or masked edit gets the paste-back its worker runs
    // before finalize (REFUND-CRITICAL there too: a failure throws into the
    // catch below, never a redraw finalized as the result).
    const composite = await recoveredMaskComposite(row, result.url)

    // The measured clip is the one stored, unless a draft finalize re-muxed it.
    const deliveredVideoSec = mediaUrl === undefined ? settle?.deliveredSec : undefined
    await finalizeJobWithMedia({
      jobId: row.id,
      jobType: row.job_type,
      claimant: opts?.claimant ?? "cron",
      ...(mediaUrl !== undefined && { mediaUrl }),
      ...(loopTrimAddon > 0 && { loopTrimAddonRefundCredits: loopTrimAddon }),
      ...(meteredBaseCredits !== undefined && { meteredBaseCredits }),
      ...(deliveredVideoSec !== undefined && { deliveredVideoSec }),
      result: {
        url: composite?.url ?? result.url,
        ...(composite ? {} : { extraUrls: result.extraUrls }),
        cost: null,  // committed at reservation; actual cost is unknown post-reconcile
        providerUsed: null,
        providerMs: result.providerMs,
      },
      ...(composite?.extraOutputData && { extraOutputData: composite.extraOutputData }),
      ...(finalizeMedia?.warning && { extraOutputData: draftAudioWarningOutputData(finalizeMedia) }),
      // A recovered draft is the RAW clip: no audio merge / voice mux ran, so
      // it records the take length and `draftAudioMux: null` — what the stored
      // clip actually got (never left to the legacy inference).
      ...(isDraftGeneration(input) && {
        extraOutputData: {
          ...draftRenderOutputData(draftRenderSec),
          ...draftAudioMuxOutputData(input.draft, input.provider as string, undefined),
        },
      }),
    })
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err)
  }
}
