import type { Job } from "bullmq"
import { promises as fs } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import youtubedl from "youtube-dl-exec"
import { config, hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { CreditsService } from "../services/credits.js"
import { uploadToR2, uploadFileToR2, uploadBufferToR2, uploadFileWithKeyToR2 } from "../lib/storage.js"
import { applyImageWatermark, applyVideoWatermark } from "../utils/watermark.js"
import { generateThumbnailFromUrl } from "../utils/thumbnail.js"
import { createWorkDir, cleanupWorkDir, downloadFile, transcodeToBrowserSafe } from "../providers/video/ffmpeg-utils.js"

export interface JobContext {
  jobId: string
  jobUserId: string | undefined
  usageLogId: string | null | undefined
  shouldWatermark: boolean
}

export type HandlerFn = (job: Job, ctx: JobContext) => Promise<void>

const SOCIAL_HOSTNAMES = [
  "youtube.com", "youtu.be",
  "tiktok.com",
  "instagram.com",
  "twitter.com", "x.com",
  "facebook.com", "fb.watch", "fb.com",
]

export function isSocialUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return SOCIAL_HOSTNAMES.some((h) => parsed.hostname.includes(h))
  } catch {
    return false
  }
}

export async function downloadAudioToR2(url: string): Promise<string> {
  const outputId = randomUUID()
  const baseName = `yt-audio-${outputId}`
  const outputTemplate = join(tmpdir(), `${baseName}.%(ext)s`)
  const expectedPath = join(tmpdir(), `${baseName}.mp3`)

  console.log(`[worker] Downloading audio from social URL: ${url}`)

  await youtubedl(url, {
    extractAudio: true,
    audioFormat: "mp3",
    audioQuality: 0,
    output: outputTemplate,
    noPlaylist: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    extractorArgs: "youtube:player_client=android",
    addHeader: [
      "referer:youtube.com",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ],
  } as Record<string, unknown>)

  // Find the actual audio file
  let actualPath = expectedPath
  try {
    await fs.access(expectedPath)
  } catch {
    const alternatives = [".m4a", ".webm", ".opus", ".ogg", ".wav"]
    let found = false
    for (const ext of alternatives) {
      const altPath = join(tmpdir(), `${baseName}${ext}`)
      try {
        await fs.access(altPath)
        actualPath = altPath
        found = true
        break
      } catch { continue }
    }
    if (!found) throw new Error("yt-dlp did not produce an output file")
  }

  const stat = await fs.stat(actualPath)
  if (stat.size === 0) throw new Error("Downloaded audio file is empty")

  const r2Url = await uploadFileWithKeyToR2(actualPath, `audios/cover-src-${outputId}.mp3`, "audio/mpeg")
  await fs.unlink(actualPath).catch(() => {})

  console.log(`[worker] Audio downloaded and uploaded to R2: ${r2Url}`)
  return r2Url
}

/**
 * Check if job was cancelled before saving completion result.
 * This prevents race condition where user cancels but job already completed.
 * Returns true if job should proceed with saving, false if cancelled.
 */
export async function shouldSaveJobResult(jobId: string): Promise<boolean> {
  const { data: currentJob } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", jobId)
    .single()

  if (currentJob?.status === "cancelled") {
    console.log(`[worker] Job ${jobId} was cancelled during processing, discarding result`)
    return false
  }
  return true
}

/**
 * Commit credits after successful job completion (cloud edition only).
 * Wrapped in try-catch to avoid failing the job if credit commit fails.
 */
export async function commitJobCredits(usageLogId: string | null | undefined, jobId: string): Promise<void> {
  if (!hasCredits() || !usageLogId) return

  try {
    await CreditsService.commitCredits(usageLogId)
    console.log(`[worker] Credits committed for job ${jobId}`)
  } catch (error) {
    console.error(`[worker] Failed to commit credits for job ${jobId}:`, error)
    // Don't fail the job if credit commit fails
  }
}

/**
 * Refund credits after job failure (cloud edition only).
 * Only refunds for system errors, NOT for provider errors (where we got charged).
 */
export async function refundJobCredits(usageLogId: string | null | undefined, jobId: string, errorMessage: string): Promise<void> {
  if (!hasCredits() || !usageLogId) return

  try {
    // Don't refund if the provider already charged us.
    // Check for known provider error patterns (case-insensitive).
    const lower = errorMessage?.toLowerCase() ?? ""
    const isProviderError =
      lower.includes("provider error") ||
      lower.includes("provider returned") ||
      lower.includes("provider rejected") ||
      lower.includes("api error") ||
      lower.includes("kie.ai") ||
      lower.includes("replicate") ||
      lower.includes("model error") ||
      lower.includes("content moderation") ||
      lower.includes("nsfw")

    if (!isProviderError) {
      await CreditsService.refundCredits(usageLogId)
      console.log(`[worker] Credits refunded for job ${jobId}`)
    } else {
      console.log(`[worker] Provider error - not refunding credits for job ${jobId}: ${errorMessage}`)
    }
  } catch (error) {
    console.error(`[worker] Failed to refund credits for job ${jobId}:`, error)
    // Don't fail the job if credit refund fails
  }
}

/**
 * Upload image to R2, optionally applying a watermark first.
 * When watermark is true, downloads the source image, composites the
 * "Nodaro.ai" text overlay, then uploads the watermarked buffer.
 */
export async function uploadImageMaybeWatermark(
  sourceUrl: string,
  jobId: string,
  jobUserId: string | undefined,
  watermark: boolean,
): Promise<string> {
  if (!watermark) {
    return uploadToR2(sourceUrl, jobId, "image", jobUserId)
  }
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const watermarked = await applyImageWatermark(buffer)
  return uploadBufferToR2(watermarked, `images/${jobId}.png`, "image/png", jobUserId)
}

