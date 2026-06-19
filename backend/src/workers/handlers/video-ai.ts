import { dirname } from "node:path"
import { uploadToR2 } from "../../lib/storage.js"
import {
  imageToVideo,
  textToVideo,
  videoToVideo,
  lipSync,
  motionTransfer,
  videoUpscale,
} from "../../providers/index.js"
import type { ProgressCallback } from "../../providers/provider.interface.js"
import { runVeoExtendTask, runVeo1080pTask, runVeo4kTask } from "../../providers/kie/client.js"

import { runRunwayExtendTask } from "../../providers/kie/runway-client.js"
import { replicateLipSync } from "../../providers/replicate/lip-sync.js"
import { falLipSync } from "../../providers/fal/lip-sync.js"
import { replicateFaceSwap } from "../../providers/replicate/face-swap.js"
import { runGroundedSam } from "../../providers/replicate/grounded-sam.js"
import {
  runLtxTextToVideo,
  runLtxImageToVideo,
  runLtxAudioToVideo,
  runLtxExtend,
  runLtxRetake,
} from "../../providers/replicate/ltx-video.js"
import { config } from "../../lib/config.js"
import { FAL_LIP_SYNC_PROVIDERS, REPLICATE_LIP_SYNC_PROVIDERS, SEEDANCE_2_EXTEND_STITCH, SEEDANCE_LIP_SYNC_PROVIDERS, estimateLoopTrimAddonCredits, isVeoProvider, getVideoAudioCapability, parseAttributedDialogue, resolveDialogueVoices } from "@nodaro/shared"
import type { CharacterVoiceSpec, DialogueLine, ResolvedDialogueVoiceLine } from "@nodaro/shared"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { combineVideos } from "../../providers/video/combine-videos.js"
import { resolveSourceMatchedAspect } from "../../providers/video/source-matched-aspect.js"
import {
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  stripAudio,
} from "../../providers/video/ffmpeg-utils.js"
import { applySmartLoopCutToR2Url } from "../../providers/video/apply-smart-loop-cut.js"
import { join } from "node:path"
import { readFile, rm } from "node:fs/promises"
import { uploadBufferToR2 } from "../../lib/storage.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { KieAudioProvider, isKieAcceptedVoice } from "../../providers/kie/audio.js"
import { extractAudioTrack } from "../../providers/video/extract-audio-track.js"
import { directVoiceChanger } from "../../providers/elevenlabs/voice-changer.js"
import { directElevenLabsTTS, stripAudioTags } from "../../providers/elevenlabs/direct-tts.js"

/**
 * VEO3 / VEO3.1 always produce a video with background audio per KIE's
 * docs (no native sound-off flag). When the user passes `sound: false`,
 * we honour intent by stream-copying the video and dropping the audio
 * track, then re-uploading. Cheap (no re-encode).
 */
async function stripAudioFromR2Url(videoUrl: string, jobId: string): Promise<string> {
  // POST-PROVIDER: `videoUrl` is the delivered VEO result; download/strip/
  // upload failures are post-delivery → PostProcessingError (refund skipped).
  return runPostProcessing(async () => {
    let workDir: string | undefined
    try {
      workDir = await createWorkDir("veo3-strip-audio")
      const inputPath = join(workDir, "in.mp4")
      const outputPath = join(workDir, "out.mp4")
      await downloadFile(videoUrl, inputPath)
      await stripAudio(inputPath, outputPath)
      const buffer = await readFile(outputPath)
      const key = `videos/${jobId}-silent.mp4`
      return await uploadBufferToR2(buffer, key, "video/mp4")
    } finally {
      if (workDir) await cleanupWorkDir(workDir)
    }
  })
}

import {
  buildProviderMeta,
  commitJobCredits,
  markJobCompleted,
  uploadVideoMaybeWatermark,
  watermarkLocalVideoAndUpload,
  generateAndUploadThumbnail,
  setJobProgress,
  startProgressRamp,
  withProgressRamp,
  refundLoopTrimAddon,
  type HandlerFn,
} from "../shared.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"
import { handleAiAvatar } from "./heygen-avatar.js"
import { handleCinematicAvatar } from "./heygen-cinematic.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import {
  providerKindForVideoModel,
  providerKindForLipSyncModel,
  providerKindForVideoToVideoModel,
} from "../../lib/reconcile/provider-kind.js"
import type { ProviderKind } from "../../lib/reconcile/types.js"

/**
 * Lightricks LTX 2.3 dispatch.
 *
 * Submits a Replicate prediction (one model id per variant — the `task` field
 * in the input switches behavior between text/image/audio inputs) and waits
 * synchronously via `replicate.wait()` for terminal state. On success,
 * uploads the resulting video to R2 (with watermark when applicable),
 * generates a thumbnail, and finalises the job row.
 *
 * The payload-builder (`services/workflow-engine/payload-builder.ts`) emits
 * a flat snake_case shape that mirrors the LTX provider's input fields, so
 * we can forward each field directly without re-deriving the task.
 *
 * `jobType` distinguishes the i2v ("image-to-video") vs t2v ("text-to-video")
 * caller so finalize records the right job type — matches the surrounding
 * handler that invoked us.
 *
 * Returns true when the LTX path handled the job (caller must return early);
 * false when the provider is not LTX (caller continues with default routing).
 */
async function dispatchLtxIfRequested(
  job: { data: unknown; updateProgress: (p: number) => Promise<void> },
  ctx: { jobId: string; jobUserId: string | undefined; shouldWatermark: boolean },
  jobType: "image-to-video" | "text-to-video",
): Promise<boolean> {
  const d = job.data as Record<string, unknown>
  const provider = d.provider as string | undefined
  if (provider !== "ltx-2.3-pro" && provider !== "ltx-2.3-fast") return false
  const variant: "ltx-2.3-pro" | "ltx-2.3-fast" = provider

  const task = (d.task as "text_to_video" | "image_to_video" | "audio_to_video" | undefined) ?? "text_to_video"
  const reconcileOpts = {
    onTaskCreated: makeOnTaskCreated(ctx.jobId, providerKindForVideoModel(variant)),
  }
  const common = {
    variant,
    prompt: (d.prompt as string | undefined) ?? "",
    resolution: d.resolution as "1080p" | "2k" | "4k",
    duration: d.duration as number,
    aspectRatio: d.aspect_ratio as "16:9" | "9:16",
    fps: d.fps as 24 | 25 | 48 | 50,
    generateAudio: (d.generate_audio as boolean | undefined) ?? true,
    cameraMotion: (d.camera_motion as
      | "dolly_in" | "dolly_out" | "dolly_left" | "dolly_right"
      | "jib_up" | "jib_down" | "static" | "focus_shift" | "none") ?? "none",
    reconcileOpts,
  }

  // Best-effort progress nudge so the widget shows movement; we ramp toward
  // 90% during the long Replicate wait, then snap to 100% on upload.
  await setJobProgress(job, ctx.jobId, 5)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 85 })

  console.log(
    `[worker] ltx ${ctx.jobId} (variant: ${variant}, task: ${task})`,
  )

  let result
  try {
    if (task === "audio_to_video" && variant === "ltx-2.3-pro") {
      result = await runLtxAudioToVideo({ ...common, variant, audio: d.audio as string })
    } else if (task === "image_to_video") {
      result = await runLtxImageToVideo({
        ...common,
        image: d.image as string,
        lastFrameImage: d.last_frame_image as string | undefined,
      })
    } else {
      result = await runLtxTextToVideo(common)
    }
  } finally {
    ramp.stop()
  }

  const r2Url = await uploadVideoMaybeWatermark(
    result.videoUrl,
    ctx.jobId,
    ctx.jobUserId,
    ctx.shouldWatermark,
  )
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType,
    result: {
      url: result.videoUrl,
      cost: result.cost,
      providerUsed: variant,
    },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl },
  })
  if (ok) {
    console.log(
      `[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${variant}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`,
    )
  }
  return true
}

