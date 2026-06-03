import type { SupabaseClient } from "@supabase/supabase-js"
import {
  buildVideoCreditModelIdentifier,
  isSeedance2Provider,
  type SceneNodeData,
  type ShotSpec,
} from "@nodaro/shared"
import { runPipelineWorkerJob } from "./_run-worker-job.js"
import { pipelineExtendVideo } from "./pipeline-extend-video.js"
import { replicateInterpolateFrames } from "../../../providers/replicate/video.js"
import { replicateSV3D } from "../../../providers/replicate/video.js"

export type PipelineMode = "manual" | "auto" | "guided"

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
  /** Phase 1C.3 Method 3 — KIE taskId of the prior shot's VEO clip. Resolved
   *  by the dispatcher (scene-internal-pipeline) by mapping
   *  `shot.extends_shot_id` to the cached `jobs.output_data.kieTaskId` for
   *  the previously animated shot in the same scene. Required when
   *  `shot_input_mode === 'video_continuation'` AND `video_model` is a VEO
   *  variant. The Seedance 2 path ignores this. */
  priorClipKieTaskId?: string
  /** Phase 1C.3 Method 3 (Seedance 2 path) — R2 URL of the prior shot's
   *  clip. Used as `reference_video_urls=[priorClipUrl]` on the Seedance 2
   *  i2v call. Required when `shot_input_mode === 'video_continuation'` AND
   *  `video_model` is `seedance-2` / `seedance-2-fast`. */
  priorClipUrl?: string
  /** Phase 1C.3 Method 3 (Seedance 2 path) — R2 URL of the prior shot's
   *  extracted last frame (Continuity Method 1). Used as `first_frame_url`
   *  on the Seedance 2 i2v call. Required when `shot_input_mode ===
   *  'video_continuation'` AND `video_model` is `seedance-2` /
   *  `seedance-2-fast`. */
  priorLastFrameUrl?: string
  /** Phase 1C.3 Method 8 — sparse-keyframe URLs persisted by Stage 6 for the
   *  shot's `interpolation_keyframes`. Stage 6 stashes them in shot
   *  metadata as `interpolation_keyframe_urls`. Required when
   *  `shot_input_mode === 'frame_interpolation'`. */
  interpolationKeyframeUrls?: ReadonlyArray<string>
  /** Phase 1C.3 — pipeline run mode. Drives the Method 8 auto-mode cost
   *  guard (interpolation falls back to first_frame on auto mode per spec
   *  §5.13.10). Defaults to "manual" when omitted. */
  pipelineMode?: PipelineMode
  /** #63 dialogue auto-pick — when set, the shot's spoken line is injected into
   *  the animate prompt AND the model's audio is enabled so a native-speech
   *  model (VEO 3.x) bakes the dialogue + lip movement directly. The caller
   *  (`scene-internal-pipeline`) only sets this for shots whose scene
   *  `video_model` is `native_speech` per `getVideoAudioCapability`; it then
   *  revoices the baked clip to the character's voice. Absent for every other
   *  shot → the payload is byte-identical to the silent-animate path. Only the
   *  standard i2v/t2v dispatch honors it (Method 3/8/10 ignore it). */
  spokenDialogue?: string
  /** #63 audio-driven dialogue (Seedance 2.0) — character-voiced TTS fed as the
   *  model's reference audio so it lip-syncs the dialogue in-model. The caller
   *  pre-synthesises the voice and passes it here ONLY for `audio_driven` scene
   *  models; the worker forwards it to the Seedance-2 `reference_audio_urls`
   *  param. Absent for every other shot. Only the standard i2v/t2v dispatch
   *  honors it. */
  referenceAudioUrls?: ReadonlyArray<string>
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
 * Branch table (1C.3):
 *   - "first_frame" / "ref_images" / "multi_shot" → image-to-video worker
 *   - "text" → text-to-video worker
 *   - "first_last_frame" → throw "mode_unsupported_until_1c3" (still deferred)
 *   - "video_continuation" → Method 3 (VEO Extend via pipelineExtendVideo;
 *     Seedance 2 surfaces `provider_not_available:seedance-2-extend`)
 *   - "frame_interpolation" → Method 8. Auto mode falls back to first_frame
 *     with a warning; manual mode calls `replicateInterpolateFrames` (which
 *     throws `provider_not_available:<model>` until a hosted provider lands)
 *   - "camera_path" → Method 10. SV3D calls `replicateSV3D` (currently
 *     stubbed). All other models fall back to a prompt amendment + first_frame.
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
    priorClipKieTaskId,
    priorClipUrl,
    priorLastFrameUrl,
    interpolationKeyframeUrls,
    pipelineMode = "manual",
    spokenDialogue,
    referenceAudioUrls,
  } = args

  const mode = sceneNodeData.shot_input_mode
  const videoModel = sceneNodeData.video_model
  const duration = Math.max(1, Math.round(shot.duration_seconds))
  const motionPrompt = shot.motion_prompt
  const prompt = shot.visual_keyframe_prompt

  // #63 — when the scene's model bakes native speech, fold the spoken line into
  // the visual prompt so the model says it on camera (lip-synced). Only the
  // standard i2v/t2v dispatch below uses `speechPrompt` + enables audio; the
  // Method 3/8/10 special paths keep the plain `prompt`.
  const speechPrompt = spokenDialogue
    ? `${prompt}\n\nThe on-screen character speaks this line aloud, lip-synced and clearly audible, in the scene's language: "${spokenDialogue.trim()}"`
    : prompt

  // first_last_frame is still deferred (Method 2 paired-keyframes).
  if (mode === "first_last_frame") {
    throw new Error(`pipelineAnimateShot: mode_unsupported_until_1c3:${mode}`)
  }

  // ─── Method 3 — video_continuation ───────────────────────────────────────
  if (mode === "video_continuation") {
    if (!shot.extends_shot_id) {
      throw new Error(
        `pipelineAnimateShot: video_continuation requires shot.extends_shot_id`,
      )
    }
    // Branch by model: VEO uses its native /extend-video endpoint (needs the
    // prior clip's KIE taskId); Seedance 2 uses i2v + reference_video_urls
    // (needs the prior clip's R2 URL + the prior last_frame URL).
    if (isSeedance2Provider(videoModel)) {
      if (!priorClipUrl || !priorLastFrameUrl) {
        throw new Error(
          `pipelineAnimateShot: video_continuation with ${videoModel} requires priorClipUrl + priorLastFrameUrl; the dispatcher should resolve them from the prior shot '${shot.extends_shot_id}' video_url + last_frame_url.`,
        )
      }
      const result = await pipelineExtendVideo({
        supabase,
        pipelineId,
        pipelineEntityId,
        userId,
        priorClipUrl,
        priorLastFrameUrl,
        prompt: shot.action || motionPrompt || prompt,
        model: videoModel,
        duration,
        shotId: shot.shot_id,
      })
      return {
        jobId: result.jobId,
        assetId: result.assetId,
        assetUrl: result.assetUrl,
        creditsSpent: result.creditsSpent,
        videoModel,
      }
    }
    if (!priorClipKieTaskId) {
      throw new Error(
        `pipelineAnimateShot: video_continuation requires priorClipKieTaskId; the dispatcher should resolve it from the prior shot '${shot.extends_shot_id}' jobs.output_data.kieTaskId.`,
      )
    }
    const result = await pipelineExtendVideo({
      supabase,
      pipelineId,
      pipelineEntityId,
      userId,
      priorClipKieTaskId,
      prompt: motionPrompt || prompt,
      model: videoModel,
      shotId: shot.shot_id,
    })
    return {
      jobId: result.jobId,
      assetId: result.assetId,
      assetUrl: result.assetUrl,
      creditsSpent: result.creditsSpent,
      videoModel,
    }
  }

  // ─── Method 8 — frame_interpolation ─────────────────────────────────────
  if (mode === "frame_interpolation") {
    if (!shot.interpolation_keyframes || shot.interpolation_keyframes.length < 2) {
      throw new Error(
        `pipelineAnimateShot: frame_interpolation requires ≥2 interpolation_keyframes`,
      )
    }
    if (
      !interpolationKeyframeUrls ||
      interpolationKeyframeUrls.length !== shot.interpolation_keyframes.length
    ) {
      throw new Error(
        `pipelineAnimateShot: frame_interpolation keyframe URLs missing or count mismatch (expected ${shot.interpolation_keyframes.length}, got ${interpolationKeyframeUrls?.length ?? 0}) — Stage 6 should pre-generate them.`,
      )
    }
    // Auto-mode cost gate per spec §5.13.10 — N keyframes × image gen + an
    // interpolation call dwarfs a single i2v. Fall back to first_frame and
    // log a warning so the user can see why their auto-run didn't get
    // interpolation. Manual mode honors the request.
    if (pipelineMode === "auto") {
      console.warn(
        `[pipelineAnimateShot] frame_interpolation skipped in auto mode for shot=${shot.shot_id}; falling back to first_frame.`,
      )
      return await pipelineAnimateShot({
        ...args,
        sceneNodeData: { ...sceneNodeData, shot_input_mode: "first_frame" },
        startFrameUrl: startFrameUrl ?? interpolationKeyframeUrls[0] ?? null,
      })
    }
    // Currently stubbed — `replicateInterpolateFrames` throws
    // `provider_not_available:<model>`. Surfaces via Stage 7's
    // failAndMarkTerminal. When a hosted provider lands, swap out the stub.
    const result = await replicateInterpolateFrames({
      keyframeUrls: interpolationKeyframeUrls,
      timeline: shot.interpolation_keyframes.map((k) => k.timestamp_sec),
      // Default the Method 8 model to "rife"; capability registry will pick
      // it when the Shot List Critic gates the combination at planning time.
      model: "rife",
    })
    return {
      jobId: `interp:${shot.shot_id}`,
      assetId: null,
      assetUrl: result.url,
      creditsSpent: 0,
      videoModel,
    }
  }

  // ─── Method 10 — camera_path ────────────────────────────────────────────
  if (mode === "camera_path") {
    if (!shot.camera_path_directive) {
      throw new Error(
        `pipelineAnimateShot: camera_path requires shot.camera_path_directive`,
      )
    }
    // SV3D path is the native camera-path provider — currently stubbed.
    if (videoModel === "stable-video-3d") {
      const seedImage = startFrameUrl ?? shot.keyframe_url ?? referenceUrls[0]
      if (!seedImage) {
        throw new Error(
          `pipelineAnimateShot: camera_path with stable-video-3d requires a seed image (startFrameUrl, keyframe_url, or reference)`,
        )
      }
      const result = await replicateSV3D({
        imageUrl: seedImage,
        cameraPath: shot.camera_path_directive,
        durationSeconds: shot.duration_seconds,
      })
      return {
        jobId: `sv3d:${shot.shot_id}`,
        assetId: null,
        assetUrl: result.url,
        creditsSpent: 0,
        videoModel,
      }
    }
    // Fallback: amend the prompt with a camera-motion phrase and recurse as
    // a first_frame call. Works for every i2v model (VEO, Kling, Seedance,
    // etc.) — the existing models accept the camera language natively in
    // their motion prompts.
    const amendment = cameraPathToPromptAmendment(shot.camera_path_directive)
    const amendedShot: ShotSpec = {
      ...shot,
      action: amendment ? `${shot.action} ${amendment}`.trim() : shot.action,
      motion_prompt: amendment
        ? `${shot.motion_prompt} ${amendment}`.trim()
        : shot.motion_prompt,
    }
    return await pipelineAnimateShot({
      ...args,
      shot: amendedShot,
      sceneNodeData: { ...sceneNodeData, shot_input_mode: "first_frame" },
    })
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
  // #63 audio-driven — character-voiced TTS forwarded to Seedance-2's
  // reference_audio_urls so it lip-syncs the dialogue in-model. Conditional
  // spread keeps every non-audio_driven payload byte-identical.
  const refAudioForPayload =
    referenceAudioUrls && referenceAudioUrls.length > 0 ? [...referenceAudioUrls] : undefined

  const result = await runPipelineWorkerJob({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData: {
      prompt: speechPrompt,
      motionPrompt,
      provider: videoModel,
      duration,
      imageUrl: startFrameUrl,
      referenceImageUrls: refsForPayload,
      type: dispatchKind,
      shot_id: shot.shot_id,
      // Only enable model audio when baking a spoken line — keeps non-dialogue
      // shots on the existing (silent / provider-default) path. VEO is not an
      // AUDIO_ADDON model, so this does not change the credit identifier.
      ...(spokenDialogue ? { generateAudio: true } : {}),
      ...(refAudioForPayload ? { referenceAudioUrls: refAudioForPayload } : {}),
    },
    queueName: "videoQueue",
    jobName: dispatchKind,
    buildPayload: (jobId, usageLogId) =>
      dispatchKind === "image-to-video"
        ? {
            jobId,
            imageUrl: startFrameUrl,
            prompt: speechPrompt,
            motionPrompt,
            provider: videoModel,
            duration,
            referenceImageUrls: refsForPayload,
            ...(spokenDialogue ? { generateAudio: true } : {}),
            ...(refAudioForPayload ? { referenceAudioUrls: refAudioForPayload } : {}),
            usageLogId,
          }
        : {
            jobId,
            prompt: speechPrompt,
            provider: videoModel,
            duration,
            referenceImageUrls: refsForPayload,
            ...(spokenDialogue ? { generateAudio: true } : {}),
            ...(refAudioForPayload ? { referenceAudioUrls: refAudioForPayload } : {}),
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

/**
 * Method 10 fallback — convert a camera-path directive into a natural-language
 * amendment that can be appended to the motion prompt. Used when the chosen
 * `video_model` isn't a native camera-path model (i.e. not SV3D). Every i2v
 * model handles these phrases natively in their motion language.
 *
 * Reasonable defaults for `parameters`:
 *   orbit:  degrees=360
 *   dolly:  direction="forward"
 *   crane:  direction="upward"
 *   arc:    no params (smooth arc by default)
 *   reveal: target="a hidden element"
 */
export function cameraPathToPromptAmendment(directive: {
  path_kind: "orbit" | "dolly" | "crane" | "arc" | "reveal"
  parameters?: Record<string, unknown>
}): string {
  switch (directive.path_kind) {
    case "orbit": {
      const degrees = (directive.parameters?.degrees as number | undefined) ?? 360
      return `Camera orbits subject ${degrees}°.`
    }
    case "dolly": {
      const direction = (directive.parameters?.direction as string | undefined) ?? "forward"
      return `Camera dollies ${direction} smoothly.`
    }
    case "crane": {
      const direction = (directive.parameters?.direction as string | undefined) ?? "upward"
      return `Camera cranes ${direction} revealing the scene.`
    }
    case "arc":
      return "Camera arcs around the subject in a smooth curve."
    case "reveal": {
      const target = (directive.parameters?.target as string | undefined) ?? "a hidden element"
      return `Camera moves to reveal ${target}.`
    }
    default:
      return ""
  }
}
