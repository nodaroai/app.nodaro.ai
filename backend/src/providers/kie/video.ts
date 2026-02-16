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
import {
  KIE_VIDEO_MODELS,
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_TO_VIDEO_MODELS,
  KIE_MOTION_TRANSFER_MODELS,
  KIE_VIDEO_UPSCALE_MODELS,
  KIE_LIP_SYNC_MODELS,
  durationToNFrames,
} from "./models.js"

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
      const imageUrls = endFrameUrl
        ? [imageUrl, endFrameUrl]
        : [imageUrl]
      const result = await kling3Generate({
        prompt: prompt ?? "smooth cinematic motion",
        imageUrls,
        sound: options?.sound ?? true,
        duration: duration ? String(duration) : "5",
        mode: (options?.mode as "std" | "pro") ?? "pro",
        aspectRatio: options?.aspectRatio ?? "16:9",
        multiShots: options?.multiShots,
        multiPrompt: options?.multiPrompt,
        klingElements: options?.klingElements,
      })
      console.log(
        `[KIE.ai] Kling 3.0 completed: ${result.videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return { url: result.videoUrl, cost: modelConfig.cost }
    }

    // VEO3 uses a special API endpoint
    if (provider === "veo3" || provider === "veo3.1") {
      const imageUrls = endFrameUrl
        ? [imageUrl, endFrameUrl]
        : [imageUrl]
      const { resultJson } = await runVeoTask(
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
      return { url: videoUrl, cost: modelConfig.cost }
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

    if (imageParamName === "image_urls") {
      // Array format for kling, grok, sora
      input[imageParamName] = [imageUrl]
    } else {
      // Single URL format for hailuo, kling-turbo
      input[imageParamName] = imageUrl
    }

    // Override duration if provided
    if (duration) {
      if (modelConfig.usesNFrames) {
        // Sora uses n_frames instead of duration
        // n_frames 10 = ~5 seconds, n_frames 15 = ~10 seconds
        input.n_frames = durationToNFrames(duration)
        console.log(
          `[KIE.ai] Converting duration ${duration}s to n_frames: ${input.n_frames}`
        )
      } else {
        input.duration = String(duration) // KIE expects string for duration
      }
    }

    // Handle end frame for models that support it
    if (endFrameUrl) {
      if (provider === "kling-turbo") {
        input.tail_image_url = endFrameUrl
      } else if (provider === "minimax") {
        input.end_image_url = endFrameUrl // Hailuo uses end_image_url
      } else {
        input.end_frame = endFrameUrl
      }
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
        "video task succeeded but no URL found",
        "Video generation"
      )
    }

    console.log(
      `[KIE.ai] Video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: videoUrl, cost: modelConfig.cost }
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
      const result = await kling3Generate({
        prompt,
        sound: options?.sound ?? true,
        duration: duration ? String(duration) : "5",
        mode: (options?.mode as "std" | "pro") ?? "pro",
        aspectRatio: aspectRatio ?? options?.aspectRatio ?? "16:9",
        multiShots: options?.multiShots,
        multiPrompt: options?.multiPrompt,
        klingElements: options?.klingElements,
      })
      console.log(
        `[KIE.ai] Kling 3.0 text-to-video completed: ${result.videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return { url: result.videoUrl, cost: modelConfig.cost }
    }

    // VEO3 uses a special API endpoint
    if (provider === "veo3") {
      const { resultJson } = await runVeoTask(
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
      return { url: videoUrl, cost: modelConfig.cost }
    }

    // Standard createTask endpoint for other providers
    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      prompt,
    }

    // Override duration if provided
    if (duration) {
      if (modelConfig.usesNFrames) {
        // Sora uses n_frames instead of duration
        input.n_frames = durationToNFrames(duration)
        console.log(
          `[KIE.ai] Converting duration ${duration}s to n_frames: ${input.n_frames}`
        )
      } else {
        input.duration = String(duration)
      }
    }

    // Override aspect ratio if provided
    if (aspectRatio) {
      input.aspect_ratio = aspectRatio
    }

    console.log(
      `[KIE.ai] Final input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO
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

    return { url: videoUrl, cost: modelConfig.cost }
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

    // Standard createTask endpoint for all V2V providers (Wan 2.6, Kling 2.6)
    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      prompt: finalPrompt,
      video_urls: [videoUrl], // All V2V models use video_urls array
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
      resolution?: "720p" | "1080p"
    }
  ): Promise<ProviderResult> {
    const modelConfig = KIE_MOTION_TRANSFER_MODELS["kling"]
    if (!modelConfig) {
      throw createSanitizedError(
        "Motion transfer model not configured",
        "Motion transfer"
      )
    }

    const characterOrientation =
      options?.characterOrientation ?? "image"
    const resolution = options?.resolution ?? "720p"

    console.log(
      `[KIE.ai] ========== MOTION TRANSFER REQUEST ==========`
    )
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
    console.log(`[KIE.ai] Mode: ${resolution}`)
    console.log(
      `[KIE.ai] Max duration: ${characterOrientation === "image" ? "10s" : "30s"}`
    )
    console.log(
      `[KIE.ai] ==============================================`
    )

    // Build input based on KIE.ai docs for kling-2.6/motion-control
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

    // Start with extra params from config
    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      image_url: imageUrl,
      audio_url: audioUrl,
    }

    // Add optional prompt (for infinitalk especially)
    if (prompt) {
      input.prompt = prompt
    }

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
}
