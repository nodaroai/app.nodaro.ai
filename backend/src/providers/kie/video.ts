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
  ReconcileOpts,
} from "../provider.interface.js"
import { SEEDANCE_2_REF_LIMITS, isSeedance2Provider, isVeoProvider, getLipSyncMaxAudioSeconds, applyVideoNegativePrompt, getModel } from "@nodaro/shared"
import {
  createSanitizedError,
  runKieTask,
  runVeoTask,
  runVeoExtendTask,
  MAX_POLL_ATTEMPTS_VIDEO,
  MAX_POLL_ATTEMPTS_LIP_SYNC_LONG,
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
import { safeFetch } from "../../lib/safe-fetch.js"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import sharp from "sharp"

function mapAspectRatio(_provider: string, aspectRatio: string): string {
  return aspectRatio
}

/**
 * Aspect ratios we forward to KIE for grok-imagine-video-1.5 — derived from the
 * model catalog (the single source for the picker) plus the "auto" default, so
 * the runtime allowlist can't drift from what the UI offers. An aspect_ratio is
 * forwarded only when it's in this set; anything else (e.g. 21:9 from the shared
 * Zod enum) falls back to the extraParams "auto" default instead of erroring at
 * KIE. "Auto"/"adaptive" normalize to "auto".
 */
const GROK_VIDEO_15_ASPECT_RATIOS = new Set<string>([
  ...(getModel("grok-imagine-video-1.5")?.aspectRatios ?? []),
  "auto",
])

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

// Audio-duration cap per lip-sync provider (seconds).
// Kling AI Avatar 2.0 raised its limit to 5min (May 2026). InfiniTalk still
// enforces a 15s cap upstream. Subtract a small safety margin so ffprobe /
// KIE.ai rounding never trips the upstream rejection.
const LIP_SYNC_AUDIO_SAFETY_MARGIN_SEC = 0.5
function lipSyncAudioCapFor(provider: string): number {
  return getLipSyncMaxAudioSeconds(provider) - LIP_SYNC_AUDIO_SAFETY_MARGIN_SEC
}

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

  // Download and inspect the image. safeFetch (DNS+IP gate at connect time)
  // because imageUrl is user-supplied and the bytes are decoded/processed
  // server-side — raw fetch here is an SSRF read-oracle (safeUrlSchema is
  // only a syntactic gate and cannot see what a hostname resolves to).
  const res = await safeFetch(imageUrl, { timeoutMs: 30_000 })
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
  reconcileOpts?: ReconcileOpts,
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
  }, reconcileOpts)

  // Audit log for Kling 3.0 (known to have variable duration/audio pricing)
  logCreditAudit({
    modelKey: "kling-3.0",
    expectedKieCredits: modelConfig.cost / KIE_CREDIT_USD, // Convert USD to KIE credits
    modelConfig: { duration: snappedDuration, sound, mode },
    notes: `kling-3.0 ${snappedDuration}s ${sound ? "audio" : "no-audio"} ${mode}`,
  })

  return { url: result.videoUrl, cost: modelConfig.cost }
}

/** KIE Gemini Omni Video accepted resolution values (lowercase, per the API). */
const GEMINI_OMNI_RESOLUTIONS = ["720p", "1080p", "4k"]

/** Wholesale USD cost for a Gemini Omni tier (KIE-published; KIE bills $0.005/credit).
 *  The provider MUST report the ACTUAL tier cost — like every other provider does — so the
 *  credit-commit charges that tier. Returning a flat cheapest-tier cost (the old behavior)
 *  under-charged 4K / long / video-edit jobs. 720p and 1080p share a price band.
 ***REDACTED-OSS-SCRUB***
 ***REDACTED-OSS-SCRUB***
function geminiOmniTierCostUsd(resolution: string, durationSec: number, videoConnected: boolean): number {
  const is4k = resolution === "4k"
  if (videoConnected) return is4k ? 1.8 : 1.2 // video-edit is a flat per-generation price
  const byDuration: Record<number, number> = is4k
    ? { 4: 1.05, 6: 1.2, 8: 1.35, 10: 1.5 }
    : { 4: 0.45, 6: 0.6, 8: 0.75, 10: 0.9 }
  return byDuration[durationSec] ?? (is4k ? 1.05 : 0.45)
}

/** Shared helper for Gemini Omni Video calls from both imageToVideo and textToVideo.
 *  Standard market endpoint; multimodal input + native audio. Callers compute the
 *  per-method `prompt` / `imageUrls` / `aspectRatioValue`; everything else is identical.
 *  Defensively validates duration / resolution / trim-window / video-count here because
 *  this is the single choke point both the single-node route AND the orchestrator reach. */