/** VEO direct-4K generates the base at 1080p, then chains get-4k-video (see
 *  {@link chainVeoBaseTo4k}). KIE's generate endpoint has no "4k" resolution. */
const VEO_4K_BASE_RESOLUTION = "1080p"

/**
 * Chain a completed VEO base generation into KIE's get-4k-video (`runVeo4kTask`)
 * and return the 4K URL. Shared by the i2v + t2v handlers when the user picks 4K:
 * the base runs at {@link VEO_4K_BASE_RESOLUTION}, then upscales here within the
 * same job (reserved at the `<model>:4k` composite price).
 *
 * Crash-window note: on a worker crash BETWEEN the base generation and this call,
 * reconcile finalizes the 1080p base (graceful degradation), not the 4K —
 * acceptable for the rare window; the alternative is full 4K-aware reconcile.
 */
async function chainVeoBaseTo4k(
  result: { url: string; kieTaskId?: string },
  job: { updateProgress: (p: number) => Promise<void> },
  jobId: string,
): Promise<string> {
  if (!result.kieTaskId) {
    throw new Error("VEO 4K requested but the base generation returned no KIE task id")
  }
  console.log(`[worker] VEO 4K — upscaling base task ${result.kieTaskId} for job ${jobId}`)
  await setJobProgress(job, jobId, 50)
  const { resultJson } = await runVeo4kTask(result.kieTaskId, 0, {
    onTaskCreated: makeOnTaskCreated(jobId, "kie-veo"),
  })
  const url = resultJson.resultUrls?.[0]
  if (!url) throw new Error("VEO 4K succeeded but no URL found")
  return url
}

