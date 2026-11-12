/**
 * The ONE delivery of a finished Nodaro Video Upscale run (decided
 * 2026-11-11): its lane row's `deliver` in `house-model-lanes.ts`, called by
 * `deliverHouseModelRun` on both paths — the worker, once its run resolved,
 * and the reconcile kind that finishes a job whose worker died — so a
 * recovered job is delivered exactly like a normal one.
 *
 * The result clip is re-hosted on our storage (the job's own key, the free
 * tier's watermark where the job carries it; an H.264 clip is stored as
 * delivered), its first frame stored as the thumbnail, and the job completed
 * through the shared finalize: the clip, the thumbnail, the delivered size
 * where the run reports it, the house-model id as the job's provider and the
 * run's resolved cost. The price is flat — the hold IS the charge — so the
 * reservation commits as it stands (no settle).
 *
 * The job's row is read first, and nothing is downloaded or stored until it
 * answers (decided 2026-11-12): whose clip it is and whether it carries the
 * watermark come from it, so a read that fails is thrown (as a post-processing
 * failure: the run was delivered, so the job is retried or left for the
 * reconcile, never failed and refunded), and a job with no row, or one already
 * ended (completed, failed, cancelled, held for review), is the finalize's
 * graceful skip — `{ ok: false }`, nothing re-hosted.
 */
import { finalizeJobWithMedia } from "./job-finalize.js"
import type { HouseModelDeliveryOutcome, HouseModelPricedDelivery } from "./house-model-delivery.js"
import { PostProcessingError } from "./post-processing-error.js"
import { supabase } from "./supabase.js"
import { generateAndUploadThumbnail, uploadVideoMaybeWatermark } from "../workers/shared.js"

/** PostgREST's "no row" for a `.single()`: the one read error that says something about the job. */
const NO_ROW = "PGRST116"

interface DeliveryRow {
  readonly user_id?: string | null
  readonly should_watermark?: boolean | null
  readonly status?: string | null
}

export async function deliverNodaroVideoUpscale(d: HouseModelPricedDelivery): Promise<HouseModelDeliveryOutcome> {
  const resultUrl = d.resultUrls[0]!
  // Who the clip belongs to, whether it carries the free tier's watermark, and whether it is still running: the job's own row, on either path.
  // trash-read: a job's own delivery — it finishes whether or not it was deleted (the finalize decides what is kept)
  const { data, error } = await supabase.from("jobs").select("user_id, should_watermark, status").eq("id", d.jobId).single()
  if (error && (error as { code?: string }).code !== NO_ROW) {
    // A failed read is no answer about the job: never re-host the clip without its owner or its watermark.
    throw new PostProcessingError(`could not read job ${d.jobId} before its delivery: ${error.message ?? "unknown read error"}`)
  }
  const row = (error ? null : data) as DeliveryRow | null
  // No row, or a job already ended: the finalize's own graceful skip, before any download.
  if (!row || (row.status !== "pending" && row.status !== "processing")) return { ok: false }
  const userId = row.user_id ?? undefined
  const stored = await uploadVideoMaybeWatermark(resultUrl, d.jobId, userId, row.should_watermark === true)
  const thumbnailUrl = await generateAndUploadThumbnail(stored, d.jobId, userId)
  return finalizeJobWithMedia({
    jobId: d.jobId,
    jobType: d.jobType,
    claimant: d.claimant,
    result: { url: resultUrl, cost: d.providerCostUsd, providerUsed: d.id },
    mediaUrl: stored,
    extraOutputData: {
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      // The output size, where the run reports it.
      ...(d.width !== undefined && d.height !== undefined ? { width: d.width, height: d.height } : {}),
    },
  })
}
