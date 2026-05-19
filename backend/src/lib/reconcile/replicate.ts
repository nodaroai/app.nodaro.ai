import { config } from "../config.js"
import { supabase } from "../supabase.js"
import { finalizeJobWithMedia, type FinalizeJobType } from "../job-finalize.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { deleteCharacterLora } from "../../providers/replicate/training.js"

export interface ReplicateJobRow {
  id: string
  provider_kind: string | null
  provider_task_id: string | null
  reconcile_attempts: number
  job_type: string | null
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
    await supabase
      .from("characters")
      .update({
        lora_training_status: finalStatus,
        lora_training_error: remote.error ?? null,
      })
      .eq("id", character.id)
      .eq("user_id", character.user_id)
      .not("lora_training_status", "in", "(succeeded,cancelled)")

    await supabase
      .from("jobs")
      .update({
        status: finalStatus,
        error_message: remote.error ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", character.user_id)
      .not("status", "in", "(completed,failed,cancelled)")
    await refundReservedCreditsForJob(jobId).catch(() => {})
  }
  // starting/processing → still in flight, caller bumps attempts
}

async function bumpAttempts(jobId: string, reason: string): Promise<void> {
  const { data } = await supabase
    .from("jobs")
    .select("reconcile_attempts")
    .eq("id", jobId)
    .single()
  const current = ((data as { reconcile_attempts?: number } | null)?.reconcile_attempts ?? 0)
  await supabase
    .from("jobs")
    .update({
      reconcile_attempts: current + 1,
      reconcile_last_error: reason.slice(0, 500),
    })
    .eq("id", jobId)
}

async function markFailed(jobId: string, reason: string): Promise<void> {
  await supabase
    .from("jobs")
    .update({
      status: "failed",
      error_message: reason.slice(0, 500),
      completed_at: new Date().toISOString(),
      reconcile_last_error: "upstream_failed",
    })
    .eq("id", jobId)
    .neq("status", "cancelled")
}

/**
 * Reconcile a stuck Replicate job. Polls /v1/predictions/:id once, then:
 *   - status=succeeded → finalize with output URL(s)
 *   - status=failed|canceled → markFailed + refund
 *   - status=starting|processing → bumpAttempts
 *
 * For `provider_kind="replicate-training"`, fetches the training via
 * `/v1/trainings/:id`, looks up the linked `characters` row, and applies
 * the same terminal-state updates the LoRA webhook handler would have.
 * Replaces the standalone reconcileOrphanedTrainings cron (deleted in P3.5).
 */
export async function reconcileReplicateJob(row: ReplicateJobRow): Promise<void> {
  if (!row.provider_task_id) return

  if (row.provider_kind === "replicate-training") {
    const remote = await fetchReplicateTraining(row.provider_task_id)
    if (!remote) {
      await bumpAttempts(row.id, "fetch training failed")
      return
    }
    if (remote.status === "starting" || remote.status === "processing") {
      await bumpAttempts(row.id, `training still ${remote.status}`)
      return
    }
    // Terminal — find the character + apply the same updates the webhook
    // handler would have. Skip silently if no character is linked (orphan job).
    const character = await findCharacterForTraining(row.provider_task_id)
    if (!character) {
      await bumpAttempts(row.id, "no character linked to training")
      return
    }
    await applyTrainingTerminalStatus(row.id, character, remote)
    return
  }

  // replicate-prediction path
  const pred = await fetchReplicatePrediction(row.provider_task_id)
  if (!pred) {
    await bumpAttempts(row.id, "fetch failed")
    return
  }

  if (pred.status === "starting" || pred.status === "processing") {
    await bumpAttempts(row.id, `still ${pred.status}`)
    return
  }

  if (pred.status === "failed" || pred.status === "canceled") {
    await markFailed(row.id, pred.error ?? `upstream ${pred.status}`)
    await refundReservedCreditsForJob(row.id)
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
    await markFailed(row.id, "succeeded but no output URLs")
    await refundReservedCreditsForJob(row.id)
    return
  }
  const providerMs = pred.metrics?.predict_time
    ? Math.round(pred.metrics.predict_time * 1000)
    : undefined
  await finalizeJobWithMedia({
    jobId: row.id,
    jobType: (row.job_type ?? "generate-image") as FinalizeJobType,
    result: {
      url: urls[0]!,
      extraUrls: urls.slice(1),
      cost: null,
      providerUsed: "replicate",
      providerMs,
    },
  })
}
