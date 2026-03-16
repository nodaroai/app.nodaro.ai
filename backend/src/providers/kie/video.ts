/**
 * KIE.ai Video Provider
 *
 * Implements ImageToVideoProvider, TextToVideoProvider, VideoToVideoProvider,
 * MotionTransferProvider, VideoUpscaleProvider, and LipSyncProvider interfaces.
 * Extracted from services/kie-ai.ts.
 */

import type {
  ImageToVideoProvider,
  TextToVideoProvider,
  VideoToVideoProvider,
  MotionTransferProvider,
  VideoUpscaleProvider,
  LipSyncProvider,
  ProviderResult,
  ProviderOptions,
} from "../provider.interface.js"
import {
  createSanitizedError,
  runKieTask,
  runVeoTask,
  MAX_POLL_ATTEMPTS_VIDEO,
} from "./client.js"
import { kling3Generate } from "./kling3-client.js"
import { runRunwayTask, runAlephTask } from "./runway-client.js"
import { runLumaModifyTask } from "./luma-client.js"
import {
  KIE_VIDEO_MODELS,
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_TO_VIDEO_MODELS,
  KIE_MOTION_TRANSFER_MODELS,
  KIE_VIDEO_UPSCALE_MODELS,
  KIE_LIP_SYNC_MODELS,
  KIE_SPEECH_TO_VIDEO_MODELS,
  KIE_STORYBOARD_MODELS,
  durationToNFrames,
} from "./models.js"
import { logCreditAudit, extractCreditFields } from "../../lib/credit-audit.js"
import { downloadFile, runFfmpeg, getVideoDuration, createWorkDir, cleanupWorkDir } from "../video/ffmpeg-utils.js"
import { uploadBufferToR2 } from "../../lib/storage.js"
import { join } from "node:path"
import { readFile } from "node:fs/promises"

// Sora models use named aspect ratio values instead of ratio strings
const SORA_ASPECT_RATIO_MAP: Record<string, string> = {
  "16:9": "landscape",
  "9:16": "portrait",
  "1:1": "square",
}

function mapAspectRatio(provider: string, aspectRatio: string): string {
  if (provider.startsWith("sora")) {
    return SORA_ASPECT_RATIO_MAP[aspectRatio] ?? aspectRatio
  }
  return aspectRatio
}

// Max audio duration (seconds) per lip-sync model
// KIE.ai lip-sync models enforce a 15-second limit; use 14.5s to avoid
// edge cases where ffprobe and KIE.ai measure duration slightly differently
const LIP_SYNC_MAX_AUDIO_SECONDS = 14.5

/**
 * If audio exceeds the model's max duration, trim it with FFmpeg
 * and upload the trimmed version to R2. Returns the (possibly new) audio URL.
 */
