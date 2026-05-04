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
import { REPLICATE_LIP_SYNC_PROVIDERS, SEEDANCE_LIP_SYNC_PROVIDERS } from "@nodaro/shared"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import {
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  stripAudio,
  trimLastFrames,
} from "../../providers/video/ffmpeg-utils.js"
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

/**
 * VEO3.1 first+last-frame mode adds a ~333ms cross-fade dissolve at the
 * tail. That breaks loop seamlessness — the last frame of the rendered
 * clip isn't actually identical to the supplied last_frame_url, it's
 * blended. Stripping the last 8 frames @ 24fps recovers a clean
 * frame-perfect loop. Default-on for VEO3.1 + endFrame; the route
 * accepts an `autoLoopTrim: false` opt-out for users who actually want
 * the dissolve. MCP doesn't expose the toggle (always trim).
 */
const VEO_LOOP_TRIM_FRAMES = 8
const VEO_FPS = 24

async function trimVeoLoopTailFromR2Url(
  videoUrl: string,
  jobId: string,
): Promise<string> {
  let workDir: string | undefined
  try {
    workDir = await createWorkDir("veo3-loop-trim")
    const inputPath = join(workDir, "in.mp4")
    const outputPath = join(workDir, "out.mp4")
    await downloadFile(videoUrl, inputPath)
    await trimLastFrames(inputPath, outputPath, VEO_LOOP_TRIM_FRAMES, VEO_FPS)
    const buffer = await readFile(outputPath)
    const key = `videos/${jobId}-loop.mp4`
    return await uploadBufferToR2(buffer, key, "video/mp4")
  } finally {
    if (workDir) await cleanupWorkDir(workDir)
  }
}
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  uploadVideoMaybeWatermark,
  watermarkLocalVideoAndUpload,
  generateAndUploadThumbnail,
  setJobProgress,
  startProgressRamp,
  withProgressRamp,
  type HandlerFn,
} from "../shared.js"