const handleImageToVideo: HandlerFn = async function handleImageToVideo(job, ctx) {
  const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, generationType, loopTrim, enableTranslation, videoTrimStart, videoTrimEnd } = job.data as {
    jobId: string
    imageUrl?: string
    endFrameUrl?: string
    audioUrl?: string
    prompt?: string
    provider?: string
    generateAudio?: boolean
    duration?: number
    mode?: string
    sound?: boolean
    negativePrompt?: string
    motionPrompt?: string
    cfgScale?: number
    aspectRatio?: string
    multiShot?: boolean
    shots?: Array<{ prompt: string; duration: number }>
    elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>
    resolution?: string
    grokMode?: string
    videoSize?: string
    seed?: number
    cameraFixed?: boolean
    referenceImageUrls?: string[]
    referenceVideoUrls?: string[]
    referenceAudioUrls?: string[]
    webSearch?: boolean
    nsfwChecker?: boolean
    generationType?: string
    loopTrim?: {
      enabled: boolean
      framesToTest?: number
      quality?: "lossless" | "precise"
    }
    enableTranslation?: boolean
    videoTrimStart?: number
    videoTrimEnd?: number
  }

  // LTX 2.3 short-circuits the i2v router — it has its own Replicate
  // prediction shape (single model id, `task` discriminator in input) and
  // finalises synchronously via `replicate.wait()` inside the dispatcher,
  // not through the KIE poll loop.
  if (await dispatchLtxIfRequested(job, ctx, "image-to-video")) return

  console.log(`[worker] image-to-video ${ctx.jobId} (provider: ${provider ?? "minimax"})${endFrameUrl ? " [with end frame]" : ""}${audioUrl ? " [with audio]" : ""}`)

  // Map frontend shots/elements to provider format for Kling 3.0
  const multiPrompt = shots?.map((s) => ({ prompt: s.prompt, duration: s.duration }))
  const klingElements = elements?.map((el) => ({
    name: el.name,
    description: el.description,
    ...(el.type === "image" ? { element_input_urls: el.urls } : { element_input_video_urls: el.urls }),
  }))

  // Create progress callback that updates the job record in the database.
  // Routed through setJobProgress so the monotonic guard suppresses the
  // brief backwards jitter when KIE briefly reports a value below where
  // the ramp has already pushed the bar.
  const onProgress: ProgressCallback = async (progress: number) => {
    console.log(`[worker] Job ${ctx.jobId} progress: ${progress}%`)
    await setJobProgress(job, ctx.jobId, progress)
  }

  // Fallback ramp for providers that DON'T expose live progress through
  // KIE's progress field (Seedance, some Wan / Hailuo variants). The
  // ramp climbs linearly to `cap`, then asymptotically toward ~95 — so
  // the bar keeps moving for the full provider duration instead of
  // freezing at `cap` and snapping at the end.
  await setJobProgress(job, ctx.jobId, 5)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 35 })

  const resolvedI2vProvider = provider ?? "minimax"
  const onTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForVideoModel(resolvedI2vProvider),
  )
  // VEO direct-4K: KIE's generate endpoint has no "4k" — 4K is produced by
  // chaining get-4k-video off the base task (see chainVeoBaseTo4k below).
  const wantsVeo4k = resolution === "4k" && isVeoProvider(provider)
  const baseResolution = wantsVeo4k ? VEO_4K_BASE_RESOLUTION : resolution
  let result
  try {
    result = await imageToVideo(imageUrl, resolvedI2vProvider, prompt, duration, endFrameUrl, { onProgress, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShots: multiShot, multiPrompt, klingElements, resolution: baseResolution, grokMode, seed, cameraFixed, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, generationType, enableTranslation, videoTrimStart, videoTrimEnd }, { onTaskCreated })
  } finally {
    ramp.stop()
  }

  // Don't write a backward milestone here — KIE (or the ramp) may have
  // already reported 80–90%+, and writing 40% would visibly regress the bar.
  // The upload milestone below (90%) advances past whatever was reported.

  let providerOutputUrl = result.url

  // VEO direct-4K: chain the base task into get-4k-video, swapping in the 4K result.
  if (wantsVeo4k) providerOutputUrl = await chainVeoBaseTo4k(result, job, ctx.jobId)

  // Generic smart-loop-cut post-process. Runs for any provider when
  // loopTrim.enabled. Failures are non-fatal: keep the un-trimmed output
  // and refund only the addon credits (the i2v base credits stay charged).
  //
  // On SUCCESS the addon must be CHARGED (we spent the compute). The success
  // commit goes through finalizeJobWithMedia -> commitJobCredits with the
  // provider USD cost, which reconciles actual ≈ base and would otherwise
  // refund the addon — so we forward it as extraNonProviderCredits below.
  let loopTrimAddonToCharge = 0
  if (loopTrim?.enabled) {
    const addonCredits = estimateLoopTrimAddonCredits(loopTrim, duration ?? 8)
    try {
      console.log(
        `[worker] image-to-video ${ctx.jobId} smart-loop-cut ` +
        `(quality=${loopTrim.quality ?? "precise"}, framesToTest=${loopTrim.framesToTest ?? 16})`,
      )
      providerOutputUrl = await applySmartLoopCutToR2Url(providerOutputUrl, ctx.jobId, ctx.jobUserId, {
        lookbackFrames: loopTrim.framesToTest ?? 16,
        quality: loopTrim.quality ?? "precise",
        outputSilent: sound === false ? true : undefined,
      })
      loopTrimAddonToCharge = addonCredits
    } catch (err) {
      console.warn(
        `[worker] smart-loop-cut failed for job ${ctx.jobId}; keeping un-trimmed output:`,
        err,
      )
      // Failure path already commits at (reserved - addon); leave addon at 0.
      await refundLoopTrimAddon(ctx.jobId, ctx.usageLogId, addonCredits)
    }
  }

  // VEO3 / VEO3.1 ignore the `sound: false` request (KIE has no audio
  // toggle for VEO). Honour user intent post-hoc: strip the audio track
  // from the result before R2 upload. Skipped when an explicit audioUrl
  // was provided (the merge step downstream handles that case).
  if (
    sound === false &&
    !audioUrl &&
    isVeoProvider(provider)
  ) {
    console.log(
      `[worker] VEO sound=false — stripping audio from output for job ${ctx.jobId}`,
    )
    providerOutputUrl = await stripAudioFromR2Url(providerOutputUrl, ctx.jobId)
  }

  // Upload the generated video to R2
  // If audio merge follows, upload without watermark (watermark applied to final)
  // POST-PROVIDER: `providerOutputUrl` is the delivered i2v result; the bare
  // uploadToR2 here (audio-merge branch) is wrapped so an R2 failure skips the
  // refund (uploadVideoMaybeWatermark already wraps itself).
  let finalVideoUrl = audioUrl
    ? await runPostProcessing(() => uploadToR2(providerOutputUrl, ctx.jobId, "video", ctx.jobUserId))
    : await uploadVideoMaybeWatermark(providerOutputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 90)

  // If audio URL is provided, merge it with the video
  if (audioUrl) {
    console.log(`[worker] Merging audio into video for job ${ctx.jobId}`)
    const mergedPath = await mergeVideoAudio({
      videoUrl: finalVideoUrl,
      audioUrl,
      voiceoverVolume: 100,
      backgroundVolume: 30,
      keepOriginalAudio: generateAudio ?? false,
    })
    await setJobProgress(job, ctx.jobId, 95)

    // Upload merged video (with watermark if applicable)
    finalVideoUrl = await watermarkLocalVideoAndUpload(mergedPath, `${ctx.jobId}-merged`, ctx.jobUserId, ctx.shouldWatermark)
    await cleanupWorkDir(dirname(mergedPath))
  }

  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(finalVideoUrl, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "image-to-video",
    result,
    mediaUrl: finalVideoUrl,
    // Charge the loop-trim addon on top of provider cost when smart-loop-cut
    // succeeded (0 otherwise — failure already refunded it).
    extraNonProviderCredits: loopTrimAddonToCharge,
    extraOutputData: {
      thumbnailUrl: thumbUrl,
      ...buildProviderMeta(result),
    },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${finalVideoUrl} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleVideoToVideo: HandlerFn = async function handleVideoToVideo(job, ctx) {
  const {
    videoUrl, prompt, provider, duration, resolution, audio, multiShots,
    aspectRatio, seed, referenceImageUrl,
    negativePrompt, videoEditDuration, audioSetting, promptExtend,
  } = job.data as {
    jobId: string
    videoUrl: string
    prompt?: string
    provider?: string
    duration?: string
    resolution?: string
    audio?: boolean
    multiShots?: boolean
    aspectRatio?: string
    seed?: number
    referenceImageUrl?: string
    negativePrompt?: string
    videoEditDuration?: string
    audioSetting?: "auto" | "origin"
    promptExtend?: boolean
  }
  const resolvedV2vProvider = provider ?? "wan"
  console.log(`[worker] video-to-video ${ctx.jobId} (provider: ${resolvedV2vProvider})`)

  const v2vOnTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForVideoToVideoModel(resolvedV2vProvider),
  )
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => videoToVideo(videoUrl, resolvedV2vProvider, prompt, {
      duration,
      resolution,
      audio,
      multiShots,
      aspectRatio,
      seed,
      referenceImageUrl,
      negativePrompt,
      videoEditDuration,
      audioSetting,
      promptExtend,
    }, { onTaskCreated: v2vOnTaskCreated }),
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "video-to-video",
    result,
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl, ...buildProviderMeta(result) },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleTextToVideo: HandlerFn = async function handleTextToVideo(job, ctx) {
  const { prompt, provider, duration, mode, sound, negativePrompt, cfgScale, aspectRatio, multiShot, shots, elements, removeWatermark, seed, characterIdList, resolution, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, enableTranslation } = job.data as {
    jobId: string
    prompt: string
    provider?: string
    duration?: number
    mode?: string
    sound?: boolean
    negativePrompt?: string
    cfgScale?: number
    aspectRatio?: string
    multiShot?: boolean
    shots?: Array<{ prompt: string; duration: number }>
    elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>
    removeWatermark?: boolean
    seed?: number
    characterIdList?: string[]
    resolution?: string
    generateAudio?: boolean
    referenceImageUrls?: string[]
    referenceVideoUrls?: string[]
    referenceAudioUrls?: string[]
    webSearch?: boolean
    nsfwChecker?: boolean
    enableTranslation?: boolean
  }

  // LTX 2.3 short-circuits the t2v router — same prediction-shape rationale
  // as the i2v handler above. Covers both `text_to_video` and (Pro-only)
  // `audio_to_video` tasks; payload-builder emits jobName "text-to-video"
  // for both.
  if (await dispatchLtxIfRequested(job, ctx, "text-to-video")) return

  console.log(`[worker] text-to-video ${ctx.jobId} (provider: ${provider ?? "minimax"})${removeWatermark ? " [remove watermark]" : ""}`)

  // Map frontend shots/elements to provider format for Kling 3.0
  const multiPrompt = shots?.map((s) => ({ prompt: s.prompt, duration: s.duration }))
  const klingElements = elements?.map((el) => ({
    name: el.name,
    description: el.description,
    ...(el.type === "image" ? { element_input_urls: el.urls } : { element_input_video_urls: el.urls }),
  }))

  // Same fallback ramp as i2v — covers t2v providers that don't expose
  // KIE progress (Seedance, some Wan / Hailuo) so the widget shows
  // movement instead of pinning at 0%.
  await setJobProgress(job, ctx.jobId, 5)
  const t2vRamp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 40 })
  const resolvedT2vProvider = provider ?? "minimax"
  const t2vOnTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForVideoModel(resolvedT2vProvider),
  )
  // VEO direct-4K: run the base at VEO_4K_BASE_RESOLUTION, then chain get-4k-video below.
  const wantsVeo4k = resolution === "4k" && isVeoProvider(provider)
  const baseResolution = wantsVeo4k ? VEO_4K_BASE_RESOLUTION : resolution
  let result
  try {
    result = await textToVideo(prompt, resolvedT2vProvider, duration, aspectRatio, { mode, sound, negativePrompt, cfgScale, multiShots: multiShot, multiPrompt, klingElements, seed, resolution: baseResolution, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, enableTranslation }, { onTaskCreated: t2vOnTaskCreated })
  } finally {
    t2vRamp.stop()
  }

  // Don't write a backward milestone — the ramp may already be at 80–90%+
  // for long generations. The 100% write after upload will advance past it.

  // VEO3 / VEO3.1: KIE has no native audio toggle, so honour `sound: false`
  // by stripping the audio track post-generation (cheap stream copy).
  let providerOutputUrl = result.url

  // VEO direct-4K: chain into 4K BEFORE the sound-strip below, so stripping
  // operates on the 4K output (reserved at the `<model>:4k` composite).
  if (wantsVeo4k) providerOutputUrl = await chainVeoBaseTo4k(result, job, ctx.jobId)

  if (sound === false && isVeoProvider(provider)) {
    console.log(
      `[worker] VEO sound=false — stripping audio from t2v output for job ${ctx.jobId}`,
    )
    providerOutputUrl = await stripAudioFromR2Url(providerOutputUrl, ctx.jobId)
  }

  const r2Url = await uploadVideoMaybeWatermark(providerOutputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "text-to-video",
    result,
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl, ...buildProviderMeta(result) },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleLipSync: HandlerFn = async function handleLipSync(job, ctx) {
  const {
    imageUrl, videoUrl, audioUrl, prompt, provider, resolution,
    audioDurationSec,
    guidanceScale, inferenceSteps, seed,
    pads, smooth, fps, resizeFactor,
    enhancer, preprocess, still, poseStyle, expressionScale,
    enableDynamicDuration, disableMusicTrack, enableSpeechEnhancement,
    syncMode, temperature, activeSpeaker,
  } = job.data as {
    jobId: string
    imageUrl?: string
    videoUrl?: string
    audioUrl: string
    prompt?: string
    provider?: string
    resolution?: string
    audioDurationSec?: number
    guidanceScale?: number
    inferenceSteps?: number
    seed?: number
    pads?: string
    smooth?: boolean
    fps?: number
    resizeFactor?: number
    enhancer?: string
    preprocess?: string
    still?: boolean
    poseStyle?: number
    expressionScale?: number
    enableDynamicDuration?: boolean
    disableMusicTrack?: boolean
    enableSpeechEnhancement?: boolean
    syncMode?: string
    temperature?: number
    activeSpeaker?: boolean
  }

  const resolvedProvider = provider ?? "kling-avatar"
  console.log(`[worker] lip-sync ${ctx.jobId} (provider: ${resolvedProvider})`)

  // Lip-sync providers (KIE Kling Avatar / InfiniTalk, Replicate models,
  // Seedance i2v with audio ref) all run long KIE/Replicate tasks. Wrap
  // in a single ramp so the widget bar moves regardless of which branch
  // we take.
  await setJobProgress(job, ctx.jobId, 5)
  const lipSyncRamp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 45 })

  let resultUrl: string
  let resultCost: number | null = null
  let resultDisplayCost: number | null = null
  let resultProviderUsed: string = resolvedProvider
  let resultMeta: Parameters<typeof buildProviderMeta>[0] = undefined

  try {

  // Pick the right ProviderKind per branch. Replicate lip-sync runs on
  // Replicate predictions; Seedance routes through KIE's i2v provider;
  // KIE-native lip-sync (kling-avatar*, infinitalk) uses its own poll budget.
  let lipSyncKind: ProviderKind
  if (REPLICATE_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    lipSyncKind = "replicate-prediction"
  } else if (FAL_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    // fal queue jobs reconcile via the "fal-request" kind (tags the row so the
    // reconcile cron can recover/refund a crashed mid-poll fal job).
    lipSyncKind = "fal-request"
  } else if (SEEDANCE_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    lipSyncKind = providerKindForVideoModel(resolvedProvider)
  } else {
    lipSyncKind = providerKindForLipSyncModel(resolvedProvider)
  }
  const lipSyncOnTaskCreated = makeOnTaskCreated(ctx.jobId, lipSyncKind)

  if (REPLICATE_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    // Replicate path
    const faceUrl = videoUrl || imageUrl
    if (!faceUrl) throw new Error("No face input (imageUrl or videoUrl) provided")

    const { videoUrl: outUrl, cost } = await replicateLipSync(
      resolvedProvider,
      faceUrl,
      audioUrl,
      { guidanceScale, inferenceSteps, seed, pads, smooth, fps, resizeFactor, enhancer, preprocess, still, poseStyle, expressionScale, enableDynamicDuration, disableMusicTrack, enableSpeechEnhancement, syncMode, temperature, activeSpeaker },
      { onTaskCreated: lipSyncOnTaskCreated },
    )
    resultUrl = outUrl
    resultCost = cost
    resultDisplayCost = cost
    resultProviderUsed = `replicate:${resolvedProvider}`
  } else if (SEEDANCE_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    // Seedance 2 / 2 Fast — ByteDance's multimodal video models do native
    // phoneme-level lip sync (8+ languages) when fed reference_audio_urls
    // alongside a first_frame_url image. We route through the i2v provider
    // and pass the audio as a reference; the model produces a cinematic
    // talking-head video synced to the voice line.
    if (!imageUrl) {
      throw new Error("Seedance lip-sync requires an image (face/portrait)")
    }
    const result = await imageToVideo(
      imageUrl,
      resolvedProvider,
      prompt || "A person speaking naturally",
      8, // duration — seedance can pick 4-15s; we reserve credits at 8s
      undefined, // endFrameUrl — not used in lip-sync mode
      {
        referenceAudioUrls: [audioUrl],
        resolution: resolution ?? "720p",
        // generateAudio: false — we already have the audio track; let
        // seedance use OUR audio as the soundtrack rather than synthesise
        // a new one. (KIE merges reference_audio_urls into output by default.)
        generateAudio: false,
      },
      { onTaskCreated: lipSyncOnTaskCreated },
    )
    resultUrl = result.url
    resultCost = result.cost
    resultDisplayCost = result.displayCost
    resultProviderUsed = result.providerUsed
    resultMeta = result
  } else if (FAL_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    // fal.ai path (sync-lipsync-v3) — video+audio → video dubbing via the fal
    // queue API. faceUrl can be a video OR an image; the worker already accepts
    // both. audioDurationSec drives per-second credit bucketing (reserved at the
    // route); here it only feeds the anomaly/display cost.
    const faceUrl = videoUrl || imageUrl
    if (!faceUrl) throw new Error("Lip-sync requires a video or image input")
    const out = await falLipSync(
      resolvedProvider,
      faceUrl,
      audioUrl,
      { syncMode, audioDurationSec },
      { onTaskCreated: lipSyncOnTaskCreated },
    )
    resultUrl = out.videoUrl
    resultCost = out.cost
    resultDisplayCost = out.cost
    resultProviderUsed = "fal"
  } else {
    // KIE path (existing) — audioDurationSec drives per-second pricing for
    // kling-avatar(-pro) and selects the longer poll budget for >30s runs.
    const result = await lipSync(
      imageUrl!,
      audioUrl,
      resolvedProvider,
      prompt,
      resolution,
      audioDurationSec,
      { onTaskCreated: lipSyncOnTaskCreated },
    )
    resultUrl = result.url
    resultCost = result.cost
    resultDisplayCost = result.displayCost
    resultProviderUsed = result.providerUsed
    resultMeta = result
  }
  } finally {
    lipSyncRamp.stop()
  }

  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(resultUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "lip-sync",
    result: {
      url: resultUrl,
      cost: resultCost,
      displayCost: resultDisplayCost,
      providerUsed: resultProviderUsed,
    },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl, ...buildProviderMeta(resultMeta) },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${resultProviderUsed}, cost: $${resultCost?.toFixed(6) ?? "N/A"})`)
}

const handleSpeechToVideo: HandlerFn = async function handleSpeechToVideo(job, ctx) {
  const { imageUrl, audioUrl, prompt, resolution, negativePrompt, seed, numFrames, fps, inferenceSteps, guidanceScale, shift } = job.data as {
    jobId: string
    imageUrl: string
    audioUrl: string
    prompt: string
    resolution?: string
    negativePrompt?: string
    seed?: number
    numFrames?: number
    fps?: number
    inferenceSteps?: number
    guidanceScale?: number
    shift?: number
  }
  console.log(`[worker] speech-to-video ${ctx.jobId} (resolution: ${resolution ?? "480p"})`)

  const { KieVideoProvider } = await import("../../providers/kie/video.js")
  const kieVideo = new KieVideoProvider()
  const s2vOnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-standard")
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => kieVideo.speechToVideo(imageUrl, audioUrl, prompt, resolution, {
      negativePrompt,
      seed,
      numFrames,
      fps,
      inferenceSteps,
      guidanceScale,
      shift,
    }, { onTaskCreated: s2vOnTaskCreated }),
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "image-to-video",
    // speech-to-video routes through KIE; result has no providerUsed/displayCost
    // but finalize merges undefined cleanly. Hardcode provider="kie" via extraOutputData
    // if the schema needs it (it doesn't — markJobCompleted accepts null/undefined).
    result: { ...result, providerUsed: "kie" },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl, ...buildProviderMeta(result) },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: kie, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleMotionTransfer: HandlerFn = async function handleMotionTransfer(job, ctx) {
  const { imageUrl, videoUrl, prompt, negativePrompt, characterOrientation, resolution, provider, backgroundSource } = job.data as {
    jobId: string
    imageUrl: string
    videoUrl: string
    prompt?: string
    negativePrompt?: string
    characterOrientation?: "image" | "video"
    resolution?: "480p" | "580p" | "720p" | "1080p"
    provider?: string
    backgroundSource?: "input_video" | "input_image"
  }
  const mtProvider = provider ?? "kling"
  console.log(`[worker] motion-transfer ${ctx.jobId} (provider: ${mtProvider}, orientation: ${characterOrientation ?? "image"}, resolution: ${resolution ?? "720p"})`)

  const onProgress: ProgressCallback = async (progress: number) => {
    console.log(`[worker] Job ${ctx.jobId} motion-transfer progress: ${progress}%`)
    await setJobProgress(job, ctx.jobId, progress)
  }

  const mtOnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-standard")
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => motionTransfer(
      imageUrl,
      videoUrl,
      mtProvider,
      prompt,
      {
        onProgress,
        characterOrientation: characterOrientation ?? "image",
        resolution: resolution ?? "720p",
        provider: mtProvider,
        backgroundSource,
        negativePrompt,
      },
      { onTaskCreated: mtOnTaskCreated },
    ),
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "motion-transfer",
    result,
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl, ...buildProviderMeta(result) },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleVideoUpscale: HandlerFn = async function handleVideoUpscale(job, ctx) {
  const { videoUrl, upscaleFactor, provider, kieTaskId } = job.data as {
    jobId: string
    videoUrl?: string
    upscaleFactor?: "1" | "2" | "4"
    provider?: "topaz" | "veo-1080p" | "veo-4k"
    kieTaskId?: string
  }
  const upscaleProvider = provider ?? "topaz"
  console.log(`[worker] video-upscale ${ctx.jobId} (provider: ${upscaleProvider})`)

  // Wrap each branch in a progress ramp — none of these (VEO upscale,
  // Topaz, etc.) reliably surface live progress; without the ramp the
  // bar pins for the whole upscale duration.
  const outputUrl: string = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    async () => {
      // Per-branch provider_kind: each upscale path polls a DIFFERENT KIE
      // endpoint, so the reconcile dispatcher needs the right kind to pick
      // the matching `pollX` function. Wiring all three through
      // `kie-standard` (the old default) sent reconcile to
      // `/api/v1/jobs/recordInfo` for VEO 4K / 1080p tasks that live on
      // `/api/v1/veo/record-info` / `/api/v1/veo/get-1080p-video` — every
      // stuck row got force-failed after 18 wrong-endpoint polls.
      if (upscaleProvider === "veo-1080p" && kieTaskId) {
        const veo1080OnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-veo-1080p")
        const result = await runVeo1080pTask(kieTaskId, 0, { onTaskCreated: veo1080OnTaskCreated })
        return result.url
      } else if (upscaleProvider === "veo-4k" && kieTaskId) {
        const veo4kOnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-veo")
        const { resultJson } = await runVeo4kTask(kieTaskId, 0, { onTaskCreated: veo4kOnTaskCreated })
        const url = resultJson.resultUrls?.[0]
        if (!url) throw new Error("VEO 4K succeeded but no URL found")
        return url
      } else {
        if (!videoUrl) throw new Error("videoUrl is required for Topaz upscale")
        const topazOnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-standard")
        const onProgress: ProgressCallback = async (progress: number) => {
          console.log(`[worker] Job ${ctx.jobId} video-upscale progress: ${progress}%`)
          await setJobProgress(job, ctx.jobId, progress)
        }
        const result = await videoUpscale(videoUrl, "topaz", upscaleFactor ?? "2", { onProgress }, { onTaskCreated: topazOnTaskCreated })
        return result.url
      }
    },
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(outputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "video-upscale",
    result: { url: outputUrl, cost: null, providerUsed: upscaleProvider },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${upscaleProvider})`)
}

