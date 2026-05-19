import type { SupabaseClient } from "@supabase/supabase-js"
import {
  buildVideoCreditModelIdentifier,
  type SceneNodeData,
  type ShotSpec,
} from "@nodaro/shared"
import { runPipelineWorkerJob } from "./_run-worker-job.js"

export interface PipelineAnimateShotArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** The SceneNode entity that owns this shot. */
  pipelineEntityId: string
  userId: string
  /** The shot being animated — read from sceneNodeData.shots[N]. */
  shot: ShotSpec
  /** Full scene data — provides `video_model` + `shot_input_mode` (scene-level
   *  defaults; per-shot override would live on ShotSpec when added). */
  sceneNodeData: SceneNodeData
  /** Resolved start frame URL. Null for text-only modes. The caller decides
   *  the URL inline in scene-internal-pipeline (`priorLastFrameUrl ??
   *  keyframe_url`) — either the prior shot's last_frame (sequential mode)
   *  or the shot's own keyframe. */
  startFrameUrl: string | null
  /** Ordered reference image URLs — output of `allocateReferenceSlots` in
   *  continuity.ts. Capped to the model's max_refs by the allocator. */
  referenceUrls?: ReadonlyArray<string>
}

export interface PipelineAnimateShotResult {
  jobId: string
  assetId: string | null
  /** R2 URL of the animated clip. */
  assetUrl: string
  creditsSpent: number
  /** Resolved video model used (echo for diagnostics). */
  videoModel: string
}

/**
 * Animates a single shot inside the SceneNode internal pipeline (step 3).
 * Dispatches to either `image-to-video` or `text-to-video` based on the
 * shot's `shot_input_mode`. The worker queue + payload shape match the
 * existing `/v1/generate-video` and `/v1/text-to-video` routes byte-for-byte
 * so the worker handlers see no difference between a single-node request and
 * a pipeline-driven request.
 *
 * Branch table (1C.1):
 *   - "first_frame" / "ref_images" / "multi_shot" → image-to-video worker
 *   - "text" → text-to-video worker
 *   - "first_last_frame" / "video_continuation" / "frame_interpolation"
 *     / "camera_path" → throw "mode_unsupported_until_1c3"
 *
 * Each unsupported branch lands in Phase 1C.3 (Methods 3/8/10). The throw
 * is intentional — it forces the orchestrator to halt the scene with a
 * structured failure reason rather than silently animate the wrong thing.
 */
export async function pipelineAnimateShot(
  args: PipelineAnimateShotArgs,
): Promise<PipelineAnimateShotResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    shot,
    sceneNodeData,
    startFrameUrl,
    referenceUrls = [],
  } = args

  const mode = sceneNodeData.shot_input_mode
  const videoModel = sceneNodeData.video_model
  const duration = Math.max(1, Math.round(shot.duration_seconds))
  const motionPrompt = shot.motion_prompt
  const prompt = shot.visual_keyframe_prompt

  // Defer the four advanced-continuity modes to Phase 1C.3.
  if (
    mode === "first_last_frame" ||
    mode === "video_continuation" ||
    mode === "frame_interpolation" ||
    mode === "camera_path"
  ) {
    throw new Error(`pipelineAnimateShot: mode_unsupported_until_1c3:${mode}`)
  }

  // "first_frame", "ref_images", "multi_shot" → image-to-video. "text" → text-to-video.
  const dispatchKind: "image-to-video" | "text-to-video" =
    mode === "text" ? "text-to-video" : "image-to-video"

  if (dispatchKind === "image-to-video" && !startFrameUrl && referenceUrls.length === 0) {
    throw new Error(
      `pipelineAnimateShot: ${mode} requires startFrameUrl or referenceUrls`,
    )
  }

  const hasVideoRef = false // 1C.1 doesn't wire reference videos (Method 3 = 1C.3).
  const modelIdentifier = buildVideoCreditModelIdentifier(
    videoModel,
    duration,
    /* sound */ undefined,
    dispatchKind,
    /* mode/videoSize */ undefined,
    /* resolution */ undefined,
    hasVideoRef,
  )

  const refsForPayload = referenceUrls.length > 0 ? [...referenceUrls] : undefined

  const result = await runPipelineWorkerJob({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData: {
      prompt,
      motionPrompt,
      provider: videoModel,
      duration,
      imageUrl: startFrameUrl,
      referenceImageUrls: refsForPayload,
      type: dispatchKind,
      shot_id: shot.shot_id,
    },
    queueName: "videoQueue",
    jobName: dispatchKind,
    buildPayload: (jobId, usageLogId) =>
      dispatchKind === "image-to-video"
        ? {
            jobId,
            imageUrl: startFrameUrl,
            prompt,
            motionPrompt,
            provider: videoModel,
            duration,
            referenceImageUrls: refsForPayload,
            usageLogId,
          }
        : {
            jobId,
            prompt,
            provider: videoModel,
            duration,
            referenceImageUrls: refsForPayload,
            usageLogId,
          },
    modelIdentifier,
    assetType: "video",
    pickOutputUrl: (output) =>
      (output.videoUrl as string | undefined) ?? (output.url as string | undefined),
    missingOutputError: `${dispatchKind} job completed without videoUrl in output_data`,
  })

  return {
    jobId: result.jobId,
    assetId: result.assetId,
    assetUrl: result.assetUrl,
    creditsSpent: result.creditsSpent,
    videoModel,
  }
}