async function ensureAudioDuration(
  audioUrl: string,
  maxSeconds: number,
): Promise<string> {
  let workDir: string | undefined
  try {
    workDir = await createWorkDir("lip-sync-trim")
    // Extract extension from URL (before query params), default to mp3
    const ext = audioUrl.split("?")[0].match(/\.(mp3|wav|m4a|ogg|aac|flac)$/i)?.[1]?.toLowerCase() ?? "mp3"
    const inputPath = join(workDir, `input.${ext}`)
    const outputPath = join(workDir, `trimmed.mp3`)

    console.log(`[KIE.ai] Downloading audio for duration check: ${audioUrl.substring(0, 120)}...`)
    await downloadFile(audioUrl, inputPath)
    const duration = await getVideoDuration(inputPath)
    console.log(`[KIE.ai] Audio duration: ${duration.toFixed(1)}s (limit: ${maxSeconds}s)`)

    if (duration <= maxSeconds) {
      return audioUrl
    }

    console.log(
      `[KIE.ai] Audio duration (${duration.toFixed(1)}s) exceeds ${maxSeconds}s limit — trimming`
    )

    // Always output as mp3 for maximum compatibility with KIE API
    await runFfmpeg([
      "-i", inputPath,
      "-t", String(maxSeconds),
      "-c:a", "libmp3lame", "-b:a", "192k",
      "-y",
      outputPath,
    ])

    const trimmedBuffer = await readFile(outputPath)
    const key = `audio/lip-sync-trimmed-${Date.now()}.mp3`
    const trimmedUrl = await uploadBufferToR2(trimmedBuffer, key, "audio/mpeg")
    console.log(`[KIE.ai] Trimmed audio uploaded: ${trimmedUrl}`)
    return trimmedUrl
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[KIE.ai] Audio trim failed: ${msg}`)
    throw new Error(
      `Lip sync requires audio ≤ ${maxSeconds}s. Auto-trim failed: ${msg}`
    )
  } finally {
    if (workDir) await cleanupWorkDir(workDir)
  }
}

function snapToAllowedDuration(requested: number, allowed: number[]): number {
  if (!allowed || allowed.length === 0) return requested
  if (allowed.includes(requested)) return requested
  return allowed.reduce((best, d) =>
    Math.abs(d - requested) < Math.abs(best - requested) ? d : best
  )
}

/** Shared helper for Kling 3.0 calls from both imageToVideo and textToVideo. */
async function runKling3(
  modelConfig: { allowedDurations?: number[]; cost: number },
  prompt: string,
  duration: number | undefined,
  aspectRatio: string,
  options: ProviderOptions | undefined,
  imageUrls?: string[],
): Promise<ProviderResult> {
  const snappedDuration = duration
    ? snapToAllowedDuration(duration, modelConfig.allowedDurations ?? [])
    : 5
  const sound = options?.sound ?? true
  const mode = (options?.mode as "std" | "pro") ?? "pro"
  const result = await kling3Generate({
    prompt,
    imageUrls,
    sound,
    duration: String(snappedDuration),
    mode,
    aspectRatio,
    multiShots: options?.multiShots,
    multiPrompt: options?.multiPrompt,
    klingElements: options?.klingElements,
    onProgress: options?.onProgress,
  })

  // Audit log for Kling 3.0 (known to have variable duration/audio pricing)
  logCreditAudit({
    modelKey: "kling-3.0",
    expectedKieCredits: modelConfig.cost / 0.005, // Convert USD to KIE credits
    modelConfig: { duration: snappedDuration, sound, mode },
    notes: `kling-3.0 ${snappedDuration}s ${sound ? "audio" : "no-audio"} ${mode}`,
  })

  return { url: result.videoUrl, cost: modelConfig.cost }
}

export class KieVideoProvider
  implements
    ImageToVideoProvider,
    TextToVideoProvider,
    VideoToVideoProvider,
    MotionTransferProvider,
    VideoUpscaleProvider,
    LipSyncProvider
{
  async imageToVideo(
    imageUrl: string,
    prompt?: string,
    model?: string,
    duration?: number,
    endFrameUrl?: string,
    options?: ProviderOptions
  ): Promise<ProviderResult> {
    const provider = model ?? "minimax"
    const modelConfig = KIE_VIDEO_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support video provider: ${provider}`,
        "Video generation"
      )
    }

    console.log(
      `[KIE.ai] ========== VIDEO GENERATION REQUEST ==========`
    )
    console.log(`[KIE.ai] Provider: ${provider}`)
    console.log(`[KIE.ai] Model: ${modelConfig.model}`)
    console.log(`[KIE.ai] Image URL: ${imageUrl}`)
    console.log(
      `[KIE.ai] Prompt: "${prompt ?? "(default: smooth cinematic motion)"}"`
    )
    console.log(
      `[KIE.ai] Duration requested: ${duration ?? "(default)"}`
    )
    console.log(
      `[KIE.ai] End frame URL: ${endFrameUrl ?? "(none)"}`
    )
    console.log(`[KIE.ai] Model config:`)
    console.log(
      `  - usesNFrames: ${modelConfig.usesNFrames ?? false}`
    )
    console.log(
      `  - allowedDurations: ${JSON.stringify(modelConfig.allowedDurations)}`
    )
    console.log(
      `  - extraParams: ${JSON.stringify(modelConfig.extraParams ?? {})}`
    )
    console.log(
      `  - imageParam: ${modelConfig.imageParam ?? "image"}`
    )
    console.log(
      `  - supportsEndFrame: ${modelConfig.supportsEndFrame ?? false}`
    )
    console.log(
      `[KIE.ai] ==============================================`
    )

    // Kling 3.0 uses the unified createTask/getTaskDetail endpoints
    if (provider === "kling-3.0") {
      const imageUrls = (endFrameUrl && !options?.multiShots)
        ? [imageUrl, endFrameUrl]
        : [imageUrl]
      return runKling3(
        modelConfig,
        prompt ?? "smooth cinematic motion",
        duration,
        options?.aspectRatio ?? "16:9",
        options,
        imageUrls,
      )
    }

    // VEO3 uses a special API endpoint
    if (provider === "veo3" || provider === "veo3.1") {
      const imageUrls = endFrameUrl
        ? [imageUrl, endFrameUrl]
        : [imageUrl]
      const { resultJson, taskId: veoTaskId } = await runVeoTask(
        modelConfig.model,
        prompt ?? "smooth cinematic motion",
        imageUrls
      )

      const videoUrl =
        resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (!videoUrl) {
        throw createSanitizedError(
          "VEO video task succeeded but no URL found",
          "Video generation"
        )
      }

      console.log(
        `[KIE.ai] VEO Video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return { url: videoUrl, cost: modelConfig.cost, kieTaskId: veoTaskId }
    }

    // Runway KIE uses a special API endpoint
    if (provider === "runway-kie") {
      const snapped = duration
        ? snapToAllowedDuration(duration, modelConfig.allowedDurations ?? [])
        : 5
      const runwayInput: Record<string, unknown> = {
        ...(modelConfig.extraParams ?? {}),
        prompt: prompt ?? "smooth cinematic motion",
        duration: snapped,
        imageUrl,
      }
      const { resultJson, taskId: runwayTaskId } = await runRunwayTask(runwayInput)
      const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (!videoUrl) {
        throw createSanitizedError(
          "Runway video task succeeded but no URL found",
          "Video generation"
        )
      }
      console.log(
        `[KIE.ai] Runway Video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return { url: videoUrl, cost: modelConfig.cost, kieTaskId: runwayTaskId }
    }

    // Standard createTask endpoint for other providers
    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      prompt: prompt ?? "smooth cinematic motion",
    }

    // Handle image parameter - different models use different param names
    const imageParamName = modelConfig.imageParam ?? "image"
    console.log(
      `[KIE.ai] Using image parameter: ${imageParamName}`
    )

    if (imageParamName === "image_urls" || imageParamName === "input_urls") {
      // Array format for kling, grok, sora, seedance, wan-i2v
      input[imageParamName] = [imageUrl]
    } else {
      // Single URL format for hailuo, kling-turbo, bytedance, wan-turbo, kling-master
      input[imageParamName] = imageUrl
    }

    // Override duration if provided
    if (duration) {
      const snapped = snapToAllowedDuration(duration, modelConfig.allowedDurations ?? [])
      if (snapped !== duration) {
        console.log(`[KIE.ai] Duration ${duration}s not allowed, snapped to ${snapped}s (allowed: ${JSON.stringify(modelConfig.allowedDurations)})`)
      }
      if (modelConfig.usesNFrames) {
        input.n_frames = durationToNFrames(snapped)
        console.log(
          `[KIE.ai] Converting duration ${snapped}s to n_frames: ${input.n_frames}`
        )
      } else {
        input.duration = String(snapped)
      }
    }

    // Handle end frame for models that support it
    if (endFrameUrl) {
      if (provider === "kling-turbo") {
        input.tail_image_url = endFrameUrl
      } else if (provider === "minimax" || provider === "hailuo-standard" || provider === "bytedance-lite") {
        input.end_image_url = endFrameUrl
      } else {
        input.end_frame = endFrameUrl
      }
    }

    // Override sound from options (Kling 2.6 supports sound toggle)
    if (options?.sound !== undefined) {
      input.sound = options.sound
    }
    // Kling Turbo / Kling Master supports negative_prompt and cfg_scale
    if (options?.negativePrompt) {
      input.negative_prompt = options.negativePrompt
    }
    if (options?.cfgScale !== undefined) {
      input.cfg_scale = options.cfgScale
    }

    // Resolution override for models that support it
    if (options?.resolution) {
      input.resolution = options.resolution
    }

    // Grok I2V mode (fun/normal/spicy)
    if (options?.grokMode && provider === "grok-i2v") {
      input.mode = options.grokMode
    }

    // Sora2 Pro size (standard/high)
    if (options?.videoSize && provider === "sora2-pro") {
      input.size = options.videoSize
    }

    // Seed for deterministic generation (Wan Turbo, Bytedance Lite/Pro)
    if (options?.seed !== undefined && options.seed >= 0) {
      input.seed = options.seed
    }

    // Camera fixed / fixed lens
    if (options?.cameraFixed !== undefined) {
      if (provider === "seedance") {
        input.fixed_lens = options.cameraFixed
      } else if (provider === "bytedance-lite" || provider === "bytedance-pro") {
        input.camera_fixed = options.cameraFixed
      }
    }

    // Seedance generate_audio
    if (options?.generateAudio !== undefined && provider === "seedance") {
      input.generate_audio = options.generateAudio
    }

    // Seedance aspect_ratio override
    if (options?.aspectRatio && provider === "seedance") {
      input.aspect_ratio = options.aspectRatio
    }

    // Wan Turbo specific params
    if (provider === "wan-turbo") {
      if (options?.acceleration !== undefined) {
        input.acceleration = options.acceleration
      }
      if (options?.enablePromptExpansion !== undefined) {
        input.enable_prompt_expansion = options.enablePromptExpansion
      }
    }

    // Hailuo prompt_optimizer
    if (options?.promptOptimizer !== undefined && (provider === "hailuo-standard" || provider === "minimax")) {
      input.prompt_optimizer = options.promptOptimizer
    }

    console.log(
      `[KIE.ai] Final input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson, rawRecordInfo, taskId: kieTaskId } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO,
      options?.onProgress
    )

    const videoUrl =
      resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!videoUrl) {
      throw createSanitizedError(
        "video task succeeded but no URL found",
        "Video generation"
      )
    }

    console.log(
      `[KIE.ai] Video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    // Audit log for standard I2V path
    logCreditAudit({
      modelKey: provider,
      expectedKieCredits: modelConfig.credits,
      modelConfig: { duration: input.duration ?? input.n_frames, sound: input.sound, provider },
      rawResponseSample: rawRecordInfo,
      actualKieCredits: extractCreditFields(rawRecordInfo)?.credits as number | undefined,
      notes: `i2v-standard ${provider}`,
    })

    return { url: videoUrl, cost: modelConfig.cost, ...(kieTaskId && { kieTaskId }) }
  }

  async textToVideo(
    prompt: string,
    model?: string,
    duration?: number,
    aspectRatio?: string,
    options?: ProviderOptions
  ): Promise<ProviderResult> {
    const provider = model ?? "minimax"
    const modelConfig = KIE_TEXT_TO_VIDEO_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support text-to-video provider: ${provider}`,
        "Video generation"
      )
    }

    console.log(
      `[KIE.ai] Generating text-to-video with provider: ${provider}, model: ${modelConfig.model}`
    )
    console.log(`[KIE.ai] Prompt: "${prompt}"`)
    console.log(
      `[KIE.ai] Duration: ${duration ?? "(default)"}, Aspect ratio: ${aspectRatio ?? "(default)"}`
    )

    // Kling 3.0 uses unified createTask endpoint (no start image for text-to-video)
    if (provider === "kling-3.0") {
      return runKling3(
        modelConfig,
        prompt,
        duration,
        aspectRatio ?? options?.aspectRatio ?? "16:9",
        options,
      )
    }

    // VEO3 uses a special API endpoint
    if (provider === "veo3") {
      const { resultJson, taskId: veoTaskId } = await runVeoTask(
        modelConfig.model,
        prompt
      )

      const videoUrl =
        resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (!videoUrl) {
        throw createSanitizedError(
          "VEO text-to-video task succeeded but no URL found",
          "Video generation"
        )
      }

      console.log(
        `[KIE.ai] VEO Text-to-video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return { url: videoUrl, cost: modelConfig.cost, kieTaskId: veoTaskId }
    }

    // Runway KIE uses a special API endpoint
    if (provider === "runway-kie") {
      const snapped = duration
        ? snapToAllowedDuration(duration, modelConfig.allowedDurations ?? [])
        : 5
      const runwayInput: Record<string, unknown> = {
        ...(modelConfig.extraParams ?? {}),
        prompt,
        duration: snapped,
        ...(aspectRatio && { aspectRatio }),
      }
      const { resultJson, taskId: runwayTaskId } = await runRunwayTask(runwayInput)
      const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (!videoUrl) {
        throw createSanitizedError(
          "Runway text-to-video task succeeded but no URL found",
          "Video generation"
        )
      }
      console.log(
        `[KIE.ai] Runway Text-to-video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return { url: videoUrl, cost: modelConfig.cost, kieTaskId: runwayTaskId }
    }

    // Standard createTask endpoint for other providers
    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      prompt,
    }

    // Override duration if provided
    if (duration) {
      const snapped = snapToAllowedDuration(duration, modelConfig.allowedDurations ?? [])
      if (snapped !== duration) {
        console.log(`[KIE.ai] Duration ${duration}s not allowed, snapped to ${snapped}s (allowed: ${JSON.stringify(modelConfig.allowedDurations)})`)
      }
      if (modelConfig.usesNFrames) {
        input.n_frames = durationToNFrames(snapped)
        console.log(
          `[KIE.ai] Converting duration ${snapped}s to n_frames: ${input.n_frames}`
        )
      } else {
        input.duration = String(snapped)
      }
    }

    // Override aspect ratio if provided
    if (aspectRatio) {
      input.aspect_ratio = mapAspectRatio(provider, aspectRatio)
    }

    // Override sound from options (Kling 2.6 supports sound toggle)
    if (options?.sound !== undefined) {
      input.sound = options.sound
    }
    // Kling Turbo supports negative_prompt and cfg_scale
    if (options?.negativePrompt) {
      input.negative_prompt = options.negativePrompt
    }
    if (options?.cfgScale !== undefined) {
      input.cfg_scale = options.cfgScale
    }

    console.log(
      `[KIE.ai] Final input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson, taskId: kieTaskId } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO,
      options?.onProgress
    )

    const videoUrl =
      resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!videoUrl) {
      throw createSanitizedError(
        "text-to-video task succeeded but no URL found",
        "Video generation"
      )
    }

    console.log(
      `[KIE.ai] Text-to-video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: videoUrl, cost: modelConfig.cost, ...(kieTaskId && { kieTaskId }) }
  }

  async videoToVideo(
    videoUrl: string,
    prompt?: string,
    model?: string,
    options?: ProviderOptions
  ): Promise<ProviderResult> {
    const provider = model ?? "wan"
    const modelConfig = KIE_VIDEO_TO_VIDEO_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support video-to-video provider: ${provider}`,
        "Video generation"
      )
    }

    console.log(
      `[KIE.ai] ========== VIDEO-TO-VIDEO GENERATION REQUEST ==========`
    )
    console.log(`[KIE.ai] Provider: ${provider}`)
    console.log(`[KIE.ai] Model: ${modelConfig.model}`)
    console.log(`[KIE.ai] Video URL: ${videoUrl}`)
    console.log(
      `[KIE.ai] Prompt: "${prompt ?? "(default: continue this video smoothly)"}"`
    )
    console.log(
      `[KIE.ai] ==============================================`
    )

    const finalPrompt =
      prompt ?? "continue this video with smooth cinematic motion"

    // Runway Aleph uses a special API endpoint
    if (provider === "runway-aleph") {
      const alephInput: Record<string, unknown> = {
        prompt: finalPrompt,
        videoUrl,
      }
      if (options?.aspectRatio) {
        alephInput.aspectRatio = options.aspectRatio
      }
      if (options?.seed !== undefined && options.seed >= 0) {
        alephInput.seed = options.seed
      }
      const { resultJson, taskId: alephTaskId } = await runAlephTask(alephInput)
      const outputUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (!outputUrl) {
        throw createSanitizedError(
          "Runway Aleph task succeeded but no URL found",
          "Video generation"
        )
      }
      console.log(
        `[KIE.ai] Runway Aleph completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return { url: outputUrl, cost: modelConfig.cost, kieTaskId: alephTaskId }
    }

    // Luma Modify uses a special API endpoint
    if (provider === "luma-modify") {
      const { resultJson } = await runLumaModifyTask({
        prompt: finalPrompt,
        videoUrl,
      })
      const outputUrl = resultJson.resultUrls?.[0]
      if (!outputUrl) {
        throw createSanitizedError(
          "Luma Modify task succeeded but no URL found",
          "Video generation"
        )
      }
      console.log(
        `[KIE.ai] Luma Modify completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return { url: outputUrl, cost: modelConfig.cost }
    }

    // Standard createTask endpoint for other V2V providers (Wan 2.6)
    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      prompt: finalPrompt,
      video_urls: [videoUrl], // Standard V2V models use video_urls array
    }

    console.log(
      `[KIE.ai] Final input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO,
      options?.onProgress
    )

    const outputUrl =
      resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!outputUrl) {
      throw createSanitizedError(
        "V2V task succeeded but no URL found",
        "Video generation"
      )
    }

    console.log(
      `[KIE.ai] V2V completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: outputUrl, cost: modelConfig.cost }
  }

  async motionTransfer(
    imageUrl: string,
    videoUrl: string,
    prompt?: string,
    options?: ProviderOptions & {
      characterOrientation?: "image" | "video"
      resolution?: "480p" | "580p" | "720p" | "1080p"
      provider?: string
      backgroundSource?: "input_video" | "input_image"
    }
  ): Promise<ProviderResult> {
    const provider = options?.provider ?? "kling"
    const modelConfig = KIE_MOTION_TRANSFER_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `Motion transfer model not configured for provider: ${provider}`,
        "Motion transfer"
      )
    }

    const characterOrientation =
      options?.characterOrientation ?? "image"
    const resolution = options?.resolution ?? "720p"

    console.log(
      `[KIE.ai] ========== MOTION TRANSFER REQUEST ==========`
    )
    console.log(`[KIE.ai] Provider: ${provider}`)
    console.log(`[KIE.ai] Model: ${modelConfig.model}`)
    console.log(
      `[KIE.ai] Image URL (character source): ${imageUrl}`
    )
    console.log(
      `[KIE.ai] Video URL (motion source): ${videoUrl}`
    )
    console.log(`[KIE.ai] Prompt: "${prompt ?? "(none)"}"`)
    console.log(
      `[KIE.ai] Character orientation: ${characterOrientation}`
    )
    console.log(`[KIE.ai] Resolution: ${resolution}`)
    console.log(
      `[KIE.ai] ==============================================`
    )

    // Kling 3.0 Motion Control — uses createTask with mode + character_orientation
    if (provider === "kling-3.0") {
      const input: Record<string, unknown> = {
        input_urls: [imageUrl],
        video_urls: [videoUrl],
        character_orientation: characterOrientation,
        mode: resolution,  // "720p" or "1080p"
      }

      if (options?.backgroundSource) {
        input.background_source = options.backgroundSource
      }

      if (prompt) {
        input.prompt = prompt
      }

      console.log(
        `[KIE.ai] Kling 3.0 Motion Transfer Request:`,
        JSON.stringify(input, null, 2)
      )

      const { resultJson } = await runKieTask(
        modelConfig.model,
        input,
        MAX_POLL_ATTEMPTS_VIDEO,
        options?.onProgress
      )

      const outputUrl =
        resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (!outputUrl) {
        throw createSanitizedError(
          "Kling 3.0 Motion transfer task succeeded but no URL found",
          "Motion transfer"
        )
      }

      console.log(
        `[KIE.ai] Kling 3.0 Motion transfer completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )

      return { url: outputUrl, cost: modelConfig.cost }
    }

    // Wan 2.2 Animate (Move/Replace) — standard createTask
    // Input: image_url (string) + video_url (string) + resolution
    if (provider === "wan-animate-move" || provider === "wan-animate-replace") {
      const wanResolution = options?.resolution ?? "480p"
      const input: Record<string, unknown> = {
        image_url: imageUrl,
        video_url: videoUrl,
        resolution: wanResolution,
      }

      console.log(
        `[KIE.ai] Wan Animate ${provider === "wan-animate-move" ? "Move" : "Replace"} Request:`,
        JSON.stringify(input, null, 2)
      )

      const { resultJson } = await runKieTask(
        modelConfig.model,
        input,
        MAX_POLL_ATTEMPTS_VIDEO,
        options?.onProgress
      )

      const outputUrl =
        resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (!outputUrl) {
        throw createSanitizedError(
          `Wan Animate task succeeded but no URL found`,
          "Motion transfer"
        )
      }

      console.log(
        `[KIE.ai] Wan Animate completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )

      return { url: outputUrl, cost: modelConfig.cost }
    }

    // Kling 2.6 Motion Control — original behavior
    // NOTE: Field is "mode" not "resolution" per KIE.ai API docs
    const input: Record<string, unknown> = {
      input_urls: [imageUrl], // Array of image URLs (character reference)
      video_urls: [videoUrl], // Array of video URLs (motion source)
      character_orientation: characterOrientation,
      mode: resolution, // KIE.ai uses "mode" for resolution (720p/1080p)
    }

    // Add optional prompt if provided
    if (prompt) {
      input.prompt = prompt
    }

    console.log(
      `[KIE.ai] Motion Transfer Request:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO,
      options?.onProgress
    )

    const outputUrl =
      resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!outputUrl) {
      throw createSanitizedError(
        "Motion transfer task succeeded but no URL found",
        "Motion transfer"
      )
    }

    console.log(
      `[KIE.ai] Motion transfer completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: outputUrl, cost: modelConfig.cost }
  }

  async videoUpscale(
    videoUrl: string,
    upscaleFactor?: "1" | "2" | "4",
    options?: ProviderOptions
  ): Promise<ProviderResult> {
    const modelConfig = KIE_VIDEO_UPSCALE_MODELS["topaz"]
    if (!modelConfig) {
      throw createSanitizedError(
        "Video upscale model not configured",
        "Video upscale"
      )
    }

    const factor = upscaleFactor ?? "2"

    console.log(
      `[KIE.ai] ========== VIDEO UPSCALE REQUEST ==========`
    )
    console.log(`[KIE.ai] Model: ${modelConfig.model}`)
    console.log(`[KIE.ai] Video URL: ${videoUrl}`)
    console.log(`[KIE.ai] Upscale factor: ${factor}x`)
    console.log(`[KIE.ai] NOTE: Max input size 50MB`)
    console.log(
      `[KIE.ai] ==============================================`
    )

    // Build input based on KIE.ai docs for topaz/video-upscale
    // IMPORTANT: video_url is STRING, not array!
    const input: Record<string, unknown> = {
      video_url: videoUrl, // Single URL string (NOT array!)
      upscale_factor: factor,
    }

    console.log(
      `[KIE.ai] Final input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO,
      options?.onProgress
    )

    const outputUrl =
      resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!outputUrl) {
      throw createSanitizedError(
        "Video upscale task succeeded but no URL found",
        "Video upscale"
      )
    }

    console.log(
      `[KIE.ai] Video upscale completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: outputUrl, cost: modelConfig.cost }
  }

  async lipSync(
    imageUrl: string,
    audioUrl: string,
    prompt?: string,
    model?: string,
    resolution?: string
  ): Promise<ProviderResult> {
    const provider = model ?? "kling-avatar"
    const modelConfig = KIE_LIP_SYNC_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support lip-sync provider: ${provider}`,
        "Lip sync generation"
      )
    }

    console.log(
      `[KIE.ai] Generating lip sync video with ${modelConfig.model}`
    )
    console.log(
      `[KIE.ai] Image: ${imageUrl}, Audio: ${audioUrl}`
    )

    // Auto-trim audio if it exceeds the 15-second lip-sync limit
    const effectiveAudioUrl = await ensureAudioDuration(audioUrl, LIP_SYNC_MAX_AUDIO_SECONDS)

    // Start with extra params from config
    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      image_url: imageUrl,
      audio_url: effectiveAudioUrl,
    }

    // KIE API requires prompt for all lip-sync models — use a default if none provided
    input.prompt = prompt || "A person speaking naturally"

    // Override resolution if provided (for infinitalk: 480p or 720p)
    if (resolution) {
      input.resolution = resolution
    }

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO
    )

    const videoUrl =
      resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!videoUrl) {
      throw createSanitizedError(
        "lip sync task succeeded but no URL found",
        "Lip sync generation"
      )
    }

    console.log(
      `[KIE.ai] Lip sync completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: videoUrl, cost: modelConfig.cost }
  }

  async speechToVideo(
    imageUrl: string,
    audioUrl: string,
    prompt: string,
    resolution?: string,
    options?: {
      negativePrompt?: string
      seed?: number
      numFrames?: number
      fps?: number
      inferenceSteps?: number
      guidanceScale?: number
      shift?: number
      onProgress?: (progress: number) => Promise<void>
    }
  ): Promise<ProviderResult> {
    const modelConfig = KIE_SPEECH_TO_VIDEO_MODELS["wan-s2v"]
    if (!modelConfig) {
      throw createSanitizedError(
        "Speech-to-video model not configured",
        "Speech-to-video generation"
      )
    }

    console.log(
      `[KIE.ai] ========== SPEECH-TO-VIDEO REQUEST ==========`
    )
    console.log(`[KIE.ai] Model: ${modelConfig.model}`)
    console.log(`[KIE.ai] Image URL: ${imageUrl}`)
    console.log(`[KIE.ai] Audio URL: ${audioUrl}`)
    console.log(`[KIE.ai] Prompt: "${prompt}"`)
    console.log(`[KIE.ai] Resolution: ${resolution ?? "480p"}`)
    console.log(
      `[KIE.ai] ==============================================`
    )

    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      image_url: imageUrl,
      audio_url: audioUrl,
      prompt,
    }

    // Override resolution if provided
    if (resolution) {
      input.resolution = resolution
    }

    // Optional advanced params
    if (options?.negativePrompt) {
      input.negative_prompt = options.negativePrompt
    }
    if (options?.seed !== undefined && options.seed >= 0) {
      input.seed = options.seed
    }
    if (options?.numFrames !== undefined) {
      input.num_frames = options.numFrames
    }
    if (options?.fps !== undefined) {
      input.fps = options.fps
    }
    if (options?.inferenceSteps !== undefined) {
      input.inference_steps = options.inferenceSteps
    }
    if (options?.guidanceScale !== undefined) {
      input.guidance_scale = options.guidanceScale
    }
    if (options?.shift !== undefined) {
      input.shift = options.shift
    }

    console.log(
      `[KIE.ai] Final input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO,
      options?.onProgress
    )

    const videoUrl =
      resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!videoUrl) {
      throw createSanitizedError(
        "speech-to-video task succeeded but no URL found",
        "Speech-to-video generation"
      )
    }

    console.log(
      `[KIE.ai] Speech-to-video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: videoUrl, cost: modelConfig.cost }
  }

  async soraStoryboard(
    shots: Array<{ scene: string; duration: number }>,
    nFrames?: string,
    imageUrls?: string[],
    aspectRatio?: string,
    onProgress?: (progress: number) => Promise<void>
  ): Promise<ProviderResult> {
    const modelConfig = KIE_STORYBOARD_MODELS["sora-storyboard"]
    if (!modelConfig) {
      throw createSanitizedError(
        "Sora Storyboard model not configured",
        "Sora Storyboard generation"
      )
    }

    const effectiveNFrames = nFrames ?? "10"

    console.log(
      `[KIE.ai] ========== SORA STORYBOARD REQUEST ==========`
    )
    console.log(`[KIE.ai] Model: ${modelConfig.model}`)
    console.log(`[KIE.ai] Shots: ${shots.length}`)
    console.log(`[KIE.ai] n_frames: ${effectiveNFrames}`)
    console.log(`[KIE.ai] Aspect ratio: ${aspectRatio ?? "landscape"}`)
    console.log(`[KIE.ai] Image URLs: ${imageUrls?.length ?? 0}`)
    console.log(
      `[KIE.ai] ==============================================`
    )

    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      shots: shots.map((s) => ({
        scene: s.scene,
        duration: s.duration,
      })),
      n_frames: effectiveNFrames,
    }

    if (aspectRatio) {
      input.aspect_ratio = mapAspectRatio("sora-storyboard", aspectRatio)
    }

    if (imageUrls && imageUrls.length > 0) {
      input.image_urls = imageUrls
    }

    // Cost varies by n_frames: 10 = 150 KIE credits ($0.75), 15/25 = 270 KIE credits ($1.35)
    const effectiveCost = effectiveNFrames === "10" ? modelConfig.cost : 1.35

    console.log(
      `[KIE.ai] Final input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO,
      onProgress
    )

    const videoUrl =
      resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!videoUrl) {
      throw createSanitizedError(
        "Sora Storyboard task succeeded but no URL found",
        "Sora Storyboard generation"
      )
    }

    console.log(
      `[KIE.ai] Sora Storyboard completed: ${videoUrl} (cost: $${effectiveCost.toFixed(4)})`
    )

    return { url: videoUrl, cost: effectiveCost }
  }
}
