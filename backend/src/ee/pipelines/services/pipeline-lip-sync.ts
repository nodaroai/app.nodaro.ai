import type { SupabaseClient } from "@supabase/supabase-js"
import { buildLipSyncCreditId } from "@nodaro/shared/credits"
import { SEEDANCE_LIP_SYNC_PROVIDERS, isMinimaxH3Provider } from "@nodaro/shared/models"
import { runPipelineWorkerJob } from "./_run-worker-job.js"

export interface PipelineLipSyncArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Entity to attribute the lip-synced video asset to (typically the SceneNode). */
  pipelineEntityId?: string
  userId: string
  /** Source video URL — the shot's already-animated clip. Most providers
   *  (LatentSync / Video-Retalking / Seedance 2) prefer video input. */
  videoUrl?: string
  /** Source image URL — alternative to videoUrl for portrait-style providers
   *  like Kling Avatar / SadTalker. */
  imageUrl?: string
  /** Dialogue audio URL — output of pipelineGenerateSpeech. */
  audioUrl: string
  /** Pipeline default: Kling Avatar 2.0 — best mouth shape per backend/CLAUDE.md. */
  provider?: string
  resolution?: "480p" | "720p" | "1080p"
  /** Audio duration in seconds — required to bucket Kling Avatar's per-second
   *  pricing. Missing values fall back to the worst-case 5-min bucket and the
   *  worker refunds the diff once actual KIE costTime is known. */
  audioDurationSec?: number
}

export interface PipelineLipSyncResult {
  jobId: string
  assetId: string | null
  /** R2 URL of the lip-synced video. */
  assetUrl: string
  creditsSpent: number
}

/**
 * Lip-syncs an audio track onto a video / portrait via the existing lip-sync
 * worker. Used by the SceneNode internal pipeline (step 5) when
 * `lipsync_enabled` is true and the shot has a `dialogue_line`. The output
 * replaces the shot's original animated clip in the per-scene combine step.
 *
 * Same pattern as pipelineGenerateImage. Credit identifier construction
 * mirrors routes/lip-sync.ts (Kling Avatar uses buildLipSyncCreditId for
 * per-second tiering; infinitalk + seedance-2 family use compound suffixes).
 */
export async function pipelineLipSync(
  args: PipelineLipSyncArgs,
): Promise<PipelineLipSyncResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    videoUrl,
    imageUrl,
    audioUrl,
    provider = "kling-avatar",
    resolution,
    audioDurationSec,
  } = args

  if (!videoUrl && !imageUrl) {
    throw new Error("pipelineLipSync requires either videoUrl or imageUrl")
  }

  // Mirror routes/lip-sync.ts credit-identifier construction. (minimax-h3
  // reserves the 2K-rate 8s composite — the lip-sync surface never sends
  // H3's own 768P tier, and KIE renders 2K when the param is omitted.)
  const modelIdentifier =
    provider === "infinitalk"
      ? `infinitalk:${resolution ?? "720p"}`
      : isMinimaxH3Provider(provider)
        ? "minimax-h3:8s"
        : SEEDANCE_LIP_SYNC_PROVIDERS.has(provider)
          ? `${provider}:8s:${resolution ?? "720p"}-ref`
          : provider === "kling-avatar" || provider === "kling-avatar-pro"
            ? buildLipSyncCreditId(provider, audioDurationSec)
            : provider

  return runPipelineWorkerJob({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData: {
      videoUrl,
      imageUrl,
      audioUrl,
      provider,
      resolution,
      audioDurationSec,
      type: "lip-sync",
    },
    queueName: "videoQueue",
    jobName: "lip-sync",
    buildPayload: (jobId, usageLogId) => ({
      jobId,
      imageUrl,
      videoUrl,
      audioUrl,
      provider,
      resolution,
      audioDurationSec,
      usageLogId,
    }),
    modelIdentifier,
    assetType: "video",
    pickOutputUrl: (output) =>
      (output.videoUrl as string | undefined) ?? (output.url as string | undefined),
    missingOutputError: "lip-sync job completed without videoUrl in output_data",
  })
}
