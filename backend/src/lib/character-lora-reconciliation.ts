/**
 * Character LoRA training reconciliation cron.
 *
 * Safety net for the webhook-delivery happy path. Sweeps `characters` rows
 * stuck in `queued` / `training` longer than the expected ~15-min training
 * duration + buffer, polls Replicate for each one's actual status, and
 * applies the same terminal-state updates the webhook handler would have.
 *
 * Catches: webhook delivered to a downed backend, Replicate giving up
 * retries after 24h, intermediate proxy dropping the callback, etc. Without
 * this, an orphan training row stays `'training'` forever and the user's
 * credits stay reserved indefinitely.
 *
 * Uses the `characters_lora_inflight_idx` partial index from migration 126
 * — without a reconciliation pass, that index was dead weight.
 */

import { supabase } from "./supabase.js"
import { config } from "./config.js"
import { refundReservedCreditsForJob } from "./character-lora.js"
import { deleteCharacterLora } from "../providers/replicate/training.js"
import {
  CHARACTER_LORA_TRAINING_JOB_TYPE,
} from "@nodaro/shared"

/** Wait this long before sweeping — covers normal ~15-min training + buffer. */
const STALE_THRESHOLD_MINUTES = 30
/** Cap per sweep so a backlog doesn't hammer Replicate's rate limit. */
const SWEEP_BATCH_LIMIT = 50

interface InflightCharacter {
  id: string
  user_id: string
  lora_training_replicate_id: string
  deleted_at: string | null
}

interface ReplicateTrainingResponse {
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled"
  output?: { version?: string } | null
  version?: string
  error?: string | null
}

/**
 * Fetch a single training's current status from Replicate's REST API.
 * Returns null on network / auth / 404 errors — the caller should leave
 * the row alone and try again next sweep.
 */
async function fetchReplicateTraining(
  trainingId: string,
): Promise<ReplicateTrainingResponse | null> {
  try {
    const res = await fetch(
      `https://api.replicate.com/v1/trainings/${trainingId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.REPLICATE_API_TOKEN}`,
        },
      },
    )
    if (!res.ok) {
      console.warn(
        `[lora-reconciliation] GET training ${trainingId} → ${res.status}`,
      )
      return null
    }
    return (await res.json()) as ReplicateTrainingResponse
  } catch (err) {
    console.warn(
      `[lora-reconciliation] fetch ${trainingId} threw: ${(err as Error).message}`,
    )
    return null
  }
}

/**
 * Apply a terminal Replicate status to our database — mirrors the webhook
 * handler's logic with the same monotonic state guards. Idempotent: a
 * later webhook delivery for the same training is a no-op because the
 * `.not("lora_training_status", "in", "(succeeded,cancelled)")` filter
 * blocks the regression.
 */
async function applyTerminalStatus(
  character: InflightCharacter,
  remote: ReplicateTrainingResponse,
): Promise<void> {
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", character.user_id)
    .eq("job_type", CHARACTER_LORA_TRAINING_JOB_TYPE)
    .eq("metadata->>replicate_id", character.lora_training_replicate_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

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

    if (job) {
      await supabase
        .from("jobs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("user_id", character.user_id)
        .not("status", "in", "(completed,failed,cancelled)")
    }

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

    if (job) {
      await supabase
        .from("jobs")
        .update({
          status: finalStatus,
          error: remote.error ?? null,
        })
        .eq("id", job.id)
        .eq("user_id", character.user_id)
        .not("status", "in", "(completed,failed,cancelled)")
      // refundCredits is idempotent (CAS on status='reserved').
      await refundReservedCreditsForJob(job.id).catch(() => {})
    }
  }
  // `starting` / `processing` → still in flight, leave the row alone.
}

/**
 * Main entry. Returns a summary so the cron can log meaningful output.
 * Idempotent + safe to run on every interval — does nothing when no rows
 * are stale.
 */
export interface ReconciliationSummary {
  readonly scanned: number
  readonly reconciled: number
  readonly stillInFlight: number
  readonly fetchFailures: number
}

export async function reconcileOrphanedTrainings(): Promise<ReconciliationSummary> {
  if (!config.REPLICATE_API_TOKEN) {
    return { scanned: 0, reconciled: 0, stillInFlight: 0, fetchFailures: 0 }
  }

  const cutoff = new Date(
    Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000,
  ).toISOString()

  const { data: stale } = await supabase
    .from("characters")
    .select("id, user_id, lora_training_replicate_id, deleted_at")
    .in("lora_training_status", ["queued", "training"])
    .not("lora_training_replicate_id", "is", null)
    .lt("updated_at", cutoff)
    .limit(SWEEP_BATCH_LIMIT)

  const rows = (stale ?? []) as InflightCharacter[]
  let reconciled = 0
  let stillInFlight = 0
  let fetchFailures = 0

  for (const char of rows) {
    const remote = await fetchReplicateTraining(char.lora_training_replicate_id)
    if (!remote) {
      fetchFailures += 1
      continue
    }
    if (remote.status === "succeeded" || remote.status === "failed" || remote.status === "canceled") {
      await applyTerminalStatus(char, remote)
      reconciled += 1
    } else {
      stillInFlight += 1
    }
  }

  return {
    scanned: rows.length,
    reconciled,
    stillInFlight,
    fetchFailures,
  }
}