const handleImageToVideo: HandlerFn = async function handleImageToVideo(job, ctx) {
  const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, generationType, autoLoopTrim } = job.data as {
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
    /** VEO3.1 first+last-frame mode adds a tail dissolve that breaks
     *  loop seams. Default true: strip the last 8 frames so the rendered
     *  end matches the supplied last_frame_url frame-perfectly. */
    autoLoopTrim?: boolean
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

  // Fallback ramp for providers that DON'T expose live progress through
  // KIE's progress field (Seedance, some Wan / Hailuo variants). Without
  // this the bar pinned at 0% for the entire 30s–2min generation, then
  // jumped to 40 only at completion. When onProgress fires real values,
  // they'll outrun the ramp anyway since the ramp caps at 35.
  await setJobProgress(job, ctx.jobId, 5)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 35 })

  let result
  try {
    result = await imageToVideo(imageUrl, provider ?? "minimax", prompt, duration, endFrameUrl, { onProgress, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShots: multiShot, multiPrompt, klingElements, resolution, grokMode, seed, cameraFixed, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, generationType })
  } finally {
    ramp.stop()
  }

  await setJobProgress(job, ctx.jobId, 40)

  let providerOutputUrl = result.url

  // VEO3.1 loop trim — first+last-frame renders include a ~333ms tail
  // dissolve that breaks loop seamlessness. Strip the last 8 frames @
  // 24fps when both frames are supplied AND the user didn't opt out.
  // Default-on; autoLoopTrim=false disables. Only veo3.1 — VEO3 (no
  // .1) hasn't been tested for the same artefact.
  if (
    provider === "veo3.1" &&
    endFrameUrl &&
    autoLoopTrim !== false
  ) {
    console.log(
      `[worker] VEO3.1 loop trim — removing last 8 frames for job ${ctx.jobId}`,
    )
    providerOutputUrl = await trimVeoLoopTailFromR2Url(providerOutputUrl, ctx.jobId)
  }

  // VEO3 / VEO3.1 ignore the `sound: false` request (KIE has no audio
  // toggle for VEO). Honour user intent post-hoc: strip the audio track
  // from the result before R2 upload. Skipped when an explicit audioUrl
  // was provided (the merge step downstream handles that case).
  if (
    sound === false &&
    !audioUrl &&
    (provider === "veo3" || provider === "veo3.1")
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
  await setJobProgress(job, ctx.jobId, 70)

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
    await setJobProgress(job, ctx.jobId, 90)

    // Upload merged video (with watermark if applicable)
    finalVideoUrl = await watermarkLocalVideoAndUpload(mergedPath, `${ctx.jobId}-merged`, ctx.jobUserId, ctx.shouldWatermark)
    await cleanupWorkDir(dirname(mergedPath))
  }

  await setJobProgress(job, ctx.jobId, 100)

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

  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => videoToVideo(videoUrl, provider ?? "wan", prompt, {
      duration,
      resolution,
      audio,
      multiShots,
      aspectRatio,
      seed,
      referenceImageUrl,
    }),
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

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

  // Same fallback ramp as i2v — covers t2v providers that don't expose
  // KIE progress (Seedance, some Wan / Hailuo) so the widget shows
  // movement instead of pinning at 0%.
  await setJobProgress(job, ctx.jobId, 5)
  const t2vRamp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 40 })
  let result
  try {
    result = await textToVideo(prompt, provider ?? "minimax", duration, aspectRatio, { mode, sound, negativePrompt, cfgScale, multiShots: multiShot, multiPrompt, klingElements, seed, resolution, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker })
  } finally {
    t2vRamp.stop()
  }

  await setJobProgress(job, ctx.jobId, 50)

  // VEO3 / VEO3.1: KIE has no native audio toggle, so honour `sound: false`
  // by stripping the audio track post-generation (cheap stream copy).
  let providerOutputUrl = result.url
  if (sound === false && (provider === "veo3" || provider === "veo3.1")) {
    console.log(
      `[worker] VEO sound=false — stripping audio from t2v output for job ${ctx.jobId}`,
    )
    providerOutputUrl = await stripAudioFromR2Url(result.url, ctx.jobId)
  }

  const r2Url = await uploadVideoMaybeWatermark(providerOutputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

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

  try {

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
    )
    resultUrl = result.url
    resultCost = result.cost
    resultDisplayCost = result.displayCost
    resultProviderUsed = result.providerUsed
  } else {
    // KIE path (existing)
    const result = await lipSync(imageUrl!, audioUrl, resolvedProvider, prompt, resolution)
    resultUrl = result.url
    resultCost = result.cost
    resultDisplayCost = result.displayCost
    resultProviderUsed = result.providerUsed
  }
  } finally {
    lipSyncRamp.stop()
  }

  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(resultUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

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
    }),
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

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
      }
    ),
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

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

  // Wrap each branch in a progress ramp — none of these (VEO upscale,
  // Topaz, etc.) reliably surface live progress; without the ramp the
  // bar pins for the whole upscale duration.
  const outputUrl: string = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    async () => {
      if (upscaleProvider === "veo-1080p" && kieTaskId) {
        const result = await runVeo1080pTask(kieTaskId)
        return result.url
      } else if (upscaleProvider === "veo-4k" && kieTaskId) {
        const { resultJson } = await runVeo4kTask(kieTaskId)
        const url = resultJson.resultUrls?.[0]
        if (!url) throw new Error("VEO 4K succeeded but no URL found")
        return url
      } else {
        if (!videoUrl) throw new Error("videoUrl is required for Topaz upscale")
        const onProgress: ProgressCallback = async (progress: number) => {
          console.log(`[worker] Job ${ctx.jobId} video-upscale progress: ${progress}%`)
          await supabase.from("jobs").update({ progress }).eq("id", ctx.jobId)
        }
        const result = await videoUpscale(videoUrl, "topaz", upscaleFactor ?? "2", { onProgress })
        return result.url
      }
    },
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(outputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

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

  // Both extend providers run a long KIE task — wrap in a ramp so the
  // widget bar moves while we wait.
  const extendResult = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    async (): Promise<{ url: string; taskId: string | undefined }> => {
      if (provider === "veo-extend") {
        const { resultJson, taskId } = await runVeoExtendTask(kieTaskId, prompt, model, seeds)
        const url = resultJson.resultUrls?.[0]
        if (!url) throw new Error("VEO extend succeeded but no URL found")
        return { url, taskId }
      } else {
        const { resultJson, taskId } = await runRunwayExtendTask(kieTaskId, prompt, quality ?? "720p")
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