const handleExtendVideo: HandlerFn = async function handleExtendVideo(job, ctx) {
  const d = job.data as Record<string, unknown>
  const provider = d.provider as "veo-extend" | "runway-extend" | "ltx-2.3-pro" | "seedance-2-extend"

  // ─── LTX 2.3 Pro extend ────────────────────────────────────────────────
  // Synchronous `replicate.wait()` — the prediction id is persisted on the
  // job row by makeOnTaskCreated so the 20-min reconcile cron acts as a
  // safety net if the worker process dies mid-wait.
  if (provider === "ltx-2.3-pro") {
    console.log(`[worker] extend-video ${ctx.jobId} (provider: ltx-2.3-pro)`)
    await setJobProgress(job, ctx.jobId, 5)
    const ltxExtendRamp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 85 })
    let ltxExtendResult
    try {
      ltxExtendResult = await runLtxExtend({
        variant: "ltx-2.3-pro",
        video: d.video as string,
        duration: d.duration as number,
        extendMode: (d.extend_mode as "start" | "end" | undefined) ?? "end",
        reconcileOpts: {
          onTaskCreated: makeOnTaskCreated(ctx.jobId, providerKindForVideoModel("ltx-2.3-pro")),
        },
      })
    } finally {
      ltxExtendRamp.stop()
    }
    const ltxExtendR2Url = await uploadVideoMaybeWatermark(
      ltxExtendResult.videoUrl,
      ctx.jobId,
      ctx.jobUserId,
      ctx.shouldWatermark,
    )
    await setJobProgress(job, ctx.jobId, 100)
    const ltxExtendThumbUrl = await generateAndUploadThumbnail(
      ltxExtendR2Url,
      ctx.jobId,
      ctx.jobUserId,
    )
    const { ok: ltxExtendOk } = await finalizeJobWithMedia({
      jobId: ctx.jobId,
      jobType: "extend-video",
      result: {
        url: ltxExtendResult.videoUrl,
        cost: ltxExtendResult.cost,
        providerUsed: "ltx-2.3-pro",
      },
      mediaUrl: ltxExtendR2Url,
      extraOutputData: { thumbnailUrl: ltxExtendThumbUrl },
    })
    if (ltxExtendOk) {
      console.log(
        `[worker] Job ${ctx.jobId} completed: ${ltxExtendR2Url} (provider: ltx-2.3-pro, cost: $${ltxExtendResult.cost?.toFixed(6) ?? "N/A"})`,
      )
    }
    return
  }

  // ─── Seedance 2 trim-stitch extend ─────────────────────────────────────
  // Extends ANY video by URL: generate the continuation through the
  // seedance-2 reference-video transport with the bare temporal template,
  // then trim-stitch source+extension into one seamless clip. The template
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // keywords / meta-instructions re-stage the scene; dropping 4 source-tail
  // + 3 extension-head frames removes the duplicated boundary).
  if (provider === "seedance-2-extend") {
    const { video: sourceUrl, prompt: userPrompt, duration, resolution, generateAudio } = job.data as {
      jobId: string
      video: string
      prompt: string
      duration?: number
      resolution?: "480p" | "720p" | "1080p"
      generateAudio?: boolean
    }
    console.log(`[worker] extend-video ${ctx.jobId} (provider: seedance-2-extend)`)

    // Snap into seedance-2's native 4–15s window; the 8s default mirrors the
    // credit reservation's default tier so reserve and generation can't diverge.
    const extSeconds = Math.min(15, Math.max(4, Math.round(duration ?? 8)))

    // The extension must match the SOURCE's shape or the stitch letterboxes.
    // seedance-2 natively accepts aspect_ratio "adaptive" (adopts the
    // reference video's ratio — live-verified: 720×1280 ref → 496×864 out),
    // so this resolves without a probe round-trip; providers without a
    // native token would ffprobe + snap to the closest catalog ratio.
    const aspectRatio = await resolveSourceMatchedAspect("seedance-2", sourceUrl)

    const kiePrompt = `Generate the content after Video 1: ${String(userPrompt ?? "").trim()}`

    await setJobProgress(job, ctx.jobId, 5)
    const seedanceRamp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 75 })
    let gen
    try {
      // NO onTaskCreated on purpose: the KIE task's result is the raw
      // extension clip, NOT the deliverable. Persisting it would let the
      // reconcile cron finalize this extend-video job with the unstitched
      // extension (silent wrong output). If the worker dies mid-wait,
      // BullMQ's stalled-job recovery re-runs the whole handler instead.
      gen = await textToVideo(kiePrompt, "seedance-2", extSeconds, aspectRatio, {
        resolution: resolution ?? "720p",
        generateAudio: generateAudio ?? true,
        referenceVideoUrls: [sourceUrl],
      })
    } finally {
      seedanceRamp.stop()
    }

    // Trim-stitch (SEEDANCE_2_EXTEND_STITCH): combineVideos trims only at
    // clip BOUNDARIES, so trimEndFrames hits the source's tail and
    // trimStartFrames the extension's head; hard cut + timeline-anchored
    // audio fades keep A/V sample-locked. A stitch failure fails the job
    // (full refund) — never deliver the bare extension as the result.
    const stitchedPath = await combineVideos({
      videoUrls: [sourceUrl, gen.url],
      transition: "cut",
      transitionDuration: SEEDANCE_2_EXTEND_STITCH.audioFadeSec,
      audioMode: "crossfade",
      audioCrossfadeCurve: "equal-power",
      trimStartFrames: SEEDANCE_2_EXTEND_STITCH.trimHeadFrames,
      trimEndFrames: SEEDANCE_2_EXTEND_STITCH.trimTailFrames,
    })
    await setJobProgress(job, ctx.jobId, 85)

    const stitchedR2Url = await watermarkLocalVideoAndUpload(
      stitchedPath,
      ctx.jobId,
      ctx.jobUserId,
      ctx.shouldWatermark,
    )
    // combineVideos manages its own temp dir (not cleanupWorkDir-compatible)
    await rm(dirname(stitchedPath), { recursive: true, force: true }).catch(() => {})
    await setJobProgress(job, ctx.jobId, 100)

    const stitchedThumbUrl = await generateAndUploadThumbnail(stitchedR2Url, ctx.jobId, ctx.jobUserId)
    const { ok: seedanceOk } = await finalizeJobWithMedia({
      jobId: ctx.jobId,
      jobType: "extend-video",
      result: { url: stitchedR2Url, cost: gen.cost ?? null, providerUsed: "seedance-2-extend" },
      mediaUrl: stitchedR2Url,
      extraOutputData: {
        thumbnailUrl: stitchedThumbUrl,
        // Raw (unstitched) extension clip — provenance/debug only.
        rawExtensionUrl: gen.url,
      },
    })
    if (seedanceOk) {
      console.log(
        `[worker] Job ${ctx.jobId} completed: ${stitchedR2Url} (provider: seedance-2-extend, cost: $${gen.cost?.toFixed(6) ?? "N/A"})`,
      )
    }
    return
  }

  const { kieTaskId, prompt, model, seeds, quality } = job.data as {
    jobId: string
    kieTaskId: string
    prompt: string
    provider: "veo-extend" | "runway-extend"
    model?: "fast" | "quality"
    seeds?: number
    quality?: "720p" | "1080p"
  }
  console.log(`[worker] extend-video ${ctx.jobId} (provider: ${provider})`)

  // Both extend providers run a long KIE task — wrap in a ramp so the
  // widget bar moves while we wait.
  const extendKind: ProviderKind = provider === "veo-extend" ? "kie-veo" : "kie-runway"
  const extendOnTaskCreated = makeOnTaskCreated(ctx.jobId, extendKind)
  const extendResult = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    async (): Promise<{ url: string; taskId: string | undefined }> => {
      if (provider === "veo-extend") {
        const { resultJson, taskId } = await runVeoExtendTask(kieTaskId, prompt, model, seeds, { onTaskCreated: extendOnTaskCreated })
        const url = resultJson.resultUrls?.[0]
        if (!url) throw new Error("VEO extend succeeded but no URL found")
        return { url, taskId }
      } else {
        const { resultJson, taskId } = await runRunwayExtendTask(kieTaskId, prompt, quality ?? "720p", { onTaskCreated: extendOnTaskCreated })
        const url = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
        if (!url) throw new Error("Runway extend succeeded but no URL found")
        return { url, taskId }
      }
    },
  )
  const videoUrl: string = extendResult.url
  const newTaskId: string | undefined = extendResult.taskId
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(videoUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "extend-video",
    result: { url: videoUrl, cost: null, providerUsed: provider },
    mediaUrl: r2Url,
    extraOutputData: {
      thumbnailUrl: thumbUrl,
      ...(newTaskId && { kieTaskId: newTaskId }),
    },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${provider})`)
}

const handleVideoRetake: HandlerFn = async function handleVideoRetake(job, ctx) {
  const d = job.data as Record<string, unknown>
  console.log(`[worker] video-retake ${ctx.jobId} (provider: ltx-2.3-pro)`)
  // Best-effort progress nudge so the widget bar moves while the long
  // Replicate wait blocks. The 20-min reconcile cron is the safety net
  // if this worker dies mid-wait — the prediction id is persisted by
  // makeOnTaskCreated before we begin waiting.
  await setJobProgress(job, ctx.jobId, 5)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 85 })
  let result
  try {
    result = await runLtxRetake({
      variant: "ltx-2.3-pro",
      video: d.video as string,
      prompt: (d.prompt as string | undefined) ?? "",
      retakeStartTime: d.retake_start_time as number,
      retakeDuration: d.retake_duration as number,
      retakeMode: d.retake_mode as "replace_audio" | "replace_video" | "replace_audio_and_video",
      resolution: "1080p",
      aspectRatio: (d.aspect_ratio as "16:9" | "9:16" | undefined) ?? "16:9",
      fps: (d.fps as 24 | 25 | 48 | 50 | undefined) ?? 25,
      generateAudio: (d.generate_audio as boolean | undefined) ?? true,
      cameraMotion: (d.camera_motion as
        | "dolly_in" | "dolly_out" | "dolly_left" | "dolly_right"
        | "jib_up" | "jib_down" | "static" | "focus_shift" | "none"
        | undefined) ?? "none",
      reconcileOpts: {
        onTaskCreated: makeOnTaskCreated(ctx.jobId, providerKindForVideoModel("ltx-2.3-pro")),
      },
    })
  } finally {
    ramp.stop()
  }

  const r2Url = await uploadVideoMaybeWatermark(
    result.videoUrl,
    ctx.jobId,
    ctx.jobUserId,
    ctx.shouldWatermark,
  )
  await setJobProgress(job, ctx.jobId, 100)
  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "video-retake",
    result: {
      url: result.videoUrl,
      cost: result.cost,
      providerUsed: "ltx-2.3-pro",
    },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl },
  })
  if (ok) {
    console.log(
      `[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ltx-2.3-pro, cost: $${result.cost?.toFixed(6) ?? "N/A"})`,
    )
  }
}

const handleFaceSwap: HandlerFn = async function handleFaceSwap(job, ctx) {
  const { faceImageUrl, videoUrl } = job.data as {
    jobId: string
    faceImageUrl: string
    videoUrl: string
  }
  console.log(`[worker] face-swap ${ctx.jobId}`)

  const faceSwapOnTaskCreated = makeOnTaskCreated(ctx.jobId, "replicate-prediction")
  const outputUrl = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 45 }, async () => {
    const { videoUrl: out } = await replicateFaceSwap(faceImageUrl, videoUrl, { onTaskCreated: faceSwapOnTaskCreated })
    return out
  })
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(outputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "video-to-video",
    result: { url: outputUrl, cost: null, providerUsed: "roop" },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleGenerateMask: HandlerFn = async function handleGenerateMask(job, ctx) {
  const { imageUrl, prompt, threshold } = job.data as {
    jobId: string
    imageUrl: string
    prompt: string
    threshold?: number
  }
  console.log(`[worker] generate-mask ${ctx.jobId}: "${prompt}" (threshold: ${threshold ?? 0.3})`)

  // Grounded SAM doesn't expose live progress — wrap in a ramp so the widget
  // bar moves while the segmentation runs.
  const maskOnTaskCreated = makeOnTaskCreated(ctx.jobId, "replicate-prediction")
  const maskOutputUrl = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 80 }, () =>
    runGroundedSam(imageUrl, prompt, threshold ?? 0.3, config.REPLICATE_API_TOKEN, { onTaskCreated: maskOnTaskCreated }),
  )
  await setJobProgress(job, ctx.jobId, 85)

  // Upload the mask PNG to R2. Masks are intermediate artifacts (consumed by a
  // downstream inpainting node), not gallery content — never watermark them or
  // a watermark overlay would corrupt the binary mask.
  // POST-PROVIDER: `maskOutputUrl` is the delivered grounded-sam result — an R2
  // upload failure here is post-delivery, so skip the refund.
  const maskUrl = await runPostProcessing(() => uploadToR2(maskOutputUrl, ctx.jobId, "image", ctx.jobUserId))
  await setJobProgress(job, ctx.jobId, 100)

  // generate-mask outputs a {imageUrl, maskUrl} pair, not the standard single
  // imageUrl. Use markJobCompleted directly here rather than finalize — the
  // dispatch by jobType in finalize would mis-shape the output_data for masks.
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { imageUrl, maskUrl },
    provider: "grounded-sam",
    provider_cost: null,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: mask=${maskUrl}`)
}