async function runGeminiOmni(
  modelConfig: { model: string; cost: number; allowedDurations?: number[] },
  prompt: string,
  duration: number | undefined,
  aspectRatioValue: string | undefined,
  imageUrls: string[],
  options: ProviderOptions | undefined,
  reconcileOpts: ReconcileOpts | undefined,
  logLabel: string,
): Promise<ProviderResult> {
  const videoUrls = options?.referenceVideoUrls ?? []
  // Gemini Omni V2V accepts exactly ONE source video — reject extras rather than
  // silently using only the first (the route Zod allows up to 3 for other models).
  if (videoUrls.length > 1) {
    throw createSanitizedError(
      "Gemini Omni: only one source video is supported",
      "Video generation",
    )
  }
  const videoConnected = videoUrls.length > 0
  // KIE quota: images + videos*2 (+ character_ids, none in Phase 1) ≤ 7.
  // Check the RAW count and reject overflow (do NOT silently truncate).
  if (imageUrls.length + (videoConnected ? 2 : 0) > 7) {
    throw createSanitizedError(
      "Gemini Omni: too many inputs (images + 2×videos must be ≤ 7)",
      "Video generation",
    )
  }
  // Validate resolution against KIE's allowed set; default off-list values (e.g. a
  // non-UI caller sending "2k"/"480p"/"4K") to 720p rather than failing at the API.
  const reqResolution = options?.resolution
  const resolution = reqResolution && GEMINI_OMNI_RESOLUTIONS.includes(reqResolution) ? reqResolution : "720p"
  let videoList: Array<Record<string, unknown>> | undefined
  if (videoConnected) {
    // Clamp the trim window to KIE's contract (integer seconds, 0 ≤ start < ends,
    // ends − start ≤ 10). The route superRefine only guards single-node; orchestrator
    // / imported-workflow callers reach here unchecked.
    const start = Math.max(0, Math.floor(options?.videoTrimStart ?? 0))
    const rawEnd = options?.videoTrimEnd != null ? Math.floor(options.videoTrimEnd) : start + 10
    const ends = Math.min(Math.max(rawEnd, start + 1), start + 10)
    videoList = [{ url: videoUrls[0], start, ends }]
  }
  // Snap once; the value feeds both the KIE payload and the per-tier cost below.
  const snappedDuration = snapToAllowedDuration(duration ?? 8, modelConfig.allowedDurations ?? [4, 6, 8, 10])
  // Report the ACTUAL per-tier wholesale cost (resolution band × duration, or flat for V2V)
  // so the credit-commit charges the right tier instead of the flat cheapest-tier cost.
  const tierCostUsd = geminiOmniTierCostUsd(resolution, snappedDuration, videoConnected)
  const geminiInput: Record<string, unknown> = {
    prompt,
    resolution,
    ...(aspectRatioValue ? { aspect_ratio: aspectRatioValue } : {}),
    // V2V auto-determines duration from the clip; for t2v/i2v send the snapped tier so the
    // value sent to KIE matches the tier the credit identifier billed.
    ...(videoList ? { video_list: videoList } : { duration: String(snappedDuration) }),
    ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    // Omit the -1 "random" sentinel (and any negative); only forward real seeds.
    ...(options?.seed != null && options.seed >= 0 ? { seed: options.seed } : {}),
  }
  console.log(`[KIE.ai] ${logLabel} input:`, JSON.stringify(geminiInput, null, 2))
  const { resultJson, taskId: gTaskId, providerMs } = await runKieTask(
    modelConfig.model, geminiInput, MAX_POLL_ATTEMPTS_VIDEO, options?.onProgress, reconcileOpts,
  )
  const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!videoUrl) {
    throw createSanitizedError(`${logLabel} task succeeded but no URL found`, "Video generation")
  }
  console.log(`[KIE.ai] ${logLabel} completed: ${videoUrl} (tier cost: $${tierCostUsd.toFixed(4)})`)
  return { url: videoUrl, cost: tierCostUsd, ...(gTaskId && { kieTaskId: gTaskId }), ...(providerMs !== undefined && { providerMs }) }
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
    options?: ProviderOptions,
    reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const provider = model ?? "minimax"
    const modelConfig = KIE_VIDEO_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support video provider: ${provider}`,
        "Video generation"
      )
    }

    // Per-provider negative-prompt routing — for providers that don't
    // accept `negative_prompt` natively, append "Avoid: <text>" to the
    // user prompt so the negative intent still reaches the model.
    const { prompt: effectivePrompt, nativeNegativePrompt } =
      applyVideoNegativePrompt(prompt, options?.negativePrompt, provider)

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
    // Hoisted so the reference-image merge below can reuse the SAME constraints —
    // a raw, oversize/RGBA reference image otherwise bypasses normalization and
    // triggers an upstream 400/500 on multi-reference i2v (grok-i2v, happyhorse-ref2v).
    const i2vConstraints: ImageConstraints = { context: "Video generation", maxDimension: 2048 }
    if (provider === "wan-i2v") i2vConstraints.minDimension = 256
    if (modelConfig.model.startsWith("hailuo/")) i2vConstraints.forceJpeg = true
    if (!usesRawImageUrls) {
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
        effectivePrompt ?? "smooth cinematic motion",
        duration,
        options?.aspectRatio ?? "16:9",
        options,
        imageUrls,
        reconcileOpts,
      )
    }

    // VEO 3.1 uses a special API endpoint
    if (isVeoProvider(provider)) {
      let imageUrls: string[]
      if (options?.generationType === "REFERENCE_2_VIDEO" && options?.referenceImageUrls?.length) {
        imageUrls = options.referenceImageUrls.slice(0, 3)
      } else {
        imageUrls = endFrameUrl
          ? [imageUrl!, endFrameUrl]
          : [imageUrl!]
      }
      const snappedDuration = duration
        ? snapToAllowedDuration(duration, modelConfig.allowedDurations ?? [])
        : undefined
      const veoResult = await runVeoTask(
        modelConfig.model,
        effectivePrompt ?? "smooth cinematic motion",
        imageUrls,
        {
          aspectRatio: options?.aspectRatio,
          seed: options?.seed,
          generationType: options?.generationType,
          resolution: options?.resolution,
          enableTranslation: options?.enableTranslation,
          duration: snappedDuration,
        },
        reconcileOpts,
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
        prompt: effectivePrompt ?? "smooth cinematic motion",
        duration: snapped,
        imageUrl,
      }
      const { resultJson, taskId: runwayTaskId } = await runRunwayTask(runwayInput, reconcileOpts)
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

    // Gemini Omni Video — multimodal input + native audio. imageToVideo has no
    // top-level aspectRatio param (unlike textToVideo); read from options only.
    if (provider === "gemini-omni-video") {
      const imageUrls = [effectiveImageUrl, ...(options?.referenceImageUrls ?? [])].filter(
        (u): u is string => !!u,
      )
      return runGeminiOmni(
        modelConfig,
        effectivePrompt ?? "smooth cinematic motion",
        duration,
        options?.aspectRatio,
        imageUrls,
        options,
        reconcileOpts,
        "Gemini Omni",
      )
    }

    // Standard createTask endpoint for other providers
    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      prompt: effectivePrompt ?? "smooth cinematic motion",
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

    // Merge reference images for models that support multi-image input. Normalize
    // each ref through the SAME i2v constraints as the primary frame (2048px cap,
    // JPEG re-encode for the hailuo family) — otherwise a raw oversize/RGBA ref
    // reaches KIE unprocessed and 400/500s on a common multi-reference path. VEO/
    // runway-kie reference raw URLs via their own endpoints (mirrors the start frame).
    if (modelConfig.maxRefImages && options?.referenceImageUrls?.length) {
      const refs = usesRawImageUrls
        ? options.referenceImageUrls
        : await Promise.all(
            options.referenceImageUrls.map((u) => ensureImageForProvider(u, provider, i2vConstraints)),
          )
      const merged = effectiveImageUrl
        ? [effectiveImageUrl, ...refs]
        : [...refs]
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
    // Native negative_prompt for providers in NATIVE_NEGATIVE_VIDEO_PROVIDERS
    // (Kling family / Wan family). For everyone else the negative was already
    // injected into `effectivePrompt` above as "Avoid: …", so we don't send
    // a native field they'd ignore.
    if (nativeNegativePrompt) {
      input.negative_prompt = nativeNegativePrompt
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

    // Grok Imagine Video 1.5 — forward aspect_ratio when KIE accepts the value
    // (Auto/adaptive → "auto"). resolution + duration + image_urls are already
    // applied by the generic path above; image_urls is required by this model.
    if (provider === "grok-imagine-video-1.5") {
      const arRaw = options?.aspectRatio
      const ar = arRaw === "Auto" || arRaw === "adaptive" ? "auto" : arRaw
      if (ar && GROK_VIDEO_15_ASPECT_RATIOS.has(ar)) {
        input.aspect_ratio = ar
      }
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
      options?.onProgress,
      reconcileOpts,
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
    options?: ProviderOptions,
    reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const provider = model ?? "minimax"
    const modelConfig = KIE_TEXT_TO_VIDEO_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support text-to-video provider: ${provider}`,
        "Video generation"
      )
    }

    // Per-provider negative-prompt routing — see imageToVideo above.
    const { prompt: effectivePromptOrUndefined, nativeNegativePrompt } =
      applyVideoNegativePrompt(prompt, options?.negativePrompt, provider)
    const effectivePrompt = effectivePromptOrUndefined ?? prompt

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
        effectivePrompt,
        duration,
        aspectRatio ?? options?.aspectRatio ?? "16:9",
        options,
        undefined,
        reconcileOpts,
      )
    }

    // VEO 3.1 uses a special API endpoint
    if (isVeoProvider(provider)) {
      const snappedDuration = duration
        ? snapToAllowedDuration(duration, modelConfig.allowedDurations ?? [])
        : undefined
      const veoResult = await runVeoTask(
        modelConfig.model,
        effectivePrompt,
        undefined,
        {
          aspectRatio: aspectRatio ?? options?.aspectRatio,
          seed: options?.seed,
          resolution: options?.resolution,
          enableTranslation: options?.enableTranslation,
          duration: snappedDuration,
        },
        reconcileOpts,
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
        prompt: effectivePrompt,
        duration: snapped,
        ...(aspectRatio && { aspectRatio }),
      }
      const { resultJson, taskId: runwayTaskId } = await runRunwayTask(runwayInput, reconcileOpts)
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

    // Gemini Omni Video — text-to-video (defensive V2V/I2V if refs present).
    if (provider === "gemini-omni-video") {
      const imageUrls = (options?.referenceImageUrls ?? []).filter((u): u is string => !!u)
      return runGeminiOmni(
        modelConfig,
        effectivePrompt,
        duration,
        aspectRatio ?? options?.aspectRatio,
        imageUrls,
        options,
        reconcileOpts,
        "Gemini Omni (t2v)",
      )
    }

    // Standard createTask endpoint for other providers
    const input: Record<string, unknown> = {
      ...(modelConfig.extraParams ?? {}),
      prompt: effectivePrompt,
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
    // Native negative_prompt for providers in NATIVE_NEGATIVE_VIDEO_PROVIDERS.
    // Non-native providers got "Avoid: …" injected into `effectivePrompt` above.
    if (nativeNegativePrompt) {
      input.negative_prompt = nativeNegativePrompt
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
      options?.onProgress,
      reconcileOpts,
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
    options?: ProviderOptions,
    reconcileOpts?: ReconcileOpts,
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

    // Per-provider negative-prompt routing — see imageToVideo above.
    const { prompt: promptWithMaybeNegative, nativeNegativePrompt } =
      applyVideoNegativePrompt(prompt, options?.negativePrompt, provider)
    const finalPrompt =
      promptWithMaybeNegative ?? "continue this video with smooth cinematic motion"

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
      const { resultJson, taskId: alephTaskId } = await runAlephTask(alephInput, reconcileOpts)
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
      }, reconcileOpts)
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
        options?.onProgress,
        reconcileOpts,
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
      if (nativeNegativePrompt) input.negative_prompt = nativeNegativePrompt
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
        options?.onProgress,
        reconcileOpts,
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
      options?.onProgress,
      reconcileOpts,
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
      negativePrompt?: string
    },
    reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const provider = options?.provider ?? "kling"
    const modelConfig = KIE_MOTION_TRANSFER_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `Motion transfer model not configured for provider: ${provider}`,
        "Motion transfer"
      )
    }

    // Per-provider negative-prompt routing — Kling 2.6 / 3.0 accept
    // `negative_prompt` natively; Wan Animate Move/Replace doesn't, so the
    // negative gets injected into the prompt as "Avoid: …" instead.
    const { prompt: effectivePrompt, nativeNegativePrompt } =
      applyVideoNegativePrompt(prompt, options?.negativePrompt, provider)

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

      if (effectivePrompt) {
        input.prompt = effectivePrompt
      }
      if (nativeNegativePrompt) {
        input.negative_prompt = nativeNegativePrompt
      }

      console.log(
        `[KIE.ai] Kling 3.0 Motion Transfer Request:`,
        JSON.stringify(input, null, 2)
      )

      const { resultJson, providerMs } = await runKieTask(
        modelConfig.model,
        input,
        MAX_POLL_ATTEMPTS_VIDEO,
        options?.onProgress,
        reconcileOpts,
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
    // Input: image_url (string) + video_url (string) + resolution + optional prompt
    if (provider === "wan-animate-move" || provider === "wan-animate-replace") {
      const wanResolution = options?.resolution ?? "480p"
      const input: Record<string, unknown> = {
        image_url: effectiveImageUrl,
        video_url: videoUrl,
        resolution: wanResolution,
      }

      // Wan Animate doesn't accept `negative_prompt` natively — the helper
      // already injected "Avoid: …" into `effectivePrompt`. Send whatever
      // prompt we have (positive + injected negative) so the model can act
      // on it. KIE silently ignores unknown fields, so providers that don't
      // act on `prompt` won't error out.
      if (effectivePrompt) {
        input.prompt = effectivePrompt
      }

      console.log(
        `[KIE.ai] Wan Animate ${provider === "wan-animate-move" ? "Move" : "Replace"} Request:`,
        JSON.stringify(input, null, 2)
      )

      const { resultJson, providerMs } = await runKieTask(
        modelConfig.model,
        input,
        MAX_POLL_ATTEMPTS_VIDEO,
        options?.onProgress,
        reconcileOpts,
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
    if (effectivePrompt) {
      input.prompt = effectivePrompt
    }
    if (nativeNegativePrompt) {
      input.negative_prompt = nativeNegativePrompt
    }

    console.log(
      `[KIE.ai] Motion Transfer Request:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson, providerMs } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO,
      options?.onProgress,
      reconcileOpts,
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
    options?: ProviderOptions,
    reconcileOpts?: ReconcileOpts,
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
      options?.onProgress,
      reconcileOpts,
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
    resolution?: string,
    audioDurationSec?: number,
    reconcileOpts?: ReconcileOpts,
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

    // Auto-trim audio to the provider's upstream cap (300s for kling-avatar(-pro),
    // 15s for infinitalk).
    const audioCapSec = lipSyncAudioCapFor(provider)
    const effectiveAudioUrl = await ensureAudioDuration(audioUrl, audioCapSec)

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

    // Long-audio kling-avatar runs can take "tens of minutes" per KIE's
    // 2026-05-11 upgrade notes — extend the poll budget for those providers.
    // We use the long budget whenever the requested audio exceeds 30s so
    // shorter runs still fail fast.
    const isLongCapableProvider = provider === "kling-avatar" || provider === "kling-avatar-pro"
    const usesLongBudget = isLongCapableProvider && (audioDurationSec === undefined || audioDurationSec > 30)
    const pollAttempts = usesLongBudget ? MAX_POLL_ATTEMPTS_LIP_SYNC_LONG : MAX_POLL_ATTEMPTS_VIDEO
    if (audioDurationSec !== undefined) {
      console.log(`[KIE.ai] Lip-sync audio duration: ${audioDurationSec.toFixed(1)}s, poll budget: ${pollAttempts}`)
    }

    const { resultJson, providerMs } = await runKieTask(
      modelConfig.model,
      input,
      pollAttempts,
      undefined,
      reconcileOpts,
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
    },
    reconcileOpts?: ReconcileOpts,
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
      options?.onProgress,
      reconcileOpts,
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

// =====================================================================
// Phase 1C.3 — Method 3: Video Extension (provider wrappers)
// =====================================================================

/**
 * Method 3 inputs (v4.1 spec §5.13.6). Both wrappers below accept the same
 * shape so the upcoming `pipelineExtendVideo` service wrapper (Task E1) can
 * dispatch to either provider with one parameter set.
 *
 * Note on `priorClipKieTaskId` vs `priorClipUrl`: KIE's VEO Extend endpoint
 * REQUIRES the `taskId` of the original VEO generation (videos must have been
 * generated through the VEO3.1 API itself — extension by URL is not supported
 * per https://docs.kie.ai/veo3-api/extend-video.md). The service-wrapper layer
 * MUST resolve `priorClipKieTaskId` from the prior shot's persisted
 * `jobs.output_data.kieTaskId`. If the prior shot wasn't generated by VEO,
 * extension is impossible and the wrapper throws — Section H Shot List Critic
 * will gate this at planning time so it shouldn't reach execution.
 */
export interface KieExtendVideoArgs {
  /** Required for VEO — KIE taskId of the original VEO clip. */
  priorClipKieTaskId?: string
  /** Required for Seedance — URL of the prior clip. (Currently unsupported
   *  by KIE — see kieExtendVideoSeedance below.) */
  priorClipUrl?: string
  /** Motion / continuation prompt for the extended segment. */
  prompt: string
  /** Optional duration (provider-snapped). */
  duration?: number
  /** Optional VEO model variant override. */
  veoModelVariant?: "fast" | "quality" | "lite"
  /** Optional seed (10000-99999). */
  seed?: number
}

export interface KieExtendVideoResult {
  url: string
  cost?: number
  kieTaskId: string
  providerMs?: number
}

/**
 * VEO 3.1 video extension. Thin wrapper over `runVeoExtendTask` so the
 * pipeline service-wrapper (Task E1) doesn't need to know about KIE-specific
 * client internals. KIE requires the original taskId — extension by URL is
 * NOT supported.
 *
 * Throws `provider_not_available:veo3.1-extend:missing_task_id` if the caller
 * doesn't pass `priorClipKieTaskId`. Service-wrapper layer is responsible for
 * resolving the taskId from the prior shot's persisted job output.
 */
export async function kieExtendVideoVEO(
  args: KieExtendVideoArgs,
): Promise<KieExtendVideoResult> {
  const { priorClipKieTaskId, prompt, veoModelVariant, seed } = args
  if (!priorClipKieTaskId) {
    throw createSanitizedError(
      "provider_not_available:veo3.1-extend:missing_task_id — VEO Extend requires the original taskId; extension by URL is not supported by KIE.",
      "Video extension",
    )
  }
  // veoModelVariant: "lite" → fall back to "fast" (VEO Extend only accepts fast/quality).
  const model: "fast" | "quality" =
    veoModelVariant === "quality" ? "quality" : "fast"
  const result = await runVeoExtendTask(priorClipKieTaskId, prompt, model, seed)
  const url = result.resultJson.resultUrls?.[0]
  if (!url) {
    throw createSanitizedError(
      "VEO extend succeeded but no resultUrl",
      "Video extension",
    )
  }
  return {
    url,
    kieTaskId: result.taskId,
    providerMs: result.providerMs,
  }
}

/**
 * Seedance 2 video extension — UNSUPPORTED.
 *
 * As of 2026-05, KIE's Seedance 2 endpoint exposes `reference_video_urls` but
 * the parameter is a multi-video STYLE reference, not a continuation primitive
 * (per https://docs.kie.ai/market/bytedance/seedance-2). The model has no
 * `video_reference_url` / `extend` / `continuation` knob.
 *
 * Throws `provider_not_available:seedance-2-extend` so the Shot List Critic
 * (Section H) flags any shot that requests Seedance-based video_continuation
 * at planning time. Update this wrapper if/when ByteDance ships a true
 * extension primitive.
 *
 * TODO(1C.3 Section H): Add Shot List Critic eligibility rule rejecting
 *   `shot_input_mode='video_continuation'` with `video_model='seedance-2'`.
 */
export async function kieExtendVideoSeedance(
  _args: KieExtendVideoArgs,
): Promise<KieExtendVideoResult> {
  throw createSanitizedError(
    "provider_not_available:seedance-2-extend — Seedance 2 does not expose a video-extension parameter (reference_video_urls is style-only, not continuation). Use VEO 3.1 for Method 3.",
    "Video extension",
  )
}
