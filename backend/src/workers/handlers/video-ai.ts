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
import { extractSoraCharacter } from "../../providers/kie/character.js"
import { runRunwayExtendTask } from "../../providers/kie/runway-client.js"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { cleanupWorkDir } from "../../providers/video/ffmpeg-utils.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  uploadVideoMaybeWatermark,
  watermarkLocalVideoAndUpload,
  generateAndUploadThumbnail,
  type HandlerFn,
} from "../shared.js"

const handleImageToVideo: HandlerFn = async function handleImageToVideo(job, ctx) {
  const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, removeWatermark, characterIdList } = job.data as {
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
    removeWatermark?: boolean
    characterIdList?: string[]
  }
  console.log(`[worker] image-to-video ${ctx.jobId} (provider: ${provider ?? "minimax"})${endFrameUrl ? " [with end frame]" : ""}${audioUrl ? " [with audio]" : ""}${removeWatermark ? " [remove watermark]" : ""}`)

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

  const result = await imageToVideo(imageUrl, provider ?? "minimax", prompt, duration, endFrameUrl, { onProgress, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShots: multiShot, multiPrompt, klingElements, resolution, grokMode, videoSize, seed, cameraFixed, generateAudio, characterIdList })

  // Sora 2 watermark removal post-processing step
  if (removeWatermark && (provider === "sora2" || provider === "sora2-pro")) {
    const kieTaskId = result.kieTaskId as string | undefined
    if (kieTaskId) {
      console.log(`[worker] Running Sora 2 watermark removal for task ${kieTaskId}`)
      const { runKieTask } = await import("../../providers/kie/client.js")
      const { resultJson } = await runKieTask("sora-2-watermark-remove", { task_id: kieTaskId }, 120)
      const cleanUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (cleanUrl) {
        console.log(`[worker] Watermark removed: ${cleanUrl}`)
        result.url = cleanUrl
      } else {
        console.warn(`[worker] Watermark removal succeeded but no URL returned, using original`)
      }
    } else {
      console.warn(`[worker] removeWatermark requested but no kieTaskId available (provider: ${provider})`)
    }
  }

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

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: {
        videoUrl: finalVideoUrl,
        thumbnailUrl: thumbUrl,
        ...(result.kieTaskId && { kieTaskId: result.kieTaskId }),
      },
      completed_at: new Date().toISOString(),
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    })
    .eq("id", ctx.jobId)

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

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
      completed_at: new Date().toISOString(),
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    })
    .eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleTextToVideo: HandlerFn = async function handleTextToVideo(job, ctx) {
  const { prompt, provider, duration, mode, sound, negativePrompt, cfgScale, aspectRatio, multiShot, shots, elements, removeWatermark, seed, characterIdList } = job.data as {
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
  }
  console.log(`[worker] text-to-video ${ctx.jobId} (provider: ${provider ?? "minimax"})${removeWatermark ? " [remove watermark]" : ""}`)

  // Map frontend shots/elements to provider format for Kling 3.0
  const multiPrompt = shots?.map((s) => ({ prompt: s.prompt, duration: s.duration }))
  const klingElements = elements?.map((el) => ({
    name: el.name,
    description: el.description,
    ...(el.type === "image" ? { element_input_urls: el.urls } : { element_input_video_urls: el.urls }),
  }))

  const result = await textToVideo(prompt, provider ?? "minimax", duration, aspectRatio, { mode, sound, negativePrompt, cfgScale, multiShots: multiShot, multiPrompt, klingElements, seed, characterIdList })

  // Sora 2 watermark removal post-processing step
  if (removeWatermark && (provider === "sora2" || provider === "sora2-pro")) {
    const kieTaskId = result.kieTaskId as string | undefined
    if (kieTaskId) {
      console.log(`[worker] Running Sora 2 watermark removal for task ${kieTaskId}`)
      const { runKieTask } = await import("../../providers/kie/client.js")
      const { resultJson } = await runKieTask("sora-2-watermark-remove", { task_id: kieTaskId }, 120)
      const cleanUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (cleanUrl) {
        console.log(`[worker] Watermark removed: ${cleanUrl}`)
        result.url = cleanUrl
      } else {
        console.warn(`[worker] Watermark removal succeeded but no URL returned, using original`)
      }
    } else {
      console.warn(`[worker] removeWatermark requested but no kieTaskId available (provider: ${provider})`)
    }
  }

  await job.updateProgress(50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: {
        videoUrl: r2Url,
        thumbnailUrl: thumbUrl,
        ...(result.kieTaskId && { kieTaskId: result.kieTaskId }),
      },
      completed_at: new Date().toISOString(),
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    })
    .eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleLipSync: HandlerFn = async function handleLipSync(job, ctx) {
  const { imageUrl, audioUrl, prompt, provider, resolution } = job.data as {
    jobId: string
    imageUrl: string
    audioUrl: string
    prompt?: string
    provider?: string
    resolution?: string
  }
  console.log(`[worker] lip-sync ${ctx.jobId} (provider: ${provider ?? "kling-avatar"})`)

  const result = await lipSync(imageUrl, audioUrl, provider ?? "kling-avatar", prompt, resolution)
  await job.updateProgress(50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
      completed_at: new Date().toISOString(),
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    })
    .eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
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

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
      completed_at: new Date().toISOString(),
      provider: "kie",
      provider_cost: result.cost,
    })
    .eq("id", ctx.jobId)

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

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
    completed_at: new Date().toISOString(),
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  }).eq("id", ctx.jobId)

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

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
    completed_at: new Date().toISOString(),
    provider: upscaleProvider,
    provider_cost: null,
  }).eq("id", ctx.jobId)

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

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: {
      videoUrl: r2Url,
      thumbnailUrl: thumbUrl,
      ...(newTaskId && { kieTaskId: newTaskId }),
    },
    completed_at: new Date().toISOString(),
    provider,
    provider_cost: null,
  }).eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${provider})`)
}

const handleSoraStoryboard: HandlerFn = async function handleSoraStoryboard(job, ctx) {
  const { shots, nFrames, imageUrls, aspectRatio, characterIdList } = job.data as {
    jobId: string
    shots: Array<{ scene: string; duration: number }>
    nFrames?: string
    imageUrls?: string[]
    aspectRatio?: string
    characterIdList?: string[]
  }
  console.log(`[worker] sora-storyboard ${ctx.jobId} (nFrames: ${nFrames ?? "10"}, shots: ${shots.length})`)

  const { KieVideoProvider } = await import("../../providers/kie/video.js")
  const kieVideo = new KieVideoProvider()

  const onProgress: ProgressCallback = async (progress: number) => {
    console.log(`[worker] Job ${ctx.jobId} sora-storyboard progress: ${progress}%`)
    await supabase.from("jobs").update({ progress }).eq("id", ctx.jobId)
  }

  const result = await kieVideo.soraStoryboard(shots, nFrames, imageUrls, aspectRatio, onProgress, characterIdList)
  await job.updateProgress(50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
    completed_at: new Date().toISOString(),
    provider: "kie",
    provider_cost: result.cost,
  }).eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: kie, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleSoraCharacter: HandlerFn = async function handleSoraCharacter(job, ctx) {
  const { mode, characterPrompt, characterName, timestamps, safetyInstruction, videoUrl, kieTaskId } = job.data as {
    jobId: string
    mode: "video" | "sora-task"
    characterPrompt: string
    characterName?: string
    timestamps?: string
    safetyInstruction?: string
    videoUrl?: string
    kieTaskId?: string
  }
  console.log(`[worker] sora-character ${ctx.jobId} (mode: ${mode})`)

  const result = await extractSoraCharacter(mode, characterPrompt, {
    videoUrl,
    kieTaskId,
    characterName,
    timestamps,
    safetyInstruction,
  })
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { characterId: result.characterId },
    completed_at: new Date().toISOString(),
    provider: "kie",
    provider_cost: result.cost,
  }).eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: characterId=${result.characterId} (provider: kie, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
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
  "sora-storyboard": handleSoraStoryboard,
  "sora-character": handleSoraCharacter,
}
