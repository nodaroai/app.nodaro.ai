import { config } from "../config.js"
import { supabase } from "../supabase.js"
import { finalizeJobWithMedia, type FinalizeJobType } from "../job-finalize.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"

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
 * For `provider_kind="replicate-training"`, delegates to the LoRA-specific
 * reconciliation helper (P3.9 will migrate the standalone LoRA cron here).
 * Until that lands, training rows are no-ops here (covered by the existing
 * standalone reconcileOrphanedTrainings cron).
 */
export async function reconcileReplicateJob(row: ReplicateJobRow): Promise<void> {
  if (!row.provider_task_id) return

  if (row.provider_kind === "replicate-training") {
    // LoRA training reconcile handled by the existing standalone cron.
    // Phase 3.9 migrates it into this file (reconcileOneTraining).
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
