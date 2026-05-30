import type { Job } from "bullmq"
import { promises as fs } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import youtubedl from "youtube-dl-exec"
import { variantJobId } from "@nodaro/shared"
import { config, hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import type { ProviderResult } from "../providers/provider.interface.js"
import { uploadToR2, uploadFileToR2, uploadBufferToR2, uploadFileWithKeyToR2 } from "../lib/storage.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { isAllowedSocialVideoUrl } from "../lib/url-validator.js"
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

/**
 * True when a thrown error is terminal for THIS BullMQ job — i.e. no further
 * automatic retry will run, so the job-failure finalize + credit refund MUST
 * happen on this attempt.
 *
 * Why this matters (credit correctness): refunding on a non-final attempt
 * CAS-flips the reservation reserved→refunded. BullMQ then retries; a
 * successful retry calls commitJobCredits, but commit_credits matches
 * `status='reserved'` and the row is already 'refunded', so the commit
 * silently no-ops — the media is delivered for FREE while we paid the
 * provider. So we must only refund when the job won't be retried.
 *
 * BullMQ v5 semantics (verified against the installed source,
 * classes/job.js `shouldRetryJob`): `attemptsMade` is 0 during the first
 * processing and is incremented only AFTER a failure, and a retry happens iff
 * `attemptsMade + 1 < opts.attempts`. So "final attempt" is the exact inverse:
 * `attemptsMade + 1 >= attempts`. This holds because these queues use a plain
 * exponential backoff (no strategy returning -1) and never throw
 * UnrecoverableError — the only other ways BullMQ would skip a retry early.
 */
export function isFinalJobAttempt(job: Pick<Job, "attemptsMade" | "opts">): boolean {
  const attempts = job.opts?.attempts ?? 1
  return job.attemptsMade + 1 >= attempts
}

export function isSocialUrl(url: string): boolean {
  return isAllowedSocialVideoUrl(url)
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
 * Spread-into-output_data sidecar fields derived from a ProviderResult.
 * Centralises the seed/fallbackUsed/providerMs/kieTaskId capture so every
 * AI handler that lands a ProviderResult persists the same metadata in
 * the same shape.
 *
 * Usage:
 *   output_data: {
 *     videoUrl: r2Url,
 *     thumbnailUrl: thumbUrl,
 *     ...buildProviderMeta(result),
 *   }
 *
 * Each field is omitted when absent, so existing rows stay clean.
 */
export type ProviderMetaSource = Pick<
  ProviderResult,
  "kieTaskId" | "seed" | "fallbackFlag" | "providerMs"
>

export function buildProviderMeta(
  result: ProviderMetaSource | undefined | null,
): Record<string, unknown> {
  if (!result) return {}
  const meta: Record<string, unknown> = {}
  if (result.kieTaskId) meta.kieTaskId = result.kieTaskId
  if (result.seed !== undefined) meta.seed = result.seed
  if (result.fallbackFlag === true) meta.fallbackUsed = true
  if (result.providerMs !== undefined) meta.providerMs = result.providerMs
  return meta
}

/**
 * Build the output_data row for any image-generation/edit/i2i job. Singular
 * `imageUrl` always populated as primary; `imageUrls` only set when the
 * provider returned multiple variants — the frontend uses array-presence to
 * decide whether to fan out into multiple GeneratedResult entries.
 */
export function buildImageOutputData(
  result: ProviderMetaSource,
  r2Urls: readonly string[],
): Record<string, unknown> {
  return {
    imageUrl: r2Urls[0]!,
    ...(r2Urls.length > 1 ? { imageUrls: r2Urls } : {}),
    ...buildProviderMeta(result),
  }
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
  /**
   * Credits for work we performed that is NOT reflected in the provider's USD
   * cost — e.g. the loop-trim (smart-loop-cut) FFmpeg/PSNR add-on. Without
   * this, the provider-cost reconciliation below computes actual ≈ base and
   * commit_credits refunds the difference (the add-on), so the user gets the
   * post-process for free. Added on top of the provider-derived credits.
   */
  extraNonProviderCredits = 0,
  /**
   * Pricing convention (decision A): ONLY genuinely metered providers (Replicate
   * GPU-time: face-swap, legacy lip-sync, whisper transcribe) recompute the
   * charge from `providerCostUsd` and true-up. Every fixed/composite-priced
   * provider commits the RESERVED tier (markup already applied once at reserve
   * over the 0%-base price) — `reserved == committed`, no spurious refund, and
   * no under-charge from a flat/GPU-time `result.cost`. Default false.
   */
  metered = false,
): Promise<void> {
  if (!hasCredits() || !usageLogId) return

  const { CreditsService } = await import("../ee/services/credits.js")
  const { computeActualCredits, checkAndLogAnomaly } = await import("../ee/billing/credit-anomaly.js")

  try {
    if (metered && providerCostUsd && providerCostUsd > 0) {
      const [providerCredits, { data: usageLog }] = await Promise.all([
        computeActualCredits(providerCostUsd),
        supabase
          .from("usage_logs")
          .select("credits_used, user_id, action, provider")
          .eq("id", usageLogId)
          .single(),
      ])
      // Retained non-provider add-ons (e.g. loop-trim) are charged on top of
      // the provider-derived credits. This also makes the anomaly check
      // accurate (reserved included the add-on, so actual should too).
      const actualCredits = providerCredits + Math.max(0, extraNonProviderCredits)

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
      // Fixed/composite provider (or cost-less): commit the RESERVED tier.
      await CreditsService.commitCredits(usageLogId)
      // Mirror the committed (= reserved) amount onto jobs.credits_actual so
      // admin/display stays accurate on this path too (the metered branch above
      // already sets it). The reserved amount already includes any add-on.
      const { data: ul } = await supabase
        .from("usage_logs")
        .select("credits_used")
        .eq("id", usageLogId)
        .single()
      if (typeof ul?.credits_used === "number") {
        await supabase.from("jobs").update({ credits_actual: ul.credits_used }).eq("id", jobId)
      }
      console.log(`[worker] Credits committed (reserved tier) for job ${jobId}`)
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
      const { CreditsService } = await import("../ee/services/credits.js")
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
 * Upload N image variants to R2 in parallel, optionally watermarking each.
 * Returns R2 URLs in the same order as `sourceUrls` — primary first, extras
 * after. Variants are stored under suffixed keys (`${jobId}`, `${jobId}-v1`,
 * `${jobId}-v2`, …) so each variant has its own permanent URL.
 *
 * If `sourceUrls.length === 1` this is equivalent to a single
 * uploadImageMaybeWatermark call.
 */
export async function uploadImageVariantsMaybeWatermark(
  sourceUrls: readonly string[],
  jobId: string,
  jobUserId: string | undefined,
  watermark: boolean,
): Promise<readonly string[]> {
  return Promise.all(
    sourceUrls.map((url, i) =>
      uploadImageMaybeWatermark(url, variantJobId(jobId, i), jobUserId, watermark),
    ),
  )
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
  /** Optional sidecar fields to merge into output_data alongside the
   *  standard videoUrl/thumbnailUrl. Used by handlers that produce
   *  ancillary data (e.g. smart-loop-cut metadata) without rewriting
   *  the upload/cleanup/thumbnail flow. */
  extraOutput?: Record<string, unknown>,
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
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl, ...(extraOutput ?? {}) },
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
// Two design properties that callers rely on:
//
//  1. Monotonic-within-a-job: when the ramp writes 30 and a provider's
//     onProgress callback then reports 10 (KIE sometimes lags or briefly
//     reports stale values), we drop the backwards write so the widget bar
//     never visibly regresses. Implemented via an in-memory map + a
//     time/magnitude window so legitimate retry resets still pass through.
//
//  2. Always-moving ramp: `startProgressRamp` runs in two phases — a fast
//     linear climb to `cap` (preserves the existing tuning), then an
//     asymptotic creep toward `softCeiling` (defaults to ~95). Without the
//     phase-2 creep, providers that don't surface incremental progress
//     (Seedance, Wan-Turbo, some Hailuo variants) freeze the bar at `cap`
//     for the entire generation, then snap to the post-call value — what
//     users see as "stuck at 35%".

interface JobProgressEntry { value: number; ts: number }
const lastProgressByJob = new Map<string, JobProgressEntry>()

// Suppress backwards writes only within this short window. Longer than the
// jitter between a ramp tick and a provider onProgress callback, but well
// below typical retry backoffs — so a legitimate retry that calls
// setJobProgress(..., 5) after a previous run reached 50 still goes through.
const REGRESSION_GUARD_MS = 10_000
// And: backwards writes larger than this are always accepted (likely a
// retry/reset, not provider jitter).
const REGRESSION_GUARD_MAX_DROP = 25

/** Test helper — clears the in-memory monotonic-guard map. */
export function _resetJobProgressMap(): void {
  lastProgressByJob.clear()
}

export async function setJobProgress(
  job: { updateProgress: (p: number) => Promise<void> },
  jobId: string,
  progress: number,
): Promise<void> {
  const last = lastProgressByJob.get(jobId)
  const now = Date.now()
  if (last !== undefined && progress < last.value) {
    const drop = last.value - progress
    const elapsed = now - last.ts
    if (drop < REGRESSION_GUARD_MAX_DROP && elapsed < REGRESSION_GUARD_MS) {
      // Tiny, recent backwards write — drop to keep the widget bar smooth.
      return
    }
  }
  // Coalesce repeated identical writes too (cheap and avoids DB churn).
  if (last !== undefined && last.value === progress) return

  lastProgressByJob.set(jobId, { value: progress, ts: now })

  await job.updateProgress(progress)
  // Best-effort DB write — failures shouldn't fail the generation.
  try {
    await supabase.from("jobs").update({ progress }).eq("id", jobId)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[worker] progress DB update failed for ${jobId}:`, err)
  }

  // Free the map once the job has reported terminal progress.
  if (progress >= 100) lastProgressByJob.delete(jobId)
}

export function startProgressRamp(
  job: { updateProgress: (p: number) => Promise<void> },
  jobId: string,
  opts: {
    start: number
    cap: number
    tickMs?: number
    tickStep?: number
    /** Soft ceiling the asymptotic phase 2 approaches. Defaults to a value
     *  slightly above `cap` so the bar keeps creeping forward during long
     *  provider calls instead of pinning at `cap`. */
    softCeiling?: number
    /** Per-tick approach factor for phase 2. 0.04 ≈ ~3pt/min near `cap=35`
     *  with `tickMs=1500`. */
    asymptoteFactor?: number
  },
): { stop: () => void } {
  const tickMs = opts.tickMs ?? 1500
  const tickStep = opts.tickStep ?? 4
  const softCeiling = Math.min(95, Math.max(opts.cap + 5, opts.softCeiling ?? 95))
  const factor = opts.asymptoteFactor ?? 0.04

  let current = opts.start
  let stopped = false
  const handle = setInterval(() => {
    if (stopped) return
    let next = current
    if (current < opts.cap) {
      // Phase 1 — fast linear climb to `cap` (preserves prior tuning).
      next = Math.min(current + tickStep, opts.cap)
    } else if (current < softCeiling - 0.5) {
      // Phase 2 — asymptotic creep toward `softCeiling`. Each tick adds
      // `(softCeiling - current) * factor`, so the bar always moves but
      // visibly slows, never freezing.
      next = Math.min(current + (softCeiling - current) * factor, softCeiling - 0.5)
    } else {
      // Reached the soft ceiling; nothing more to do until the call
      // returns and the handler bumps progress past the ceiling.
      return
    }
    if (next === current) return
    current = next
    void setJobProgress(job, jobId, Math.floor(current))
  }, tickMs)
  return {
    stop() {
      stopped = true
      clearInterval(handle)
    },
  }
}

/**
 * Wrap a long-running provider call so the widget bar moves while the
 * call is in flight. Sets `start` immediately, ramps toward `cap` while
 * `fn` runs (then asymptotically toward `softCeiling`), stops on resolve
 * or throw. Use this for every provider call the widget polls (KIE,
 * Replicate, ElevenLabs) — without it the bar pins at 0% (or whatever
 * was set at credit reservation) for the entire 30s–2min generation,
 * then jumps to the post-call value.
 *
 * Provider-side onProgress callbacks (where supported) still write live
 * values to the same DB column; the monotonic guard in `setJobProgress`
 * keeps the bar from regressing when they race the ramp.
 */
export async function withProgressRamp<T>(
  job: { updateProgress: (p: number) => Promise<void> },
  jobId: string,
  opts: {
    start: number
    cap: number
    tickMs?: number
    tickStep?: number
    softCeiling?: number
    asymptoteFactor?: number
  },
  fn: () => Promise<T>,
): Promise<T> {
  await setJobProgress(job, jobId, opts.start)
  const ramp = startProgressRamp(job, jobId, opts)
  try {
    return await fn()
  } finally {
    ramp.stop()
  }
}

/**
 * Partial-success refund: the i2v generation succeeded but the smart-loop-cut
 * post-process failed. Keep the un-trimmed clip as the result, refund only
 * the loop-trim addon credits (commit actual = reserved - addon).
 *
 * Wraps CreditsService.commitCredits with the partial actual amount and
 * stamps usage_logs.metadata.loop_trim_refunded for traceability.
 */
export async function refundLoopTrimAddon(
  jobId: string,
  usageLogId: string | null | undefined,
  addonCredits: number,
): Promise<void> {
  if (!hasCredits() || !usageLogId || addonCredits <= 0) return

  try {
    const { data: usageLog, error } = await supabase
      .from("usage_logs")
      .select("credits_used, metadata")
      .eq("id", usageLogId)
      .single()

    if (error || !usageLog) {
      console.error(`[worker] refundLoopTrimAddon: usage_log not found for ${usageLogId}`)
      return
    }

    const reserved = (usageLog.credits_used as number | null) ?? 0
    const actual = Math.max(0, reserved - addonCredits)

    const { CreditsService } = await import("../ee/services/credits.js")
    await CreditsService.commitCredits(usageLogId, actual)

    const existingMeta = (usageLog.metadata as Record<string, unknown> | null) ?? {}
    await supabase
      .from("usage_logs")
      .update({ metadata: { ...existingMeta, loop_trim_refunded: true } })
      .eq("id", usageLogId)

    await supabase.from("jobs").update({ credits_actual: actual }).eq("id", jobId)

    console.log(`[worker] loop-trim addon refunded for job ${jobId} (reserved=${reserved}, actual=${actual})`)
  } catch (err) {
    console.error(`[worker] refundLoopTrimAddon failed for job ${jobId}:`, err)
    // Non-fatal: prefer NOT failing the whole job over a refund hiccup.
  }
}
