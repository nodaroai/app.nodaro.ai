import type { SupabaseClient } from "@supabase/supabase-js"
import { buildVideoCreditModelIdentifier, isSeedance2Provider } from "@nodaro/shared"
import { runPipelineWorkerJob } from "./_run-worker-job.js"

/**
 * Args for `pipelineExtendVideo` — the Method 3 (video_continuation) wrapper.
 *
 * KIE's VEO Extend endpoint REQUIRES the original `kieTaskId` of the prior
 * VEO generation (videos must have been generated through VEO 3.1 itself —
 * extension by raw URL is NOT supported per
 * https://docs.kie.ai/veo3-api/extend-video.md). The caller (scene-internal
 * pipeline's animate dispatcher) is responsible for resolving the prior
 * shot's `jobs.output_data.kieTaskId` and passing it through.
 *
 * Seedance 2 (and seedance-2-fast) take a different route: they have no
 * native extension primitive, but they accept a multi-video style reference
 * (`reference_video_urls`, up to 3 per `SEEDANCE_2_REF_LIMITS`) alongside
 * `first_frame_url` in the same call. We send the prior clip as the video
 * ref + the prior last_frame as the first_frame_url + an explicit "continue
 * seamlessly" prompt amendment — closest analog to true extension Seedance 2
 * supports today. NOT frame-perfect — the model still synthesizes new frames
 * rather than continuing the prior clip's exact dynamics — but far better
 * than pure last-frame chaining because the model sees the prior video as a
 * motion/style reference.
 */
export interface PipelineExtendVideoArgs {
  supabase: SupabaseClient
  pipelineId: string
  pipelineEntityId?: string
  userId: string
  /** KIE taskId of the prior VEO clip (output_data.kieTaskId on its jobs row).
   *  Required for VEO 3.1 (`veo3` / `veo3.1`). Unused by the Seedance 2 path. */
  priorClipKieTaskId?: string
  /** R2 URL of the prior clip — used by Seedance 2's `reference_video_urls`
   *  workaround. Required for `seedance-2` / `seedance-2-fast`. */
  priorClipUrl?: string
  /** R2 URL of the prior clip's extracted last frame (Continuity Method 1).
   *  Used by Seedance 2 as `first_frame_url` for boundary continuity. Required
   *  for `seedance-2` / `seedance-2-fast`. */
  priorLastFrameUrl?: string
  /** Motion / continuation prompt for the extended segment. */
  prompt: string
  /** Video model — "veo3", "veo3.1" (VEO Extend), or "seedance-2" /
   *  "seedance-2-fast" (i2v + reference_video_urls workaround). */
  model: string
  /** Optional duration for the extended segment (Seedance 2 honours this;
   *  VEO Extend is fixed at 8s per KIE's spec). */
  duration?: number
  /** Optional VEO variant override; defaults to "fast". */
  veoModelVariant?: "fast" | "quality"
  /** Optional seed (10000–99999). */
  seeds?: number
  /** Optional shot_id, for the jobs row's input_data trail. */
  shotId?: string
}

export interface PipelineExtendVideoResult {
  jobId: string
  assetId: string | null
  /** R2 URL of the extended clip. */
  assetUrl: string
  creditsSpent: number
}

/**
 * Method 3 — video continuation. Thin wrapper around the existing
 * `/v1/extend-video` worker route via `runPipelineWorkerJob`. The worker
 * handler (handleExtendVideo in `workers/handlers/video-ai.ts`) does the
 * real KIE call + uploads to R2 + writes `output_data.{videoUrl,kieTaskId}`
 * — we just create the job, enqueue, and poll like every other pipeline
 * service wrapper.
 *
 * Seedance 2 routes through the standard image-to-video worker instead of
 * VEO Extend, with `first_frame_url=priorLastFrameUrl` and
 * `reference_video_urls=[priorClipUrl]`. See the interface doc above for the
 * tradeoff.
 */