/**
 * Upload video to R2, optionally applying a watermark first.
 * When watermark is true, downloads to a temp file, runs ffmpeg drawtext,
 * then uploads the watermarked file.
 */
export async function uploadVideoMaybeWatermark(
  sourceUrl: string,
  jobId: string,
  jobUserId: string | undefined,
  watermark: boolean,
): Promise<string> {
  const workDir = await createWorkDir("wm")
  try {
    const inputPath = join(workDir, "input.mp4")
    await downloadFile(sourceUrl, inputPath)

    if (watermark) {
      const outputPath = join(workDir, "output.mp4")
      await applyVideoWatermark(inputPath, outputPath)
      return await uploadFileToR2(outputPath, jobId, "video", jobUserId)
    }

    // Even without watermark, transcode if the codec isn't browser-safe
    const uploadPath = await transcodeToBrowserSafe(inputPath, join(workDir, "output.mp4"))
    return await uploadFileToR2(uploadPath, jobId, "video", jobUserId)
  } finally {
    await cleanupWorkDir(workDir)
  }
}

/**
 * Apply video watermark to a local file on disk, then upload to R2.
 * Used when the file is already local (e.g. after ffmpeg merge).
 */
export async function watermarkLocalVideoAndUpload(
  localPath: string,
  jobId: string,
  jobUserId: string | undefined,
  watermark: boolean,
): Promise<string> {
  if (watermark) {
    const wmPath = `${localPath}-wm.mp4`
    await applyVideoWatermark(localPath, wmPath)
    return uploadFileToR2(wmPath, jobId, "video", jobUserId)
  }

  // Transcode if the codec isn't browser-safe
  const uploadPath = await transcodeToBrowserSafe(localPath, `${localPath}-norm.mp4`)
  return uploadFileToR2(uploadPath, jobId, "video", jobUserId)
}

/**
 * Generate a thumbnail for a video and upload it to R2.
 * Returns the thumbnail URL, or null if generation fails (non-blocking).
 */
export async function generateAndUploadThumbnail(
  videoUrl: string,
  jobId: string,
  jobUserId: string | undefined,
): Promise<string | null> {
  try {
    const thumbBuffer = await generateThumbnailFromUrl(videoUrl)
    return await uploadBufferToR2(thumbBuffer, `thumbnails/${jobId}.png`, "image/png", jobUserId)
  } catch (err) {
    console.error(`[worker] Thumbnail generation failed for job ${jobId}:`, err)
    return null
  }
}

/**
 * Complete an FFmpeg video job: upload output, cleanup work dir, generate
 * thumbnail, save to DB, and commit credits. Covers the common case where
 * the FFmpeg operation produces a single video file on disk.
 */
export async function completeFfmpegVideoJob(
  outputPath: string,
  ctx: JobContext,
): Promise<void> {
  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "video", ctx.jobUserId)
  await cleanupWorkDir(dirname(outputPath))
  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
    completed_at: new Date().toISOString(),
  }).eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

/**
 * Complete an FFmpeg audio job: upload output, cleanup work dir,
 * save to DB, and commit credits.
 */
export async function completeFfmpegAudioJob(
  outputPath: string,
  ctx: JobContext,
): Promise<void> {
  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "audio", ctx.jobUserId)
  await cleanupWorkDir(dirname(outputPath))

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { audioUrl: r2Url },
    completed_at: new Date().toISOString(),
  }).eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

/**
 * Create asset records in the `assets` table for a completed job's media outputs.
 * This makes generated media appear in the /library page.
 * Wrapped in try-catch — never fails the job if asset creation fails.
 */
export async function createAssetFromJob(
  jobId: string,
  userId: string | undefined,
): Promise<void> {
  if (!userId) return

  try {
    const { data: job } = await supabase
      .from("jobs")
      .select("output_data, status")
      .eq("id", jobId)
      .single()

    if (!job || job.status !== "completed") return

    const output = job.output_data as Record<string, unknown> | null
    if (!output) return

    const mediaFields: Array<{ key: string; type: "image" | "video" | "audio"; mime: string }> = [
      { key: "imageUrl", type: "image", mime: "image/png" },
      { key: "videoUrl", type: "video", mime: "video/mp4" },
      { key: "audioUrl", type: "audio", mime: "audio/mpeg" },
    ]

    const thumbnailUrl = (output.thumbnail_url ?? output.thumbnailUrl ?? null) as string | null

    for (const { key, type, mime } of mediaFields) {
      const url = output[key]
      if (typeof url !== "string" || !url) continue

      // Check if an asset already exists for this job + type
      const { data: existing } = await supabase
        .from("assets")
        .select("id")
        .eq("job_id", jobId)
        .eq("type", type)
        .maybeSingle()

      if (existing) continue

      // Derive R2 key from public URL
      const r2Key = config.R2_PUBLIC_URL
        ? url.replace(config.R2_PUBLIC_URL + "/", "")
        : url

      const filename = url.split("/").pop() ?? `${jobId}.${type === "image" ? "png" : type === "video" ? "mp4" : "mp3"}`

      await supabase.from("assets").insert({
        user_id: userId,
        job_id: jobId,
        type,
        r2_key: r2Key,
        r2_url: url,
        filename,
        mime_type: mime,
        size_bytes: 0,
        upload_source: "generated",
        metadata: thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {},
      })
    }
  } catch (err) {
    console.error(`[worker] Failed to create asset records for job ${jobId}:`, err)
  }
}
