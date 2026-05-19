import { supabase } from "../supabase.js"
import {
  pollKieTask,
  pollVeoTask,
  KieError,
} from "../../providers/kie/client.js"
import { pollKling3Task } from "../../providers/kie/kling3-client.js"
import { pollKontextTask } from "../../providers/kie/kontext-client.js"
import { pollLumaTask } from "../../providers/kie/luma-client.js"
import { pollRunwayTask, pollAlephTask } from "../../providers/kie/runway-client.js"
import { finalizeJobWithMedia, type FinalizeJobType } from "../job-finalize.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"

export interface KieJobRow {
  id: string
  provider_kind: string | null
  provider_task_id: string | null
  reconcile_attempts: number
  job_type: string | null
}

/** Single-attempt poll dispatcher. Returns the recovered URL(s) on success;
 *  throws when the upstream task is still running OR has terminally failed.
 *  Caller distinguishes via the `KieError` "task failed" vs timeout patterns. */
async function singlePoll(row: KieJobRow): Promise<{
  url: string
  extraUrls: readonly string[]
  providerMs?: number
}> {
  if (!row.provider_task_id) throw new Error("no provider_task_id")
  const id = row.provider_task_id

  switch (row.provider_kind) {
    case "kie-standard":
    case "kie-lip-sync": {
      // Kling avatar / InfiniTalk use the standard /jobs/recordInfo endpoint.
      const r = await pollKieTask(id, 1)
      const urls = r.resultJson.resultUrls ?? (
        r.resultJson.videoUrl ? [r.resultJson.videoUrl]
        : r.resultJson.audioUrl ? [r.resultJson.audioUrl]
        : []
      )
      if (!urls[0]) throw new Error("KIE success but no result URL")
      return { url: urls[0]!, extraUrls: urls.slice(1), providerMs: r.providerMs }
    }
    case "kie-veo": {
      const r = await pollVeoTask(id, "VEO")
      const urls = r.resultUrls
      if (!urls?.[0]) throw new Error("VEO success but no resultUrls")
      return { url: urls[0]!, extraUrls: urls.slice(1), providerMs: r.providerMs }
    }
    case "kie-kling3": {
      const videoUrl = await pollKling3Task(id)
      return { url: videoUrl, extraUrls: [] }
    }
    case "kie-kontext": {
      const r = await pollKontextTask(id, 1)
      const urls = r.resultJson.resultUrls ?? []
      if (!urls[0]) throw new Error("Kontext success but no resultUrls")
      return { url: urls[0]!, extraUrls: urls.slice(1) }
    }
    case "kie-luma": {
      const r = await pollLumaTask(id, 1)
      const urls = r.resultJson.resultUrls ?? []
      if (!urls[0]) throw new Error("Luma success but no resultUrls")
      return { url: urls[0]!, extraUrls: urls.slice(1) }
    }
    case "kie-runway": {
      const videoUrl = await pollRunwayTask(id, "Runway")
      return { url: videoUrl, extraUrls: [] }
    }
    case "kie-suno": {
      // Suno output has multi-track shape (sunoTracks array) that the standard
      // finalize audio dispatch can't preserve. Skip — Suno reconcile requires
      // a dedicated handler that calls uploadAllSunoTracks (Phase 3.5).
      throw new Error("kie-suno reconcile not yet supported")
    }
    default:
      throw new Error(`unknown KIE provider_kind: ${row.provider_kind}`)
  }
}

async function bumpAttempts(jobId: string, err: unknown): Promise<void> {
  const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
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
      reconcile_last_error: msg,
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
 * Reconcile a stuck KIE job. Polls the upstream task once via the right
 * `pollX` for the row's `provider_kind`, then:
 *   - on success: forwards the result URLs to `finalizeJobWithMedia` so
 *     output_data gets written, credits commit, asset row created, workflow
 *     execution reopens if sole-cause.
 *   - on upstream failure (`KieError` with "task failed"): marks the job
 *     failed + refunds reserved credits.
 *   - on transient (still running, network blip): bumps `reconcile_attempts`
 *     and leaves the row in place for the next cron tick.
 */
export async function reconcileKieJob(row: KieJobRow): Promise<void> {
  if (!row.provider_task_id) return

  let result: { url: string; extraUrls: readonly string[]; providerMs?: number }
  try {
    result = await singlePoll(row)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isUpstreamFailure =
      err instanceof KieError && msg.includes("task failed")
    if (isUpstreamFailure) {
      await markFailed(row.id, msg)
      await refundReservedCreditsForJob(row.id)
    } else {
      // still pending / transient / unsupported kind — try again next tick
      await bumpAttempts(row.id, err)
    }
    return
  }

  await finalizeJobWithMedia({
    jobId: row.id,
    jobType: (row.job_type ?? "generate-image") as FinalizeJobType,
    result: {
      url: result.url,
      extraUrls: result.extraUrls,
      cost: null,  // committed at reservation; actual cost is unknown post-reconcile
      providerUsed: null,
      providerMs: result.providerMs,
    },
  })
}
