import type { Job } from "bullmq"
import { promises as fs } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import youtubedl from "youtube-dl-exec"
import { config, hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { CreditsService } from "../services/credits.js"
import { computeActualCredits, checkAndLogAnomaly } from "../billing/credit-anomaly.js"
import { uploadToR2, uploadFileToR2, uploadBufferToR2, uploadFileWithKeyToR2 } from "../lib/storage.js"
import { safeFetch } from "../lib/safe-fetch.js"
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
 *
 * Useful as a CHEAP PRE-CHECK to avoid expensive post-processing (thumbnail
 * generation, R2 cleanup) when the job is already cancelled. But it does NOT
 * prevent the cancel-during-update race — between this SELECT and the
 * subsequent UPDATE the user can cancel, and an unconditional UPDATE will
 * overwrite their cancellation. Use markJobCompleted() for the actual
 * status flip — it does the SELECT and UPDATE atomically via a conditional
 * WHERE clause.
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
 * Atomically flip a job to completed, but only if it hasn't been cancelled.
 * Returns true if the row was updated, false if the user cancelled mid-flight.
 *
 * Use this instead of `supabase.from("jobs").update({status:"completed",...}).eq("id", jobId)`
 * to close the cancel-during-update race. Otherwise:
 *   - Worker reads status="processing" (shouldSaveJobResult passes)
 *   - User cancels via /v1/jobs/:id/cancel — status flipped to "cancelled",
 *     usage_log refunded (per PR #1508)
 *   - Worker UPDATEs unconditionally → overwrites cancellation to "completed"
 *   - Net: jobs.status="completed" but usage_log.status="refunded" — user
 *     got the output AND a credit refund (free generation).
 *
 * The conditional UPDATE matches zero rows when the row was cancelled, and
 * the caller can skip commitJobCredits.
 */
export async function markJobCompleted(
  jobId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const completion = {
    status: "completed",
    progress: 100,
    completed_at: new Date().toISOString(),
    ...fields,
  }
  const { data, error } = await supabase
    .from("jobs")
    .update(completion)
    .eq("id", jobId)
    .neq("status", "cancelled")
    .select("id")

  if (error) {
    console.error(`[worker] Failed to mark job ${jobId} completed:`, error.message)
    return false
  }
  if (!data || data.length === 0) {
    console.log(`[worker] Job ${jobId} cancelled mid-update — not flipping to completed`)
    return false
  }
  return true
}

/**
 * Commit credits after successful job completion (cloud edition only).
 * When providerCostUsd is provided, computes actual credits from provider cost,
 * logs any anomaly, and passes actual credits to the RPC (which refunds surplus).
 * Wrapped in try-catch to avoid failing the job if credit commit fails.
 */
export async function commitJobCredits(
  usageLogId: string | null | undefined,
  jobId: string,
  providerCostUsd?: number | null,
): Promise<void> {
  if (!hasCredits() || !usageLogId) return

  try {
    if (providerCostUsd && providerCostUsd > 0) {
      // Compute actual credits and fetch reserved amount in parallel
      const [actualCredits, { data: usageLog }] = await Promise.all([
        computeActualCredits(providerCostUsd),
        supabase
          .from("usage_logs")
          .select("credits_used, user_id, action, provider")
          .eq("id", usageLogId)
          .single(),
      ])

      // Commit, update job, and log anomaly (if any) are independent — run in parallel
      // checkAndLogAnomaly has internal try/catch so it never rejects
      const tasks: PromiseLike<unknown>[] = [
        CreditsService.commitCredits(usageLogId, actualCredits),
        supabase.from("jobs").update({ credits_actual: actualCredits }).eq("id", jobId),
      ]
      if (usageLog) {
        tasks.push(checkAndLogAnomaly({
          jobId,
          userId: usageLog.user_id,
          usageLogId,
          modelIdentifier: usageLog.action ?? "unknown",
          provider: usageLog.provider ?? null,
          reservedCredits: usageLog.credits_used,
          actualCredits,
          providerCostUsd,
        }))
      }
      await Promise.all(tasks)

      console.log(`[worker] Credits committed for job ${jobId} (actual: ${actualCredits}, reserved: ${usageLog?.credits_used ?? "??"})`)
    } else {
      await CreditsService.commitCredits(usageLogId)
      console.log(`[worker] Credits committed for job ${jobId}`)
    }
  } catch (error) {
    console.error(`[worker] Failed to commit credits for job ${jobId}:`, error)
    // Don't fail the job if credit commit fails
  }
}

/**
 * Refund credits after job failure (cloud edition only).
 * Defaults to refunding (safe for the user). Only skips refund when there
 * is evidence the provider actually completed processing and charged us
 * (e.g., we received the result but failed during post-processing like
 * R2 upload, watermark, or transcode).
 *
 * Pre-processing failures (createTask errors, content moderation, NSFW
 * rejections, validation errors, timeouts) are always refunded because
 * the provider never processed the job.
 */
export async function refundJobCredits(usageLogId: string | null | undefined, jobId: string, errorMessage: string): Promise<void> {
  if (!hasCredits() || !usageLogId) return

  try {
    // Only skip refund when post-processing failed AFTER the provider
    // successfully completed its work (meaning we were charged by the provider).
    // These patterns indicate we received a result but failed on our side.
    const lower = errorMessage?.toLowerCase() ?? ""
    const isPostProcessingFailure =
      lower.includes("failed to upload") ||
      lower.includes("upload to r2") ||
      lower.includes("r2 upload") ||
      lower.includes("failed to download image") ||
      lower.includes("failed to download video") ||
      lower.includes("watermark failed") ||
      lower.includes("transcode failed") ||
      lower.includes("ffmpeg failed after")

    if (isPostProcessingFailure) {
      console.log(`[worker] Post-processing failure after provider completed - not refunding credits for job ${jobId}: ${errorMessage}`)
    } else {
      await CreditsService.refundCredits(usageLogId)
      console.log(`[worker] Credits refunded for job ${jobId}`)
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
  // safeFetch: watermarking path fetches sourceUrl and re-uploads the body
  // (with watermark overlay) to R2. An unvalidated fetch here would be an
  // SSRF read-oracle identical to uploadToR2's raw fetch path.
  const response = await safeFetch(sourceUrl, { timeoutMs: 60_000 })
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

  // Cheap pre-check to skip the conditional update when we already know the
  // job was cancelled before post-processing. The atomic guard below handles
  // the actual race during the update.
  if (!await shouldSaveJobResult(ctx.jobId)) return

  // Atomic conditional update — skips commit if user cancelled mid-flight.
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
  })
  if (!ok) return

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

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url },
  })
  if (!ok) return

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