// ── Voiced video (character-voice orchestration) ─────────────────────────────
// One job, one combined reservation. Two modes, chosen by the model's audio
// capability (the route already gated this via videoModelCanSpeakDialogue):
//   audio_driven (Seedance 2) -> synthesise the dialogue track (direct ElevenLabs
//     TTS for single / library / custom voices; Dialogue v3 only for all-premade
//     multi-speaker), feed it as reference audio, model lip-syncs.
//   native_speech (VEO)       -> bake the line during generation, then revoice the
//     baked audio to the primary character voice (keeps the music/SFX bed).
// The voice chain NEVER hard-fails the clip: a synth / revoice failure degrades to
// a plain silent clip + a `voiceWarning`, and the audio addon auto-refunds. If no
// voice resolves for the mode the clip still generates and the audio addon
// auto-refunds (finalize commits at the video provider cost only). No provider
// call is registered for reconcile: a worker crash re-runs the whole chain on
// BullMQ retry (credits reserve-once / commit-once; only the provider spend
// repeats), with the 30-min pre-task sync-sweep as the fail+refund backstop. A
// distinct job NAME ("voiced-video") drives handler dispatch; the row keeps
// job_type via the worker CAS, but finalize/asset both key off the passed
// jobType + output_data, so the deliverable is always handled as a video.

