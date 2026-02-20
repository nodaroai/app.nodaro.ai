import type { Job } from "bullmq"
import { promises as fs } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import youtubedl from "youtube-dl-exec"
import { hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { CreditsService } from "../services/credits.js"
import { uploadToR2, uploadFileToR2, uploadBufferToR2, uploadFileWithKeyToR2 } from "../lib/storage.js"
import { applyImageWatermark, applyVideoWatermark } from "../utils/watermark.js"
import { generateThumbnailFromUrl } from "../utils/thumbnail.js"
import { createWorkDir, cleanupWorkDir, downloadFile, runFfmpeg, needsTranscode, BROWSER_SAFE_VIDEO_ARGS } from "../providers/video/ffmpeg-utils.js"

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
    // Don't refund if provider charged us (provider errors)
    const isProviderError = errorMessage?.toLowerCase().includes("provider") ||
                           errorMessage?.toLowerCase().includes("api error") ||
                           errorMessage?.toLowerCase().includes("kie.ai")

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
 * "SceneNode.ai" text overlay, then uploads the watermarked buffer.
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
    if (await needsTranscode(inputPath)) {
      const outputPath = join(workDir, "output.mp4")
      await runFfmpeg([
        "-y", "-i", inputPath,
        ...BROWSER_SAFE_VIDEO_ARGS,
        "-c:a", "aac", "-b:a", "128k",
        outputPath,
      ])
      return await uploadFileToR2(outputPath, jobId, "video", jobUserId)
    }

    return await uploadFileToR2(inputPath, jobId, "video", jobUserId)
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
    const wmPath = localPath.replace(/\.mp4$/, "-wm.mp4")
    await applyVideoWatermark(localPath, wmPath)
    return uploadFileToR2(wmPath, jobId, "video", jobUserId)
  }

  // Transcode if the codec isn't browser-safe
  if (await needsTranscode(localPath)) {
    const outPath = localPath.replace(/\.mp4$/, "-norm.mp4")
    await runFfmpeg([
      "-y", "-i", localPath,
      ...BROWSER_SAFE_VIDEO_ARGS,
      "-c:a", "aac", "-b:a", "128k",
      outPath,
    ])
    return uploadFileToR2(outPath, jobId, "video", jobUserId)
  }

  return uploadFileToR2(localPath, jobId, "video", jobUserId)
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
