import type { SupabaseClient } from "@supabase/supabase-js"
import { PIPELINE_STAGE_TIMEOUT_MS } from "@nodaro/shared"

const POLL_INTERVAL_MS = 3000
/**
 * Extra grace window after `jobs.status` flips to "completed" during which we
 * keep polling `assets` for the row written by `createAssetFromJob` in the
 * worker (see `backend/src/workers/video-worker.ts` — the asset insert runs
 * AFTER the handler resolves, so observing `status=completed` does not
 * guarantee the asset row exists yet).
 */
const ASSET_POLL_GRACE_MS = 15_000
const ASSET_POLL_INTERVAL_MS = 500

export interface PipelineGenerateImageArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Optional — when present we link the resulting asset row to this entity
   * (which auto-fills `assets.pipeline_id` via DB trigger). Omit for one-off
   * pipeline images that aren't tied to a specific entity. */
  pipelineEntityId?: string
  userId: string
  /** Free-text prompt. Engine builds this from entity metadata. */
  prompt: string
  /** Image generation model. Defaults to nano-banana. */
  modelIdentifier?: string
  /** Reference image URLs (e.g., main character image when generating variants). */
  referenceImageUrls?: string[]
  /** Optional aspect ratio (default 1:1). */
  aspectRatio?: string
}

export interface PipelineGenerateImageResult {
  jobId: string
  /** Asset row id from the `assets` table — present once `createAssetFromJob`
   * has run in the worker. May be `null` if the brief post-completion window
   * elapsed without the asset row appearing (rare; the image URL is still
   * usable, the asset row will land asynchronously). */
  assetId: string | null
  /** R2 URL of the generated image (from `jobs.output_data.imageUrl`). */
  assetUrl: string
  /** Actual credits committed by the worker; falls back to 0 if commit hasn't
   * caught up by the time we observe status=completed. */
  creditsSpent: number
}

/**
 * Creates a generate-image job, queues it via the existing videoQueue + image-ai
 * handler path, polls until completion, and returns the asset.
 *
 * Reuses Nodaro's existing image-gen infrastructure end-to-end:
 *   - `jobs` row INSERT (tagged with pipeline_id).
 *   - `CreditsService.reserveCredits` for atomic reservation + usage_log.
 *   - `videoQueue.add("generate-image", {...})` with the flat payload the
 *     worker's `handleGenerateImage` destructures.
 *   - Worker commits/refunds credits on its own — we don't double-commit here.
 *
 * On timeout or failure → throws. Caller decides retry vs entity status='failed'.
 */
export async function pipelineGenerateImage(
  args: PipelineGenerateImageArgs,
): Promise<PipelineGenerateImageResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    prompt,
    modelIdentifier = "nano-banana",
    referenceImageUrls,
    aspectRatio = "1:1",
  } = args

  // 1. Create jobs row tagged with pipeline_id so admin/billing/cleanup paths
  //    can correlate this child job back to its parent pipeline.
  const { data: job, error: insertErr } = await supabase
    .from("jobs")
    .insert({
      user_id: userId,
      status: "pending",
      input_data: {
        prompt,
        provider: modelIdentifier,
        referenceImageUrls: referenceImageUrls ?? [],
        aspectRatio,
      },
      pipeline_id: pipelineId,
    })
    .select("id")
    .single()
  if (insertErr || !job?.id) {
    throw new Error(
      `Failed to create image job: ${insertErr?.message ?? "no id returned"}`,
    )
  }
  const jobId = job.id as string

  // 2. Reserve credits via the canonical service (positional args). This is
  //    the same path /v1/generate-image uses through `reserveCreditsForJob`.
  //    providerCost/displayCost = 0 here because the worker will overwrite
  //    with the real cost via commitJobCredits → CreditsService.commitCredits.
  //    DB pricing lookup inside reserveCredits supplies the reserved credit
  //    amount from the model identifier, so this still charges correctly up
  //    front and refunds the overage on completion.
  const { CreditsService } = await import("../../billing/credits.js")
  const reservation = await CreditsService.reserveCredits(
    userId,
    jobId,
    modelIdentifier,
    0,
    0,
    { isAppRun: false },
  )

  // 3. Enqueue with the flat payload shape the worker actually consumes
  //    (see backend/src/workers/handlers/image-ai.ts::handleGenerateImage).
  const { videoQueue } = await import("../../../lib/queue.js")
  await videoQueue.add("generate-image", {
    jobId,
    prompt,
    referenceImageUrls,
    provider: modelIdentifier,
    aspectRatio,
    usageLogId: reservation.usageLogId,
  })

  // 4. Poll the jobs row until terminal.
  const deadline = Date.now() + PIPELINE_STAGE_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const { data: row } = await supabase
      .from("jobs")
      .select("status, output_data, error_message, credits_actual")
      .eq("id", jobId)
      .maybeSingle()
    if (!row) continue

    if (row.status === "failed" || row.status === "cancelled") {
      throw new Error(
        `Image generation ${row.status}: ${row.error_message ?? "unknown"}`,
      )
    }

    if (row.status === "completed") {
      const output = (row.output_data ?? {}) as { imageUrl?: string }
      if (!output.imageUrl) {
        throw new Error("Image job completed without imageUrl in output_data")
      }

      // 5. Optionally link the asset to the entity (DB trigger fills pipeline_id).
      //    The asset row is inserted by `createAssetFromJob` AFTER the handler
      //    resolves, so we poll briefly to give it time to land. The image is
      //    usable from `output.imageUrl` regardless of whether the row exists.
      const assetId = await pollForAssetId(supabase, jobId)
      if (assetId && pipelineEntityId) {
        await supabase
          .from("assets")
          .update({ pipeline_entity_id: pipelineEntityId })
          .eq("id", assetId)
      }

      return {
        jobId,
        assetId,
        assetUrl: output.imageUrl,
        creditsSpent: (row.credits_actual as number | null) ?? 0,
      }
    }
  }
  throw new Error(`Image generation timed out after ${PIPELINE_STAGE_TIMEOUT_MS}ms`)
}

async function pollForAssetId(
  supabase: SupabaseClient,
  jobId: string,
): Promise<string | null> {
  const deadline = Date.now() + ASSET_POLL_GRACE_MS
  while (Date.now() < deadline) {
    const { data: asset } = await supabase
      .from("assets")
      .select("id")
      .eq("job_id", jobId)
      .eq("type", "image")
      .maybeSingle()
    if (asset?.id) return asset.id as string
    await sleep(ASSET_POLL_INTERVAL_MS)
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