const MAX_DIALOGUE_CHARS = 5000 // total-text cap for synthesis (Dialogue v3 / direct TTS)

/** Trim resolved lines to the synthesis char budget; logs any drop (no silent cap). */
function capDialogueLines(lines: ResolvedDialogueVoiceLine[], jobId: string): ResolvedDialogueVoiceLine[] {
  let total = 0
  const out: ResolvedDialogueVoiceLine[] = []
  for (const l of lines) {
    if (total + l.text.length > MAX_DIALOGUE_CHARS) break
    total += l.text.length
    out.push(l)
  }
  if (out.length < lines.length) {
    console.warn(`[worker] voiced-video ${jobId}: dropped ${lines.length - out.length} dialogue line(s) over the ${MAX_DIALOGUE_CHARS}-char Dialogue v3 cap`)
  }
  return out
}

/** Revoice a generated clip to `voiceId` (extract -> speech-to-speech -> remux), keeping the bed. */
async function revoiceClipToR2(
  job: Parameters<HandlerFn>[0],
  ctx: Parameters<HandlerFn>[1],
  videoUrl: string,
  voiceId: string,
): Promise<string> {
  const { audioPath, workDir } = await extractAudioTrack(videoUrl)
  let revoicedR2: string
  try {
    const src = await readFile(audioPath)
    const revoiced = await withProgressRamp(job, ctx.jobId, { start: 55, cap: 80 },
      () => directVoiceChanger(src, voiceId, { removeBackgroundNoise: false }))
    // POST-PROVIDER: speech-to-speech already delivered (billed) — skip refund on R2 fail.
    revoicedR2 = await runPostProcessing(() => uploadBufferToR2(revoiced, `audio/${ctx.jobId}.mp3`, "audio/mpeg", ctx.jobUserId))
  } finally {
    await cleanupWorkDir(workDir)
  }
  const mergedPath = await mergeVideoAudio({
    videoUrl,
    audioTracks: [{ url: revoicedR2, startTime: 0, volume: 100, sourceType: "audio" }],
    keepOriginalAudio: false,
  })
  const out = await watermarkLocalVideoAndUpload(mergedPath, `${ctx.jobId}-revoiced`, ctx.jobUserId, ctx.shouldWatermark)
  await cleanupWorkDir(dirname(mergedPath))
  return out
}

