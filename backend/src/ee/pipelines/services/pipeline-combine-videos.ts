import type { SupabaseClient } from "@supabase/supabase-js"
import { runPipelineWorkerJob } from "./_run-worker-job.js"
import { getAppSettings } from "../../../lib/app-settings.js"
import { applyServiceMarkup } from "../../billing/service-margin.js"
import { measureVideoUtilityCharge, videoUtilityMeasuredBaseCredits } from "../../../lib/video-utility-length.js"

export interface PipelineCombineVideosArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Entity to attribute the combined video asset to. For per-scene composites
   *  this is the SceneNode entity; for Stage 8 (post_merge) this is omitted
   *  so the final asset lives on the pipeline directly. */
  pipelineEntityId?: string
  userId: string
  /** Ordered list of clip URLs to concat. At least 2 required (route Zod check). */
  videoUrls: ReadonlyArray<string>
  /** Any id from `COMBINE_TRANSITIONS`. Route Zod validates against the
   *  catalog; this signature accepts the full string set. */
  transition?: string
  transitionDuration?: number
  audioMode?: "keep" | "crossfade" | "remove"
  trimStartFrames?: number
  trimEndFrames?: number
}

export interface PipelineCombineVideosResult {
  jobId: string
  assetId: string | null
  /** R2 URL of the concatenated video. */
  assetUrl: string
  creditsSpent: number
}

/**
 * Concatenates multiple video clips into one via the existing
 * `combine-videos` worker (which wraps FFmpeg). Used twice in the pipeline:
 *   1. SceneNode internal pipeline step 6 — merges per-shot clips into the
 *      scene's `composite_video`.
 *   2. Stage 8 (post_merge) — merges every scene composite into the final
 *      pipeline MP4.
 *
 * Pattern matches pipelineGenerateImage. The "combine-videos" model
 * identifier is fixed (no provider variant). Priced as every Combine Videos
 * run is: each clip measured before anything is reserved, the node's own unit
 * formula at those lengths, each unit at the combine-videos row
 * (lib/video-utility-length.ts); the units and lengths ride the job, and the
 * render refuses clips longer than they were priced at.
 */
export async function pipelineCombineVideos(
  args: PipelineCombineVideosArgs,
): Promise<PipelineCombineVideosResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    videoUrls,
    transition = "cut",
    transitionDuration = 0.5,
    audioMode = "crossfade",
    trimStartFrames = 0,
    trimEndFrames = 0,
  } = args

  if (videoUrls.length < 2) {
    throw new Error("pipelineCombineVideos requires at least 2 video URLs")
  }
  const priced = { videoUrls, transition, transitionDuration, trimStartFrames, trimEndFrames }
  const measured = await measureVideoUtilityCharge("combine-videos", priced)
  if (!measured.ok) throw new Error(`combine-videos: ${measured.message}`)
  const charged = { upstreamDurations: [...measured.secs], billedUnits: measured.units }
  const creditOverride = applyServiceMarkup(await videoUtilityMeasuredBaseCredits("combine-videos", measured.units), await getAppSettings(), "combine-videos")

  return runPipelineWorkerJob({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData: {
      videoUrls,
      transition,
      transitionDuration,
      audioMode,
      trimStartFrames,
      trimEndFrames,
      ...charged,
      type: "combine-videos",
    },
    queueName: "videoQueue",
    jobName: "combine-videos",
    buildPayload: (jobId, usageLogId) => ({
      jobId,
      videoUrls,
      transition,
      transitionDuration,
      audioMode,
      trimStartFrames,
      trimEndFrames,
      ...charged,
      usageLogId,
    }),
    modelIdentifier: "combine-videos",
    creditOverride,
    assetType: "video",
    pickOutputUrl: (output) =>
      (output.videoUrl as string | undefined) ?? (output.url as string | undefined),
    missingOutputError: "combine-videos job completed without videoUrl in output_data",
  })
}
