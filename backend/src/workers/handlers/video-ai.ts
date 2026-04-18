import { dirname } from "node:path"
import { supabase } from "../../lib/supabase.js"
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
import { REPLICATE_LIP_SYNC_PROVIDERS } from "../../../../packages/shared/src/model-constants.js"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { cleanupWorkDir } from "../../providers/video/ffmpeg-utils.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  uploadVideoMaybeWatermark,
  watermarkLocalVideoAndUpload,
  generateAndUploadThumbnail,
  type HandlerFn,
} from "../shared.js"

const handleImageToVideo: HandlerFn = async function handleImageToVideo(job, ctx) {
  const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, generationType } = job.data as {
    jobId: string
    imageUrl: string
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
  }
  console.log(`[worker] image-to-video ${ctx.jobId} (provider: ${provider ?? "minimax"})${endFrameUrl ? " [with end frame]" : ""}${audioUrl ? " [with audio]" : ""}`)

  // Map frontend shots/elements to provider format for Kling 3.0
  const multiPrompt = shots?.map((s) => ({ prompt: s.prompt, duration: s.duration }))
  const klingElements = elements?.map((el) => ({
    name: el.name,
    description: el.description,
    ...(el.type === "image" ? { element_input_urls: el.urls } : { element_input_video_urls: el.urls }),
  }))

  // Create progress callback that updates the job record in the database
  const onProgress: ProgressCallback = async (progress: number) => {
    console.log(`[worker] Job ${ctx.jobId} progress: ${progress}%`)
    await supabase.from("jobs").update({ progress }).eq("id", ctx.jobId)
  }

  const result = await imageToVideo(imageUrl, provider ?? "minimax", prompt, duration, endFrameUrl, { onProgress, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShots: multiShot, multiPrompt, klingElements, resolution, grokMode, seed, cameraFixed, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, generationType })

  await job.updateProgress(40)

  // Upload the generated video to R2
  // If audio merge follows, upload without watermark (watermark applied to final)
  let finalVideoUrl = audioUrl
    ? await uploadToR2(result.url, ctx.jobId, "video", ctx.jobUserId)
    : await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(70)

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
    await job.updateProgress(90)

    // Upload merged video (with watermark if applicable)
    finalVideoUrl = await watermarkLocalVideoAndUpload(mergedPath, `${ctx.jobId}-merged`, ctx.jobUserId, ctx.shouldWatermark)
    await cleanupWorkDir(dirname(mergedPath))
  }

  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(finalVideoUrl, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: {
      videoUrl: finalVideoUrl,
      thumbnailUrl: thumbUrl,
      ...(result.kieTaskId && { kieTaskId: result.kieTaskId }),
    },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${finalVideoUrl} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleVideoToVideo: HandlerFn = async function handleVideoToVideo(job, ctx) {
  const { videoUrl, prompt, provider, duration, resolution, audio, multiShots, aspectRatio, seed, referenceImageUrl } = job.data as {
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
  }
  console.log(`[worker] video-to-video ${ctx.jobId} (provider: ${provider ?? "wan"})`)

  const result = await videoToVideo(videoUrl, provider ?? "wan", prompt, {
    duration,
    resolution,
    audio,
    multiShots,
    aspectRatio,
    seed,
    referenceImageUrl,
  })
  await job.updateProgress(50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleTextToVideo: HandlerFn = async function handleTextToVideo(job, ctx) {
  const { prompt, provider, duration, mode, sound, negativePrompt, cfgScale, aspectRatio, multiShot, shots, elements, removeWatermark, seed, characterIdList, resolution, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker } = job.data as {
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
  }
  console.log(`[worker] text-to-video ${ctx.jobId} (provider: ${provider ?? "minimax"})${removeWatermark ? " [remove watermark]" : ""}`)

  // Map frontend shots/elements to provider format for Kling 3.0
  const multiPrompt = shots?.map((s) => ({ prompt: s.prompt, duration: s.duration }))
  const klingElements = elements?.map((el) => ({
    name: el.name,
    description: el.description,
    ...(el.type === "image" ? { element_input_urls: el.urls } : { element_input_video_urls: el.urls }),
  }))

  const result = await textToVideo(prompt, provider ?? "minimax", duration, aspectRatio, { mode, sound, negativePrompt, cfgScale, multiShots: multiShot, multiPrompt, klingElements, seed, resolution, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker })

  await job.updateProgress(50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: {
      videoUrl: r2Url,
      thumbnailUrl: thumbUrl,
      ...(result.kieTaskId && { kieTaskId: result.kieTaskId }),
    },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleLipSync: HandlerFn = async function handleLipSync(job, ctx) {
  const {
    imageUrl, videoUrl, audioUrl, prompt, provider, resolution,
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

  let resultUrl: string
  let resultCost: number | null = null
  let resultDisplayCost: number | null = null
  let resultProviderUsed: string = resolvedProvider

  if (REPLICATE_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    // Replicate path
    const faceUrl = videoUrl || imageUrl
    if (!faceUrl) throw new Error("No face input (imageUrl or videoUrl) provided")

    const { videoUrl: outUrl, cost } = await replicateLipSync(
      resolvedProvider,
      faceUrl,
      audioUrl,
      { guidanceScale, inferenceSteps, seed, pads, smooth, fps, resizeFactor, enhancer, preprocess, still, poseStyle, expressionScale },
    )
    resultUrl = outUrl
    resultCost = cost
    resultDisplayCost = cost
    resultProviderUsed = `replicate:${resolvedProvider}`
  } else {
    // KIE path (existing)
    const result = await lipSync(imageUrl!, audioUrl, resolvedProvider, prompt, resolution)
    resultUrl = result.url
    resultCost = result.cost
    resultDisplayCost = result.displayCost
    resultProviderUsed = result.providerUsed
  }

  await job.updateProgress(50)

  const r2Url = await uploadVideoMaybeWatermark(resultUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
    provider: resultProviderUsed,
    provider_cost: resultCost,
    display_cost: resultDisplayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, resultCost)
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
  const result = await kieVideo.speechToVideo(imageUrl, audioUrl, prompt, resolution, {
    negativePrompt,
    seed,
    numFrames,
    fps,
    inferenceSteps,
    guidanceScale,
    shift,
  })
  await job.updateProgress(50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
    provider: "kie",
    provider_cost: result.cost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
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
    await supabase.from("jobs").update({ progress }).eq("id", ctx.jobId)
  }

  const result = await motionTransfer(
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
    }
  )
  await job.updateProgress(50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
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

  let outputUrl: string

  if (upscaleProvider === "veo-1080p" && kieTaskId) {
    const result = await runVeo1080pTask(kieTaskId)
    outputUrl = result.url
  } else if (upscaleProvider === "veo-4k" && kieTaskId) {
    const { resultJson } = await runVeo4kTask(kieTaskId)
    const url = resultJson.resultUrls?.[0]
    if (!url) throw new Error("VEO 4K succeeded but no URL found")
    outputUrl = url
  } else {
    // Topaz upscale (original path)
    if (!videoUrl) throw new Error("videoUrl is required for Topaz upscale")
    const onProgress: ProgressCallback = async (progress: number) => {
      console.log(`[worker] Job ${ctx.jobId} video-upscale progress: ${progress}%`)
      await supabase.from("jobs").update({ progress }).eq("id", ctx.jobId)
    }
    const result = await videoUpscale(videoUrl, "topaz", upscaleFactor ?? "2", { onProgress })
    outputUrl = result.url
  }
  await job.updateProgress(50)

  const r2Url = await uploadVideoMaybeWatermark(outputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
    provider: upscaleProvider,
    provider_cost: null,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
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

  let videoUrl: string
  let newTaskId: string | undefined

  if (provider === "veo-extend") {
    const { resultJson, taskId } = await runVeoExtendTask(kieTaskId, prompt, model, seeds)
    const url = resultJson.resultUrls?.[0]
    if (!url) throw new Error("VEO extend succeeded but no URL found")
    videoUrl = url
    newTaskId = taskId
  } else {
    // runway-extend
    const { resultJson, taskId } = await runRunwayExtendTask(kieTaskId, prompt, quality ?? "720p")
    const url = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!url) throw new Error("Runway extend succeeded but no URL found")
    videoUrl = url
    newTaskId = taskId
  }
  await job.updateProgress(50)

  const r2Url = await uploadVideoMaybeWatermark(videoUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: {
      videoUrl: r2Url,
      thumbnailUrl: thumbUrl,
      ...(newTaskId && { kieTaskId: newTaskId }),
    },
    provider,
    provider_cost: null,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${provider})`)
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
}