/**
 * Synthesise the resolved dialogue into ONE reference-audio track (R2 URL) for the
 * audio_driven (Seedance) path. KIE's Dialogue v3 only accepts ~21 PREMADE voice
 * NAMES, so it's used ONLY for genuine multi-speaker where every voice is
 * KIE-premade. Otherwise (single voice, or ANY library / custom voice) we go
 * through the direct ElevenLabs API — the same path the TTS node uses for
 * library/custom voices (resolves by id, honours `ttsProvider`). This is the fix
 * for the Studio bug: a `library` voice UUID sent to Dialogue v3 was rejected
 * ("Invalid input parameters"). Multiple distinct non-premade voices degrade to
 * the primary voice (best-effort; proper per-voice multi-speaker needs per-line
 * concat — fast-follow).
 */
async function synthesizeDialogueTrack(
  ctx: Parameters<HandlerFn>[1],
  resolved: ResolvedDialogueVoiceLine[],
  voices: readonly CharacterVoiceSpec[],
  languageCode: string | undefined,
): Promise<string> {
  const distinctVoices = new Set(resolved.map((r) => r.voice))
  const allPremade = resolved.every((r) => isKieAcceptedVoice(r.voice))
  if (distinctVoices.size > 1 && allPremade) {
    // Genuine multi-speaker, every voice KIE-premade → Dialogue v3 (one call).
    const dia = await new KieAudioProvider().generateDialogue(
      resolved.map((r) => ({ text: r.text, voice: r.voice })),
      languageCode ? { languageCode } : undefined,
    )
    return runPostProcessing(() => uploadToR2(dia.url, ctx.jobId, "audio", ctx.jobUserId))
  }
  // Single voice OR any library/custom voice → direct ElevenLabs TTS (supports
  // library/custom by id; premade names resolve too). Honour the voice's ttsProvider.
  const ttsProvider = voices[0]?.ttsProvider
  const joined = resolved.map((r) => r.text).join(" ")
  const processed = ttsProvider === "elevenlabs-v3" ? joined : stripAudioTags(joined)
  const buf = await directElevenLabsTTS(processed, resolved[0]!.voice, ttsProvider, {
    allowDefaultVoiceFallback: true,
  })
  return runPostProcessing(() =>
    uploadBufferToR2(buf, `audio/${ctx.jobId}.mp3`, "audio/mpeg", ctx.jobUserId),
  )
}

