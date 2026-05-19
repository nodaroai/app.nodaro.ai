import type { SupabaseClient } from "@supabase/supabase-js"
import { runPipelineWorkerJob } from "./_run-worker-job.js"

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

  return runPipelineWorkerJob({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData: {
      prompt,
      provider: modelIdentifier,
      referenceImageUrls: referenceImageUrls ?? [],
      aspectRatio,
    },
    queueName: "videoQueue",
    jobName: "generate-image",
    buildPayload: (jobId, usageLogId) => ({
      jobId,
      prompt,
      referenceImageUrls,
      provider: modelIdentifier,
      aspectRatio,
      usageLogId,
    }),
    modelIdentifier,
    assetType: "image",
    pickOutputUrl: (output) => output.imageUrl as string | undefined,
    missingOutputError: "Image job completed without imageUrl in output_data",
  })
}
