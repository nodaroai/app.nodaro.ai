import { config } from "../config.js"
import { supabase } from "../supabase.js"
import { finalizeJobWithMedia, isFinalizeJobType, NOT_GENERIC_RECOVERABLE, loadUsageLogId } from "../job-finalize.js"
import { redactProviderDetail, logProviderFailure } from "../provider-error-detail.js"
import type { ReconcileOpts } from "./kie.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { deleteCharacterLora } from "../../providers/replicate/training.js"
import { bumpAttemptsOrExhaust } from "./bump-attempts.js"
import { loopTrimAddonForReconcile } from "./loop-trim-refund.js"
import {
  mapWhisperOutput,
  mapFastWhisperOutput,
  type WhisperOutput,
  type FastWhisperOutput,
} from "../../providers/audio/transcribe-output.js"
import { markJobCompleted, commitJobCredits } from "../../workers/shared.js"

export interface ReplicateJobRow {
  id: string
  provider_kind: string | null
  provider_task_id: string | null
  reconcile_attempts: number
  job_type: string | null
  input_data?: Record<string, unknown> | null
}

interface ReplicatePrediction {
  id: string
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled"
  output?: string | string[] | null
  error?: string | null
  metrics?: { predict_time?: number }
}

interface ReplicateTraining {
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled"
  output?: { version?: string } | null
  version?: string
  error?: string | null
}

interface InflightCharacter {
  id: string
  user_id: string
  lora_training_replicate_id: string
  deleted_at: string | null
}

async function fetchReplicatePrediction(
  predictionId: string,
): Promise<ReplicatePrediction | null> {
  try {
    const res = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      { headers: { Authorization: `Bearer ${config.REPLICATE_API_TOKEN}` } },
    )
    if (!res.ok) {
      console.warn(`[reconcile/replicate] GET prediction ${predictionId} → ${res.status}`)
      return null
    }
    return (await res.json()) as ReplicatePrediction
  } catch (err) {
    console.warn(
      `[reconcile/replicate] fetch ${predictionId} threw: ${(err as Error).message}`,
    )
    return null
  }
}

async function fetchReplicateTraining(
  trainingId: string,
): Promise<ReplicateTraining | null> {
  try {
    const res = await fetch(
      `https://api.replicate.com/v1/trainings/${trainingId}`,
      { headers: { Authorization: `Bearer ${config.REPLICATE_API_TOKEN}` } },
    )
    if (!res.ok) {
      console.warn(`[reconcile/replicate] GET training ${trainingId} → ${res.status}`)
      return null
    }
    return (await res.json()) as ReplicateTraining
  } catch (err) {
    console.warn(
      `[reconcile/replicate] fetch training ${trainingId} threw: ${(err as Error).message}`,
    )
    return null
  }
}

/**
 * Find the `characters` row tied to a stuck Replicate training. The link is
 * `characters.lora_training_replicate_id = jobs.provider_task_id` (set when
 * the training was dispatched). Returns null when no matching character is
 * found (orphan job; caller bumps attempts).
 */
async function findCharacterForTraining(
  trainingId: string,
): Promise<InflightCharacter | null> {
  const { data } = await supabase
    .from("characters")
    .select("id, user_id, lora_training_replicate_id, deleted_at")
    .eq("lora_training_replicate_id", trainingId)
    .limit(1)
    .single()
  return (data as InflightCharacter | null) ?? null
}

/**
 * Apply a terminal Replicate training status to the linked character +
 * the originating job row. Mirrors the webhook handler's monotonic
 * state guards: `.not("status", "in", "(...)")` blocks regressions when
 * a later webhook delivery races us.
 */