export async function pipelineExtendVideo(
  args: PipelineExtendVideoArgs,
): Promise<PipelineExtendVideoResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    priorClipKieTaskId,
    priorClipUrl,
    priorLastFrameUrl,
    prompt,
    model,
    duration,
    veoModelVariant,
    seeds,
    shotId,
  } = args

  // ─── Seedance 2 — i2v + reference_video_urls workaround ──────────────────
  // Why: Seedance 2 has no native video-extension param, but it accepts a
  // multi-video style reference (`reference_video_urls`, up to 3) AND
  // `first_frame_url` in the same call (see backend/src/providers/kie/video.ts
  // `applySeedance2Params` lines 60-74 — both fields are set on the same
  // payload). Combining the prior clip (motion/style context) + prior
  // last_frame (boundary continuity) + an explicit "continue seamlessly"
  // prompt amendment is the closest analog to true extension Seedance 2
  // supports. NOT frame-perfect — the model still synthesizes new frames
  // rather than continuing the prior clip's exact dynamics.
  if (isSeedance2Provider(model)) {
    if (!priorLastFrameUrl) {
      throw new Error(
        `${model} video_continuation: priorLastFrameUrl is required (prior shot's last_frame must be extracted first)`,
      )
    }
    if (!priorClipUrl) {
      throw new Error(
        `${model} video_continuation: priorClipUrl is required`,
      )
    }
    const augmentedPrompt = `${prompt.trim()} Continue seamlessly from the previous clip, matching its motion, lighting, and style.`
    const effectiveDuration = duration && duration > 0 ? Math.max(1, Math.round(duration)) : 8
    // hasVideoRef=true → credit identifier gets `-ref` suffix (e.g.
    // `seedance-2:8s:480p-ref`), which is the cheaper rate Seedance 2 uses
    // when a reference video is attached.
    const modelIdentifier = buildVideoCreditModelIdentifier(
      model,
      effectiveDuration,
      /* sound */ undefined,
      "image-to-video",
      /* mode/videoSize */ undefined,
      /* resolution */ undefined,
      /* hasVideoRef */ true,
    )
    return runPipelineWorkerJob({
      supabase,
      pipelineId,
      pipelineEntityId,
      userId,
      inputData: {
        type: "image-to-video",
        provider: model,
        prompt: augmentedPrompt,
        imageUrl: priorLastFrameUrl,
        referenceVideoUrls: [priorClipUrl],
        duration: effectiveDuration,
        ...(seeds !== undefined ? { seed: seeds } : {}),
        ...(shotId !== undefined ? { shot_id: shotId } : {}),
      },
      queueName: "videoQueue",
      jobName: "image-to-video",
      buildPayload: (jobId, usageLogId) => ({
        jobId,
        imageUrl: priorLastFrameUrl,
        prompt: augmentedPrompt,
        provider: model,
        duration: effectiveDuration,
        referenceVideoUrls: [priorClipUrl],
        ...(seeds !== undefined ? { seed: seeds } : {}),
        usageLogId,
      }),
      modelIdentifier,
      assetType: "video",
      pickOutputUrl: (output) =>
        (output.videoUrl as string | undefined) ?? (output.url as string | undefined),
      missingOutputError: "seedance-2 video_continuation job completed without videoUrl in output_data",
    })
  }

  // Only VEO 3.1 (and its older "veo3" alias) are routed through VEO Extend.
  if (!model.startsWith("veo")) {
    throw new Error(
      `pipelineExtendVideo: unsupported model '${model}' for Method 3 (only veo3 / veo3.1 / seedance-2 / seedance-2-fast are wired).`,
    )
  }

  if (!priorClipKieTaskId) {
    throw new Error(
      `pipelineExtendVideo: VEO Extend requires priorClipKieTaskId (the prior VEO clip's KIE taskId).`,
    )
  }

  const provider = "veo-extend" as const
  const veoModel: "fast" | "quality" = veoModelVariant === "quality" ? "quality" : "fast"
  // VEO Extend uses the "veo-extend:quality" composite identifier when the
  // user picks the quality variant (mirrors `/v1/extend-video`'s
  // `resolveExtendVideoIdentifier`).
  const modelIdentifier = veoModel === "quality" ? "veo-extend:quality" : "veo-extend"

  return runPipelineWorkerJob({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData: {
      type: "extend-video",
      provider,
      kieTaskId: priorClipKieTaskId,
      prompt,
      model: veoModel,
      ...(seeds !== undefined ? { seeds } : {}),
      ...(shotId !== undefined ? { shot_id: shotId } : {}),
    },
    queueName: "videoQueue",
    jobName: "extend-video",
    buildPayload: (jobId, usageLogId) => ({
      jobId,
      kieTaskId: priorClipKieTaskId,
      prompt,
      provider,
      model: veoModel,
      ...(seeds !== undefined ? { seeds } : {}),
      usageLogId,
    }),
    modelIdentifier,
    assetType: "video",
    pickOutputUrl: (output) =>
      (output.videoUrl as string | undefined) ?? (output.url as string | undefined),
    missingOutputError: "extend-video job completed without videoUrl in output_data",
  })
}
