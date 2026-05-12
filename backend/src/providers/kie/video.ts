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
import { SEEDANCE_2_REF_LIMITS, isSeedance2Provider, isVeoProvider } from "@nodaro/shared"
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
  KIE_CREDIT_USD,
} from "./models.js"
import { logCreditAudit, extractCreditFields } from "../../lib/credit-audit.js"
import { downloadFile, runFfmpeg, getVideoDuration, createWorkDir, cleanupWorkDir } from "../video/ffmpeg-utils.js"
import { uploadBufferToR2 } from "../../lib/storage.js"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import sharp from "sharp"

function mapAspectRatio(_provider: string, aspectRatio: string): string {
  return aspectRatio
}

/**
 * Merge Seedance 2.0 options into the KIE payload (I2V + T2V).
 * Returns whether multimodal reference mode is active (video/audio refs present),
 * which is mutually exclusive with first/last frame mode per KIE's schema.
 */
function applySeedance2Params(
  input: Record<string, unknown>,
  options: ProviderOptions | undefined,
): { hasMultimodalRef: boolean } {
  const refImages = (options?.referenceImageUrls ?? []).slice(0, SEEDANCE_2_REF_LIMITS.images)
  const refVideos = (options?.referenceVideoUrls ?? []).slice(0, SEEDANCE_2_REF_LIMITS.videos)
  const refAudios = (options?.referenceAudioUrls ?? []).slice(0, SEEDANCE_2_REF_LIMITS.audio)
  if (refImages.length > 0) input.reference_image_urls = refImages
  if (refVideos.length > 0) input.reference_video_urls = refVideos
  if (refAudios.length > 0) input.reference_audio_urls = refAudios
  input.web_search = options?.webSearch ?? false
  if (options?.nsfwChecker !== undefined) input.nsfw_checker = options.nsfwChecker
  if (options?.generateAudio !== undefined) input.generate_audio = options.generateAudio
  if (options?.aspectRatio) input.aspect_ratio = options.aspectRatio
  if (options?.resolution) input.resolution = options.resolution
  if (input.duration !== undefined) input.duration = Number(input.duration)
  return { hasMultimodalRef: refVideos.length > 0 || refAudios.length > 0 }
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

// Max input video duration (seconds) for motion-transfer models.
// KIE.ai Kling 2.6/3.0 motion control enforces 3–30s; use 29.5s safety margin.
const MOTION_TRANSFER_MAX_VIDEO_SECONDS = 29.5

/**
 * If video exceeds the max duration, trim it with FFmpeg
 * and upload the trimmed version to R2. Returns the (possibly new) video URL.
 */
async function ensureVideoDuration(
  videoUrl: string,
  maxSeconds: number,
): Promise<string> {
  let workDir: string | undefined
  try {
    workDir = await createWorkDir("motion-trim")
    const ext = videoUrl.split("?")[0].match(/\.(mp4|mov|mkv|webm)$/i)?.[1]?.toLowerCase() ?? "mp4"
    const inputPath = join(workDir, `input.${ext}`)
    const outputPath = join(workDir, `trimmed.mp4`)

    console.log(`[KIE.ai] Downloading video for duration check: ${videoUrl.substring(0, 120)}...`)
    await downloadFile(videoUrl, inputPath)
    const duration = await getVideoDuration(inputPath)
    console.log(`[KIE.ai] Video duration: ${duration.toFixed(1)}s (limit: ${maxSeconds}s)`)

    if (duration <= maxSeconds) {
      return videoUrl
    }

    console.log(
      `[KIE.ai] Video duration (${duration.toFixed(1)}s) exceeds ${maxSeconds}s limit — trimming`
    )

    await runFfmpeg([
      "-i", inputPath,
      "-t", String(maxSeconds),
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-c:a", "aac", "-b:a", "128k",
      "-y",
      outputPath,
    ])

    const trimmedBuffer = await readFile(outputPath)
    const key = `video/motion-trimmed-${Date.now()}.mp4`
    const trimmedUrl = await uploadBufferToR2(trimmedBuffer, key, "video/mp4")
    console.log(`[KIE.ai] Trimmed video uploaded: ${trimmedUrl}`)
    return trimmedUrl
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[KIE.ai] Video trim failed: ${msg}`)
    throw new Error(
      `Motion transfer requires video ≤ ${maxSeconds}s. Auto-trim failed: ${msg}`
    )
  } finally {
    if (workDir) await cleanupWorkDir(workDir)
  }
}

// Accepted image formats per provider family (from KIE API docs).
// Kling 3.0 (both I2V and motion control) only accepts JPEG/PNG — NOT WebP.
// Most other models accept JPEG/PNG/WebP.
const JPEG_PNG_ONLY = new Set(["jpeg", "png"])
const JPEG_PNG_WEBP = new Set(["jpeg", "png", "webp"])

// Providers that only accept JPEG/PNG (no WebP).
// Kling 2.6 motion control also rejects WebP but its I2V endpoint accepts it.
// Motion-transfer always goes through this check; I2V only for kling-3.0 and wan-i2v.
const JPEG_PNG_ONLY_PROVIDERS = new Set(["kling-3.0"])

// Max image file size (10 MB per KIE docs, applies to all models)
const IMAGE_MAX_BYTES = 10 * 1024 * 1024

interface ImageConstraints {
  /** Human-readable context for error messages */
  context: string
  /** Override accepted formats (defaults to provider-based lookup) */
  acceptedFormats?: Set<string>
  /** Minimum pixel dimension (width AND height must be >= this) */
  minDimension?: number
  /** Minimum aspect ratio (width/height) */
  minAspectRatio?: number
  /** Maximum aspect ratio (width/height) */
  maxAspectRatio?: number
  /**
   * Re-encode to JPEG even when the source format is otherwise accepted.
   * Drops the alpha channel and shrinks the file — needed for the MiniMax/Hailuo
   * backend, which 500s on large RGBA PNGs despite the docs only listing a 10MB cap.
   */
  forceJpeg?: boolean
  /** Downscale (preserving aspect ratio) so neither side exceeds this many pixels. */
  maxDimension?: number
}

/**
 * Ensure the image is in a format/size accepted by the target provider.
 *
 * - Kling 3.0: JPEG/PNG only (auto-converts WebP/GIF to JPEG)
 * - Wan 2.6 I2V: min 256×256px
 * - Kling 2.6 motion: min 300px, aspect ratio 2:5–5:2
 * - Hailuo/MiniMax I2V: re-encode to JPEG (drops alpha) — backend 500s on large RGBA PNGs
 * - All KIE I2V: longest side capped (caller passes maxDimension, currently 2048px)
 * - All: max 10 MB (progressive JPEG compression + resize)
 *
 * Returns the original URL if no processing is needed, or a new R2 URL.
 */
async function ensureImageForProvider(
  imageUrl: string,
  provider: string,
  constraints?: ImageConstraints,
): Promise<string> {
  const acceptedFormats = constraints?.acceptedFormats
    ?? (JPEG_PNG_ONLY_PROVIDERS.has(provider) ? JPEG_PNG_ONLY : JPEG_PNG_WEBP)

  const context = constraints?.context ?? "Video generation"

  // Download and inspect the image
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) {
    throw createSanitizedError(
      `Failed to download image: HTTP ${res.status}`,
      context
    )
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const meta = await sharp(buffer).metadata()
  const format = meta.format // "jpeg" | "png" | "webp" | "gif" | "tiff" | ...
  const width = meta.width ?? 0
  const height = meta.height ?? 0

  if (!format || !width || !height) {
    throw createSanitizedError(
      "Could not read image metadata — unsupported image file",
      context
    )
  }

  // Enforce minimum dimension
  if (constraints?.minDimension && (width < constraints.minDimension || height < constraints.minDimension)) {
    throw createSanitizedError(
      `${provider} requires images at least ${constraints.minDimension}×${constraints.minDimension}px (got ${width}×${height})`,
      context
    )
  }

  // Enforce aspect ratio bounds
  if (constraints?.minAspectRatio || constraints?.maxAspectRatio) {
    const ratio = width / height
    const min = constraints.minAspectRatio ?? 0
    const max = constraints.maxAspectRatio ?? Infinity
    if (ratio < min || ratio > max) {
      throw createSanitizedError(
        `${provider} requires aspect ratio between ${min.toFixed(1)}:1 and ${max.toFixed(1)}:1 (got ${width}:${height})`,
        context
      )
    }
  }

  const maxDim = constraints?.maxDimension
  const needsConversion =
    !acceptedFormats.has(format) || (constraints?.forceJpeg === true && format !== "jpeg")
  const needsCompress = buffer.length > IMAGE_MAX_BYTES
  const needsResize = maxDim !== undefined && (width > maxDim || height > maxDim)

  if (!needsConversion && !needsCompress && !needsResize) {
    return imageUrl
  }

  console.log(
    `[KIE.ai] Image preprocessing for ${provider}: format=${format}, size=${(buffer.length / 1024 / 1024).toFixed(1)}MB, ${width}×${height}` +
    `${needsConversion ? ` → converting to JPEG${acceptedFormats.has(format) ? " (forced)" : ` (${format} not accepted)`}` : ""}` +
    `${needsResize ? ` → downscaling to ≤${maxDim}px` : ""}` +
    `${needsCompress ? ` → compressing (>${IMAGE_MAX_BYTES / 1024 / 1024}MB)` : ""}`
  )

  // Base pipeline: optionally cap the longest side, preserving aspect ratio.
  const pipeline = () => {
    const s = sharp(buffer)
    return maxDim !== undefined
      ? s.resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
      : s
  }

  // Convert to JPEG — good balance of compatibility and compression
  let quality = 90
  let converted = await pipeline()
    .jpeg({ quality, mozjpeg: true })
    .toBuffer()

  // If still over 10 MB, progressively lower quality
  while (converted.length > IMAGE_MAX_BYTES && quality > 50) {
    quality -= 10
    converted = await pipeline()
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
  }

  // If still over limit after quality reduction, resize down further
  if (converted.length > IMAGE_MAX_BYTES) {
    const effectiveWidth = maxDim !== undefined ? Math.min(width, maxDim) : width
    const scale = Math.sqrt(IMAGE_MAX_BYTES / converted.length)
    const newWidth = Math.round(effectiveWidth * scale)
    converted = await sharp(buffer)
      .resize(newWidth)
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer()
  }

  const key = `images/provider-converted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const newUrl = await uploadBufferToR2(converted, key, "image/jpeg")
  console.log(
    `[KIE.ai] Image converted: ${(converted.length / 1024 / 1024).toFixed(1)}MB → ${newUrl.substring(0, 80)}...`
  )
  return newUrl
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
  const mode = (options?.mode as "std" | "pro" | "4K") ?? "pro"
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
    motionPrompt: options?.motionPrompt,
    onProgress: options?.onProgress,
  })

  // Audit log for Kling 3.0 (known to have variable duration/audio pricing)
  logCreditAudit({
    modelKey: "kling-3.0",
    expectedKieCredits: modelConfig.cost / KIE_CREDIT_USD, // Convert USD to KIE credits
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
    imageUrl: string | undefined,
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

    // Normalize input frames before handing them to KIE — see ensureImageForProvider.
    // The Hailuo/MiniMax backend returns "internal error" on large RGBA PNGs even
    // though its docs only list a 10MB cap, so re-encode those to JPEG; cap every
    // i2v input at 2048px regardless. VEO and Runway-KIE go straight through (own
    // endpoints, and they reference `imageUrl`/`endFrameUrl` directly below).
    let effectiveImageUrl = imageUrl
    let effectiveEndFrameUrl = endFrameUrl
    const usesRawImageUrls = isVeoProvider(provider) || provider === "runway-kie"
    if (!usesRawImageUrls) {
      const i2vConstraints: ImageConstraints = { context: "Video generation", maxDimension: 2048 }
      if (provider === "wan-i2v") i2vConstraints.minDimension = 256
      if (modelConfig.model.startsWith("hailuo/")) i2vConstraints.forceJpeg = true
      const [normImage, normEnd] = await Promise.all([
        imageUrl ? ensureImageForProvider(imageUrl, provider, i2vConstraints) : imageUrl,
        endFrameUrl ? ensureImageForProvider(endFrameUrl, provider, i2vConstraints) : endFrameUrl,
      ])
      effectiveImageUrl = normImage
      effectiveEndFrameUrl = normEnd
    }

    // Kling 3.0 uses the unified createTask/getTaskDetail endpoints
    if (provider === "kling-3.0") {
      const imageUrls = (effectiveEndFrameUrl && !options?.multiShots)
        ? [effectiveImageUrl!, effectiveEndFrameUrl]
        : [effectiveImageUrl!]
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
    if (isVeoProvider(provider)) {
      let imageUrls: string[]
      if (options?.generationType === "REFERENCE_2_VIDEO" && options?.referenceImageUrls?.length) {
        imageUrls = options.referenceImageUrls.slice(0, 3)
      } else {
        imageUrls = endFrameUrl
          ? [imageUrl!, endFrameUrl]
          : [imageUrl!]
      }
      const veoResult = await runVeoTask(
        modelConfig.model,
        prompt ?? "smooth cinematic motion",
        imageUrls,
        {
          aspectRatio: options?.aspectRatio,
          seed: options?.seed,
          generationType: options?.generationType,
          resolution: options?.resolution,
          enableTranslation: options?.enableTranslation,
        }
      )

      const videoUrl =
        veoResult.resultJson.resultUrls?.[0] ?? veoResult.resultJson.videoUrl
      if (!videoUrl) {
        throw createSanitizedError(
          "VEO video task succeeded but no URL found",
          "Video generation"
        )
      }

      console.log(
        `[KIE.ai] VEO Video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return {
        url: videoUrl,
        cost: modelConfig.cost,
        kieTaskId: veoResult.taskId,
        seed: veoResult.seed,
        fallbackFlag: veoResult.fallbackFlag,
        providerMs: veoResult.providerMs,
      }
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

    // Only set the image param when we actually have a start frame URL.
    // Seedance 2 reference-only mode omits first_frame_url intentionally.
    if (effectiveImageUrl) {
      if (imageParamName === "image_urls" || imageParamName === "input_urls" || imageParamName === "reference_image") {
        // Array format for kling, grok, seedance, wan-i2v, happyhorse-i2v, happyhorse-ref2v
        input[imageParamName] = [effectiveImageUrl]
      } else {
        // Single URL format for hailuo, kling-turbo, bytedance, wan-turbo, kling-master, wan-2.7-i2v
        input[imageParamName] = effectiveImageUrl
      }
    }

    // Merge reference images for models that support multi-image input
    if (modelConfig.maxRefImages && options?.referenceImageUrls?.length) {
      const merged = effectiveImageUrl
        ? [effectiveImageUrl, ...options.referenceImageUrls]
        : [...options.referenceImageUrls]
      input[imageParamName] = merged.slice(0, modelConfig.maxRefImages)
    }

    // Override duration if provided
    if (duration) {
      const snapped = snapToAllowedDuration(duration, modelConfig.allowedDurations ?? [])
      if (snapped !== duration) {
        console.log(`[KIE.ai] Duration ${duration}s not allowed, snapped to ${snapped}s (allowed: ${JSON.stringify(modelConfig.allowedDurations)})`)
      }
      input.duration = String(snapped)
    }

    if (effectiveEndFrameUrl) {
      if (provider === "seedance") {
        input.input_urls = [effectiveImageUrl, effectiveEndFrameUrl]
      } else if (isSeedance2Provider(provider) || provider === "wan-2.7-i2v") {
        input.last_frame_url = effectiveEndFrameUrl
      } else if (provider === "kling-turbo") {
        input.tail_image_url = effectiveEndFrameUrl
      } else if (provider === "minimax" || provider === "hailuo-standard" || provider === "bytedance-lite") {
        input.end_image_url = effectiveEndFrameUrl
      } else {
        input.end_frame = effectiveEndFrameUrl
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
      // Hailuo 2.3 Pro/Standard: 1080P only supports 6s duration
      if ((provider === "hailuo-2.3-pro" || provider === "hailuo-2.3") && options.resolution === "1080P" && input.duration && Number(input.duration) > 6) {
        console.log(`[KIE.ai] Hailuo 2.3: 1080P does not support ${input.duration}s, snapping to 6s`)
        input.duration = "6"
      }
    }

    // Grok I2V mode (fun/normal/spicy)
    if (options?.grokMode && provider === "grok-i2v") {
      input.mode = options.grokMode
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

    if (provider === "seedance") {
      if (options?.generateAudio !== undefined) input.generate_audio = options.generateAudio
      if (options?.aspectRatio) input.aspect_ratio = options.aspectRatio
    }

    if (isSeedance2Provider(provider)) {
      const { hasMultimodalRef } = applySeedance2Params(input, options)
      if (hasMultimodalRef) {
        if (endFrameUrl) {
          throw createSanitizedError(
            "Seedance 2.0: reference videos/audio cannot be combined with start+end frame. Disconnect one mode before running.",
            "Video generation",
          )
        }
        delete input.first_frame_url
        delete input.last_frame_url
      }
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

    const { resultJson, rawRecordInfo, taskId: kieTaskId, providerMs } = await runKieTask(
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

    return { url: videoUrl, cost: modelConfig.cost, ...(kieTaskId && { kieTaskId }), ...(providerMs !== undefined && { providerMs }) }
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

    // VEO3/VEO3.1 uses a special API endpoint
    if (isVeoProvider(provider)) {
      const veoResult = await runVeoTask(
        modelConfig.model,
        prompt,
        undefined,
        {
          aspectRatio: aspectRatio ?? options?.aspectRatio,
          seed: options?.seed,
          resolution: options?.resolution,
          enableTranslation: options?.enableTranslation,
        }
      )

      const videoUrl =
        veoResult.resultJson.resultUrls?.[0] ?? veoResult.resultJson.videoUrl
      if (!videoUrl) {
        throw createSanitizedError(
          "VEO text-to-video task succeeded but no URL found",
          "Video generation"
        )
      }

      console.log(
        `[KIE.ai] VEO Text-to-video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return {
        url: videoUrl,
        cost: modelConfig.cost,
        kieTaskId: veoResult.taskId,
        seed: veoResult.seed,
        fallbackFlag: veoResult.fallbackFlag,
        providerMs: veoResult.providerMs,
      }
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
      input.duration = String(snapped)
    }

    // Override aspect ratio if provided
    if (aspectRatio) {
      const ratioKey = modelConfig.aspectRatioParam ?? "aspect_ratio"
      input[ratioKey] = mapAspectRatio(provider, aspectRatio)
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

    if (options?.resolution && !isSeedance2Provider(provider)) {
      input.resolution = options.resolution
    }

    if (isSeedance2Provider(provider)) {
      applySeedance2Params(input, options)
    }

    console.log(
      `[KIE.ai] Final input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson, taskId: kieTaskId, providerMs } = await runKieTask(
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

    return { url: videoUrl, cost: modelConfig.cost, ...(kieTaskId && { kieTaskId }), ...(providerMs !== undefined && { providerMs }) }
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
      if (options?.referenceImageUrl) {
        alephInput.referenceImage = options.referenceImageUrl
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

    // HappyHorse Video Edit uses video_url (array, one element) + optional reference_image
    if (provider === "happyhorse-edit") {
      const input: Record<string, unknown> = {
        ...(modelConfig.extraParams ?? {}),
        prompt: finalPrompt,
        video_url: [videoUrl],
      }
      if (options?.referenceImageUrl) {
        input.reference_image = [options.referenceImageUrl]
      }
      if (options?.resolution) {
        input.resolution = options.resolution
      }
      console.log(`[KIE.ai] HappyHorse Edit input:`, JSON.stringify(input, null, 2))
      const { resultJson, providerMs } = await runKieTask(
        modelConfig.model,
        input,
        MAX_POLL_ATTEMPTS_VIDEO,
        options?.onProgress
      )
      const outputUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (!outputUrl) {
        throw createSanitizedError("HappyHorse Edit task succeeded but no URL found", "Video generation")
      }
      console.log(`[KIE.ai] HappyHorse Edit completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`)
      return { url: outputUrl, cost: modelConfig.cost, ...(providerMs !== undefined && { providerMs }) }
    }

    // Wan 2.7 VideoEdit — single video_url string, optional reference_image
    if (provider === "wan-videoedit") {
      const input: Record<string, unknown> = {
        ...(modelConfig.extraParams ?? {}),
        prompt: finalPrompt,
        video_url: videoUrl,
        resolution: options?.resolution ?? "1080p",
      }
      if (options?.negativePrompt) input.negative_prompt = options.negativePrompt
      if (options?.aspectRatio) input.aspect_ratio = options.aspectRatio
      // duration: 0 = auto-detect, 2-10 = target seconds
      const durStr = options?.videoEditDuration ?? "0"
      input.duration = Number(durStr)
      if (options?.audioSetting) input.audio_setting = options.audioSetting
      if (options?.promptExtend !== undefined) input.prompt_extend = options.promptExtend
      if (options?.seed !== undefined && options.seed >= 0) input.seed = options.seed
      if (options?.referenceImageUrl) input.reference_image = options.referenceImageUrl

      console.log(`[KIE.ai] Wan VideoEdit input:`, JSON.stringify(input, null, 2))
      const { resultJson, providerMs } = await runKieTask(
        modelConfig.model,
        input,
        MAX_POLL_ATTEMPTS_VIDEO,
        options?.onProgress
      )
      const outputUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
      if (!outputUrl) {
        throw createSanitizedError(
          "Wan VideoEdit task succeeded but no URL found in response",
          "Video generation"
        )
      }
      console.log(
        `[KIE.ai] Wan VideoEdit completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`
      )
      return { url: outputUrl, cost: modelConfig.cost, ...(providerMs !== undefined && { providerMs }) }
    }

    // Standard createTask endpoint for Wan V2V providers (Wan 2.6, Wan Flash)
    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      prompt: finalPrompt,
      video_urls: [videoUrl], // Standard V2V models use video_urls array
    }

    // Wan / Wan Flash optional params
    if (options?.duration) {
      input.duration = options.duration
    }
    if (options?.resolution) {
      input.resolution = options.resolution
    }
    // Wan Flash specific params
    if (provider === "wan-flash") {
      if (options?.audio !== undefined) {
        input.audio = options.audio
      }
      if (options?.multiShots !== undefined) {
        input.multi_shots = options.multiShots
      }
    }

    console.log(
      `[KIE.ai] Final input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson, providerMs } = await runKieTask(
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

    return { url: outputUrl, cost: modelConfig.cost, ...(providerMs !== undefined && { providerMs }) }
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

    // Auto-convert image format/size if needed (Kling 2.6/3.0: JPEG/PNG only; all: max 10MB)
    const motionConstraints: ImageConstraints = { context: "Motion transfer" }
    // Kling 2.6 motion control rejects WebP (even though Kling 2.6 I2V accepts it)
    if (provider === "kling" || provider === "kling-3.0") {
      motionConstraints.acceptedFormats = JPEG_PNG_ONLY
    }
    if (provider === "kling") {
      motionConstraints.minDimension = 300
      motionConstraints.minAspectRatio = 2 / 5
      motionConstraints.maxAspectRatio = 5 / 2
    }
    const effectiveImageUrl = await ensureImageForProvider(imageUrl, provider, motionConstraints)

    console.log(
      `[KIE.ai] ========== MOTION TRANSFER REQUEST ==========`
    )
    console.log(`[KIE.ai] Provider: ${provider}`)
    console.log(`[KIE.ai] Model: ${modelConfig.model}`)
    console.log(
      `[KIE.ai] Image URL (character source): ${effectiveImageUrl}${effectiveImageUrl !== imageUrl ? " (converted)" : ""}`
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
      // Auto-trim video if it exceeds the 30-second motion-transfer limit
      const effectiveVideoUrl = await ensureVideoDuration(videoUrl, MOTION_TRANSFER_MAX_VIDEO_SECONDS)

      // motion-control uses "720p"/"1080p" (same as kling-2.6/motion-control),
      // NOT "std"/"pro" (which is for kling-3.0/video generation)
      const motionMode = resolution === "1080p" ? "1080p" : "720p"

      const input: Record<string, unknown> = {
        input_urls: [effectiveImageUrl],
        video_urls: [effectiveVideoUrl],
        character_orientation: characterOrientation,
        mode: motionMode,
      }

      // Always send background_source explicitly — KIE defaults to input_image if omitted
      input.background_source = options?.backgroundSource ?? "input_video"

      if (prompt) {
        input.prompt = prompt
      }

      console.log(
        `[KIE.ai] Kling 3.0 Motion Transfer Request:`,
        JSON.stringify(input, null, 2)
      )

      const { resultJson, providerMs } = await runKieTask(
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

      return { url: outputUrl, cost: modelConfig.cost, ...(providerMs !== undefined && { providerMs }) }
    }

    // Wan 2.2 Animate (Move/Replace) — standard createTask
    // Input: image_url (string) + video_url (string) + resolution
    if (provider === "wan-animate-move" || provider === "wan-animate-replace") {
      const wanResolution = options?.resolution ?? "480p"
      const input: Record<string, unknown> = {
        image_url: effectiveImageUrl,
        video_url: videoUrl,
        resolution: wanResolution,
      }

      console.log(
        `[KIE.ai] Wan Animate ${provider === "wan-animate-move" ? "Move" : "Replace"} Request:`,
        JSON.stringify(input, null, 2)
      )

      const { resultJson, providerMs } = await runKieTask(
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

      return { url: outputUrl, cost: modelConfig.cost, ...(providerMs !== undefined && { providerMs }) }
    }

    // Kling 2.6 Motion Control — original behavior
    // NOTE: Field is "mode" not "resolution" per KIE.ai API docs
    // Auto-trim video if it exceeds the 30-second motion-transfer limit
    const effectiveVideoUrl = await ensureVideoDuration(videoUrl, MOTION_TRANSFER_MAX_VIDEO_SECONDS)

    const input: Record<string, unknown> = {
      input_urls: [effectiveImageUrl], // Array of image URLs (character reference)
      video_urls: [effectiveVideoUrl], // Array of video URLs (motion source)
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

    const { resultJson, providerMs } = await runKieTask(
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

    return { url: outputUrl, cost: modelConfig.cost, ...(providerMs !== undefined && { providerMs }) }
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

    const { resultJson, providerMs } = await runKieTask(
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

    return { url: outputUrl, cost: modelConfig.cost, ...(providerMs !== undefined && { providerMs }) }
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

    const { resultJson, providerMs } = await runKieTask(
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

    return { url: videoUrl, cost: modelConfig.cost, ...(providerMs !== undefined && { providerMs }) }
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

    const { resultJson, providerMs } = await runKieTask(
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

    return { url: videoUrl, cost: modelConfig.cost, ...(providerMs !== undefined && { providerMs }) }
  }
}