async function applyTrainingTerminalStatus(
  jobId: string,
  character: InflightCharacter,
  remote: ReplicateTraining,
): Promise<void> {
  if (remote.status === "succeeded") {
    const versionStr = remote.version ?? remote.output?.version ?? null
    await supabase
      .from("characters")
      .update({
        lora_training_status: "succeeded",
        lora_replicate_version: versionStr,
        lora_trained_at: new Date().toISOString(),
        lora_training_error: null,
      })
      .eq("id", character.id)
      .eq("user_id", character.user_id)
      .not("lora_training_status", "in", "(succeeded,cancelled)")

    await supabase
      .from("jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", character.user_id)
      .not("status", "in", "(completed,failed,cancelled)")

    if (character.deleted_at) {
      // Soft-deleted between dispatch and reconciliation — clean up the
      // orphan Replicate model. Idempotent (404 swallowed).
      await deleteCharacterLora(`nodaroai/char-${character.id}`)
    }
  } else if (remote.status === "failed" || remote.status === "canceled") {
    const finalStatus = remote.status === "canceled" ? "cancelled" : "failed"
    // remote.error is raw provider text. Redact it once, then use the SAME
    // redacted text everywhere a training owner can read it: jobs.error_detail
    // (admin-only) AND characters.lora_training_error, which the owner reads
    // directly via GET /v1/character-training/:id/status (M-2b — never raw
    // provider text on a user-visible surface).
    const detail = redactProviderDetail(remote.error) ?? `upstream ${remote.status}`
    await supabase
      .from("characters")
      .update({
        lora_training_status: finalStatus,
        lora_training_error: detail,
      })
      .eq("id", character.id)
      .eq("user_id", character.user_id)
      .not("lora_training_status", "in", "(succeeded,cancelled)")

    await supabase
      .from("jobs")
      .update({
        status: finalStatus,
        error_message: finalStatus === "cancelled"
          ? "Character training was cancelled."
          : "Character training failed. Please try again.",
        error_detail: detail,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", character.user_id)
      .not("status", "in", "(completed,failed,cancelled)")
    await refundReservedCreditsForJob(jobId).catch(() => {})
  }
  // starting/processing → still in flight, caller bumps attempts
}

/**
 * `reason` is the USER-FACING string (it lands in `jobs.error_message`, which
 * `GET /v1/jobs/:id` and the app-report sweep both read). `detail` is the raw
 * provider text — redacted by the CALLER via `redactProviderDetail` /
 * `providerDetailOf` and written to the admin-only `jobs.error_detail` (W0,
 * migration 368). Never pass raw provider text as `reason`: that is exactly
 * how vendor stack traces and signed URLs reached job owners.
 *
 * Written UNCONDITIONALLY, matching `reconcile/kie.ts:244` — one shape for
 * one column (M-2b). `null` means "this writer had no provider text", and
 * recording that null is the honest answer.
 */
async function markFailed(jobId: string, reason: string, detail: string | null = null): Promise<void> {
  // Log BEFORE the write: this module had no per-job output at all, so a
  // cron-failed job was invisible in Railway (spec §11.3).
  logProviderFailure("reconcile/replicate", jobId, reason, detail)
  await supabase
    .from("jobs")
    .update({
      status: "failed",
      error_message: reason.slice(0, 500),
      error_detail: detail,
      completed_at: new Date().toISOString(),
      reconcile_last_error: "upstream_failed",
    })
    .eq("id", jobId)
    // CAS on the live (non-terminal) states only — a bare .neq("status","cancelled")
    // would still trample a job the worker concurrently flipped to "completed".
    // Matches kie.ts / sync-sweep.ts (the M6 fix); these two files were missed.
    .in("status", ["pending", "processing"])
}

/**
 * Reconcile a stuck Replicate job. Polls /v1/predictions/:id once, then:
 *   - status=succeeded → finalize with output URL(s)
 *   - status=failed|canceled → markFailed + refund
 *   - status=starting|processing → bumpAttemptsOrExhaust
 *
 * For `provider_kind="replicate-training"`, fetches the training via
 * `/v1/trainings/:id`, looks up the linked `characters` row, and applies
 * the same terminal-state updates the LoRA webhook handler would have.
 * Replaces the standalone reconcileOrphanedTrainings cron (deleted in P3.5).
 */
export async function reconcileReplicateJob(row: ReplicateJobRow, opts?: ReconcileOpts): Promise<void> {
  if (!row.provider_task_id) return

  if (row.provider_kind === "replicate-training") {
    const remote = await fetchReplicateTraining(row.provider_task_id)
    if (!remote) {
      await bumpAttemptsOrExhaust(row.id, "fetch training failed")
      return
    }
    if (remote.status === "starting" || remote.status === "processing") {
      await bumpAttemptsOrExhaust(row.id, `training still ${remote.status}`)
      return
    }
    // Terminal — find the character + apply the same updates the webhook
    // handler would have. Skip silently if no character is linked (orphan job).
    const character = await findCharacterForTraining(row.provider_task_id)
    if (!character) {
      await bumpAttemptsOrExhaust(row.id, "no character linked to training")
      return
    }
    // P0.1 (audit Blocker B1): terminal-status application must bump on
    // failure — an uncaught throw here only increments the cron's error
    // counter and the row retries identically forever.
    try {
      await applyTrainingTerminalStatus(row.id, character, remote)
    } catch (err) {
      await bumpAttemptsOrExhaust(row.id, err)
    }
    return
  }

  // replicate-prediction path
  const pred = await fetchReplicatePrediction(row.provider_task_id)
  if (!pred) {
    await bumpAttemptsOrExhaust(row.id, "fetch failed")
    return
  }

  if (pred.status === "starting" || pred.status === "processing") {
    await bumpAttemptsOrExhaust(row.id, `still ${pred.status}`)
    return
  }

  if (pred.status === "failed" || pred.status === "canceled") {
    await markFailed(
      row.id,
      pred.status === "canceled"
        ? "Generation was cancelled by the provider."
        : "Generation failed on the provider. Please try again.",
      // pred.error is raw provider text — redact it before it reaches
      // error_detail (M-2b); never pass it through as-is.
      redactProviderDetail(pred.error) ?? `upstream ${pred.status}`,
    )
    await refundReservedCreditsForJob(row.id)
    return
  }

  // Text-output predictions (transcribe). `audio-ai.ts:279` persists the
  // prediction id under provider_kind="replicate-prediction", but the handler
  // writes {text, language, segments} — no URL. The generic path below found
  // none, called markFailed("succeeded but no output URLs") and refunded a job
  // the provider had already produced. Recover it through the SAME shape the
  // handler writes; never through finalizeJobWithMedia (it would try to upload
  // text as audio). transcribe stays a NOT_GENERIC_RECOVERABLE member (the
  // denylist below is the backstop for every OTHER caller of this function),
  // but this branch runs and unconditionally returns (success OR empty-
  // transcript failure) before that denylist is ever reached, so the two
  // paths never double-handle the same row.
  if (row.job_type === "transcribe") {
    const provider = (row.input_data?.provider as string | undefined) ?? "whisper"
    const wordTimestamps = row.input_data?.wordTimestamps === true
    const raw = pred.output as Record<string, unknown> | null | undefined
    const shaped = raw
      ? provider === "incredibly-fast-whisper"
        ? mapFastWhisperOutput(raw as FastWhisperOutput, {
            language: row.input_data?.language as string | undefined,
            wordTimestamps,
          })
        : mapWhisperOutput(raw as WhisperOutput, { wordTimestamps })
      : null
    if (!shaped || shaped.text.length === 0) {
      await markFailed(
        row.id,
        "The provider returned no transcript. Your credits were refunded.",
        `transcribe recovery: empty output (provider=${provider})`,
      )
      await refundReservedCreditsForJob(row.id)
      return
    }
    const ok = await markJobCompleted(row.id, { output_data: shaped as unknown as Record<string, unknown> })
    if (!ok) return
    await commitJobCredits(await loadUsageLogId(row.id), row.id)
    return
  }

  // Types with their own completion writer, and unknown/NULL types, must not
  // reach finalize (same rationale as kie.ts's twin guard, M-4a/M-4b).
  if (NOT_GENERIC_RECOVERABLE.has(row.job_type ?? "")) {
    // A NOT_GENERIC_RECOVERABLE row (e.g. an entity/DAG handler dispatched
    // through a Replicate image model — image-ai.ts / entity.ts via
    // providerKindForImageModel) can still reach this point with a genuinely
    // EMPTY succeeded output: an empty string or an empty array. (An object
    // output — transcribe's shape above — still counts as "has output", but
    // transcribe already returned above and never reaches this branch.) That
    // is just as unrecoverable as "no output URLs" below, so fail it the same
    // way immediately instead of bumping it for up to 18 ticks first.
    const out = pred.output
    const isEmptyOutput = out === "" || (Array.isArray(out) && out.length === 0)
    if (isEmptyOutput) {
      await markFailed(
        row.id,
        "The provider returned a result we could not read. Your credits were refunded.",
        `empty provider output for ${row.job_type}`,
      )
      await refundReservedCreditsForJob(row.id)
      return
    }
    await bumpAttemptsOrExhaust(row.id, `not generically recoverable: ${row.job_type}`)
    return
  }
  if (!isFinalizeJobType(row.job_type)) {
    await bumpAttemptsOrExhaust(row.id, `unknown job_type for finalize: ${row.job_type ?? "null"}`)
    return
  }

  // succeeded
  const out = pred.output
  const urls = Array.isArray(out)
    ? out.filter((x): x is string => typeof x === "string")
    : typeof out === "string"
      ? [out]
      : []
  if (urls.length === 0) {
    await markFailed(
      row.id,
      "The provider returned a result we could not read. Your credits were refunded.",
      `succeeded but no output URLs (job_type=${row.job_type ?? "null"})`,
    )
    await refundReservedCreditsForJob(row.id)
    return
  }
  const providerMs = pred.metrics?.predict_time
    ? Math.round(pred.metrics.predict_time * 1000)
    : undefined
  // P0.1 (audit Blocker B1): the post-poll completion phase must bump on
  // failure so deterministic failures exhaust to refund+anomaly instead of
  // looping at every cron tick forever (see kie.ts twin for the full story).
  try {
    // i2v + loopTrim.enabled (single-node): addon comes OFF the commit,
    // applied by finalize post-completion (audit P0.3 — see kie.ts twin).
    const loopTrimAddon = loopTrimAddonForReconcile(row.job_type, row.input_data ?? null)

    await finalizeJobWithMedia({
      jobId: row.id,
      jobType: row.job_type,
      claimant: opts?.claimant ?? "cron",
      ...(loopTrimAddon > 0 && { loopTrimAddonRefundCredits: loopTrimAddon }),
      result: {
        url: urls[0]!,
        extraUrls: urls.slice(1),
        cost: null,
        providerUsed: "replicate",
        providerMs,
      },
    })
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err)
  }
}