const handleVoicedVideo: HandlerFn = async function handleVoicedVideo(job, ctx) {
  const d = job.data as {
    jobId: string
    imageUrl?: string
    prompt?: string
    provider?: string
    duration?: number
    resolution?: string
    aspectRatio?: string
    seed?: number
    negativePrompt?: string
    sound?: boolean
    generateAudio?: boolean
    referenceImageUrls?: string[]
    languageCode?: string
    characterVoices?: CharacterVoiceSpec[]
    dialogue?: DialogueLine[]
    voicedAudioAddon?: number
  }
  const provider = d.provider ?? "minimax"
  const audioAddon = d.voicedAudioAddon ?? 0
  const mode = getVideoAudioCapability(provider).mode

  const lines = d.dialogue && d.dialogue.length > 0 ? d.dialogue : parseAttributedDialogue(d.prompt ?? "")
  const voices = d.characterVoices ?? []
  const primaryVoiceId = voices[0]?.voiceId
  const resolved = capDialogueLines(resolveDialogueVoices(lines, voices, primaryVoiceId), ctx.jobId)

  console.log(`[worker] voiced-video ${ctx.jobId} (provider: ${provider}, mode: ${mode}, lines: ${resolved.length})`)
  await setJobProgress(job, ctx.jobId, 5)

  let result: Awaited<ReturnType<typeof imageToVideo>> | undefined
  let finalUrl: string | undefined
  let voiceApplied = false
  let voiceWarning: string | undefined

  if (mode === "audio_driven" && resolved.length > 0) {
    // Synthesise the dialogue track (voiceType-aware) -> reference audio -> lip-sync.
    // Any failure in this chain degrades to a plain silent clip below rather than
    // hard-failing the job (the Studio-reported contract violation).
    try {
      const trackUrl = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 30 },
        () => synthesizeDialogueTrack(ctx, resolved, voices, d.languageCode))
      result = await withProgressRamp(job, ctx.jobId, { start: 30, cap: 90 },
        () => imageToVideo(d.imageUrl, provider, d.prompt, d.duration, undefined,
          { referenceAudioUrls: [trackUrl], generateAudio: false, resolution: d.resolution, aspectRatio: d.aspectRatio, seed: d.seed, negativePrompt: d.negativePrompt, referenceImageUrls: d.referenceImageUrls }))
      finalUrl = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
      voiceApplied = true
    } catch (err) {
      console.warn(`[worker] voiced-video ${ctx.jobId}: audio_driven voice chain failed — falling back to a silent clip: ${err instanceof Error ? err.message : String(err)}`)
      voiceWarning = "voice_chain_failed"
      result = undefined
      finalUrl = undefined
    }
  } else if (mode === "native_speech" && primaryVoiceId) {
    // Bake the line during generation (VEO speaks + lip-syncs), then revoice it.
    // If ONLY the revoice fails, keep the baked clip (it spoke, just not in the
    // exact saved voice) rather than discarding a paid-for generation.
    const spoken = resolved.map((r) => r.text).join(" ").trim()
    const veoPrompt = spoken ? `${(d.prompt ?? "").trim()}\n\nSpoken dialogue: "${spoken}"`.trim() : (d.prompt ?? "")
    result = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 55 },
      () => imageToVideo(d.imageUrl, provider, veoPrompt, d.duration, undefined,
        { generateAudio: true, resolution: d.resolution, aspectRatio: d.aspectRatio, seed: d.seed, negativePrompt: d.negativePrompt }))
    try {
      finalUrl = await revoiceClipToR2(job, ctx, result.url, primaryVoiceId)
      voiceApplied = true
    } catch (err) {
      console.warn(`[worker] voiced-video ${ctx.jobId}: revoice failed — keeping the model's baked audio: ${err instanceof Error ? err.message : String(err)}`)
      voiceWarning = "revoice_failed"
      finalUrl = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
    }
  }

  if (!result || !finalUrl) {
    // No voice resolvable for this mode, OR the audio_driven voice chain failed
    // above -> plain silent clip. The reserved audio addon auto-refunds (finalize
    // commits at the video provider cost only, voiceApplied=false).
    if (!voiceWarning) {
      console.warn(`[worker] voiced-video ${ctx.jobId}: no voice resolved (mode=${mode}); generating without voice`)
    }
    result = await withProgressRamp(job, ctx.jobId, { start: 30, cap: 90 },
      () => imageToVideo(d.imageUrl, provider, d.prompt, d.duration, undefined,
        { generateAudio: d.generateAudio, sound: d.sound, resolution: d.resolution, aspectRatio: d.aspectRatio, seed: d.seed, negativePrompt: d.negativePrompt, referenceImageUrls: d.referenceImageUrls }))
    finalUrl = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
    voiceApplied = false
  }

  await setJobProgress(job, ctx.jobId, 95)
  const thumbUrl = await generateAndUploadThumbnail(finalUrl, ctx.jobId, ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "image-to-video",
    result,
    mediaUrl: finalUrl,
    // Charge the audio step only when it ran; otherwise finalize commits at the
    // video provider cost and the reserved addon is refunded automatically.
    extraNonProviderCredits: voiceApplied ? audioAddon : 0,
    extraOutputData: {
      thumbnailUrl: thumbUrl,
      voiceApplied,
      ...(voiceWarning ? { voiceWarning } : {}),
      ...buildProviderMeta(result),
    },
  })
  if (!ok) return
  console.log(`[worker] voiced-video ${ctx.jobId} completed (voiceApplied=${voiceApplied}${voiceWarning ? `, warning=${voiceWarning}` : ""}): ${finalUrl}`)
}

export const videoAIHandlers: Record<string, HandlerFn> = {
  "image-to-video": handleImageToVideo,
  "voiced-video": handleVoicedVideo,
  "video-to-video": handleVideoToVideo,
  "text-to-video": handleTextToVideo,
  "lip-sync": handleLipSync,
  "speech-to-video": handleSpeechToVideo,
  "motion-transfer": handleMotionTransfer,
  "video-upscale": handleVideoUpscale,
  "extend-video": handleExtendVideo,
  "video-retake": handleVideoRetake,
  "face-swap": handleFaceSwap,
  "generate-mask": handleGenerateMask,
  "ai-avatar": handleAiAvatar,
  "cinematic-avatar": handleCinematicAvatar,
}
