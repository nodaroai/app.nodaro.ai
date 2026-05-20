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
import { replicateFaceSwap } from "../../providers/replicate/face-swap.js"
import { runGroundedSam } from "../../providers/replicate/grounded-sam.js"
import { config } from "../../lib/config.js"
import { REPLICATE_LIP_SYNC_PROVIDERS, SEEDANCE_LIP_SYNC_PROVIDERS, estimateLoopTrimAddonCredits } from "@nodaro/shared"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import {
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  stripAudio,
} from "../../providers/video/ffmpeg-utils.js"
import { applySmartLoopCutToR2Url } from "../../providers/video/apply-smart-loop-cut.js"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { uploadBufferToR2 } from "../../lib/storage.js"

/**
 * VEO3 / VEO3.1 always produce a video with background audio per KIE's
 * docs (no native sound-off flag). When the user passes `sound: false`,
 * we honour intent by stream-copying the video and dropping the audio
 * track, then re-uploading. Cheap (no re-encode).
 */
async function stripAudioFromR2Url(videoUrl: string, jobId: string): Promise<string> {
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
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import {
  providerKindForVideoModel,
  providerKindForLipSyncModel,
  providerKindForVideoToVideoModel,
} from "../../lib/reconcile/provider-kind.js"
import type { ProviderKind } from "../../lib/reconcile/types.js"

const handleImageToVideo: HandlerFn = async function handleImageToVideo(job, ctx) {
  const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, generationType, loopTrim, enableTranslation } = job.data as {
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
  }
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
  let result
  try {
    result = await imageToVideo(imageUrl, resolvedI2vProvider, prompt, duration, endFrameUrl, { onProgress, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShots: multiShot, multiPrompt, klingElements, resolution, grokMode, seed, cameraFixed, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, generationType, enableTranslation }, { onTaskCreated })
  } finally {
    ramp.stop()
  }

  // Don't write a backward milestone here — KIE (or the ramp) may have
  // already reported 80–90%+, and writing 40% would visibly regress the bar.
  // The upload milestone below (90%) advances past whatever was reported.

  let providerOutputUrl = result.url

  // Generic smart-loop-cut post-process. Runs for any provider when
  // loopTrim.enabled. Failures are non-fatal: keep the un-trimmed output
  // and refund only the addon credits (the i2v base credits stay charged).
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
    } catch (err) {
      console.warn(
        `[worker] smart-loop-cut failed for job ${ctx.jobId}; keeping un-trimmed output:`,
        err,
      )
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
    (provider === "veo3" || provider === "veo3.1" || provider === "veo3_lite")
  ) {
    console.log(
      `[worker] VEO sound=false — stripping audio from output for job ${ctx.jobId}`,
    )
    providerOutputUrl = await stripAudioFromR2Url(providerOutputUrl, ctx.jobId)
  }

  // Upload the generated video to R2
  // If audio merge follows, upload without watermark (watermark applied to final)
  let finalVideoUrl = audioUrl
    ? await uploadToR2(providerOutputUrl, ctx.jobId, "video", ctx.jobUserId)
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
  let result
  try {
    result = await textToVideo(prompt, resolvedT2vProvider, duration, aspectRatio, { mode, sound, negativePrompt, cfgScale, multiShots: multiShot, multiPrompt, klingElements, seed, resolution, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, enableTranslation }, { onTaskCreated: t2vOnTaskCreated })
  } finally {
    t2vRamp.stop()
  }

  // Don't write a backward milestone — the ramp may already be at 80–90%+
  // for long generations. The 100% write after upload will advance past it.

  // VEO3 / VEO3.1: KIE has no native audio toggle, so honour `sound: false`
  // by stripping the audio track post-generation (cheap stream copy).
  let providerOutputUrl = result.url
  if (sound === false && (provider === "veo3" || provider === "veo3.1" || provider === "veo3_lite")) {
    console.log(
      `[worker] VEO sound=false — stripping audio from t2v output for job ${ctx.jobId}`,
    )
    providerOutputUrl = await stripAudioFromR2Url(result.url, ctx.jobId)
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
      { guidanceScale, inferenceSteps, seed, pads, smooth, fps, resizeFactor, enhancer, preprocess, still, poseStyle, expressionScale },
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
  const { imageUrl, videoUrl, prompt, characterOrientation, resolution, provider, backgroundSource } = job.data as {
    jobId: string
    imageUrl: string
    videoUrl: string
    prompt?: string
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
  const { kieTaskId, prompt, provider, model, seeds, quality } = job.data as {
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
  const maskUrl = await uploadToR2(maskOutputUrl, ctx.jobId, "image", ctx.jobUserId)
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

export const videoAIHandlers: Record<string, HandlerFn> = {
  "image-to-video": handleImageToVideo,
  "video-to-video": handleVideoToVideo,
  "text-to-video": handleTextToVideo,
  "lip-sync": handleLipSync,
  "speech-to-video": handleSpeechToVideo,
  "motion-transfer": handleMotionTransfer,
  "video-upscale": handleVideoUpscale,
  "extend-video": handleExtendVideo,
  "face-swap": handleFaceSwap,
  "generate-mask": handleGenerateMask,
}
