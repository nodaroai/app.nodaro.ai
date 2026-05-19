import type { SupabaseClient } from "@supabase/supabase-js"
import { runPipelineWorkerJob } from "./_run-worker-job.js"

export interface PipelineExtractFrameArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Entity to attribute the frame asset to (typically the SceneNode entity). */
  pipelineEntityId?: string
  userId: string
  videoUrl: string
  /** Extract mode — defaults to "timestamp" since pipeline callers always
   * supply an exact `durationSec - 0.1s` value for last-frame extraction. */
  mode?: "first" | "last" | "timestamp"
  /** Required when mode='timestamp'. Pipeline callers pass `duration - 0.1s`. */
  timestamp?: number
}

export interface PipelineExtractFrameResult {
  jobId: string
  /** Asset id of the extracted frame (image asset). Null only in the rare
   *  race window where the asset row hasn't landed within the grace period. */
  assetId: string | null
  /** R2 URL of the extracted PNG. */
  assetUrl: string
  creditsSpent: number
}

/**
 * Calls the existing `extract-frame` route's worker path to pull a single
 * frame out of a video. Used inside `runSceneInternalPipeline` after each
 * shot's animate step to extract the last frame for the continuity chain
 * (Method 1 in §5.13.2).
 *
 * Mirrors the `pipelineGenerateImage` pattern: insert jobs row tagged with
 * pipeline_id, reserve credits via the canonical service, enqueue with the
 * flat payload the worker's `handleExtractFrame` consumes, poll until
 * terminal, optionally link the asset to the entity.
 */
export async function pipelineExtractFrame(
  args: PipelineExtractFrameArgs,
): Promise<PipelineExtractFrameResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    videoUrl,
    mode = "timestamp",
    timestamp,
  } = args

  return runPipelineWorkerJob({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData: { videoUrl, mode, timestamp, type: "extract-frame" },
    queueName: "videoQueue",
    jobName: "extract-frame",
    buildPayload: (jobId, usageLogId) => ({
      jobId,
      videoUrl,
      mode,
      timestamp,
      usageLogId,
    }),
    modelIdentifier: "extract-frame",
    assetType: "image",
    pickOutputUrl: (output) =>
      (output.imageUrl as string | undefined) ?? (output.frameUrl as string | undefined),
    missingOutputError: "Extract-frame job completed without imageUrl/frameUrl in output_data",
  })
}