// ============================================================================
// Progress reporting
// ============================================================================
//
// Workers must call `setJobProgress(job, jobId, n)` instead of just
// `job.updateProgress(n)` because the MCP widget polls the `jobs.progress`
// (Postgres) column for its bar — not BullMQ / Redis state. Calling only
// `job.updateProgress(...)` updates Redis, which the widget can't see, so
// the bar appears stuck at 0% (or whatever the last DB write was) for the
// entire run.
//
// `startProgressRamp` complements the manual writes for long-running
// provider calls that don't expose an `onProgress` callback (image / Suno
// / TTS APIs that return a result directly). It ramps progress every
// `tickMs` by `tickStep`, capped at `cap`, while the call is in flight.

export async function setJobProgress(
  job: { updateProgress: (p: number) => Promise<void> },
  jobId: string,
  progress: number,
): Promise<void> {
  await job.updateProgress(progress)
  // Best-effort DB write — failures shouldn't fail the generation.
  await supabase
    .from("jobs")
    .update({ progress })
    .eq("id", jobId)
    .then(() => undefined, (err) => {
      // eslint-disable-next-line no-console
      console.warn(`[worker] progress DB update failed for ${jobId}:`, err)
    })
}

export function startProgressRamp(
  job: { updateProgress: (p: number) => Promise<void> },
  jobId: string,
  opts: { start: number; cap: number; tickMs?: number; tickStep?: number },
): { stop: () => void } {
  const tickMs = opts.tickMs ?? 1500
  const tickStep = opts.tickStep ?? 4
  let current = opts.start
  let stopped = false
  const handle = setInterval(() => {
    if (stopped || current >= opts.cap) return
    current = Math.min(current + tickStep, opts.cap)
    void setJobProgress(job, jobId, current)
  }, tickMs)
  return {
    stop() {
      stopped = true
      clearInterval(handle)
    },
  }
}
