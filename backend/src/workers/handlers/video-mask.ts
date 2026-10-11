/**
 * Video Mask + Mask Composite worker handlers.
 *
 * video-mask: SAM 3 (fal) segments the clip from a text prompt; the per-frame
 * RLE it returns is drawn locally into a mask video (white = the subject).
 * The fal request is NOT registered with the reconcile cron (see
 * providers/fal/sam3-video.ts): a crash re-runs the job on its BullMQ retry,
 * the pre-task sweep is the backstop. Masks are intermediate artifacts — never
 * watermarked (a watermark would corrupt the mask).
 *
 * mask-composite: local ffmpeg (providers/video/mask-composite.ts), finished
 * through the shared ffmpeg completion like every other processing node.
 */

import { dirname, join } from "node:path"
import { resolveMaskCompositeSettings, resolveVideoMaskProvider, VIDEO_MASK_LIMITS } from "@nodaro/shared"
import { listObjectsByPrefixWithMeta, readR2ObjectBuffer, uploadFileToR2 } from "../../lib/storage.js"
import { jobScratchPrefix, uploadJobScratchBuffer, uploadJobScratchFile } from "../../lib/job-scratch.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { runSam3Video } from "../../providers/fal/sam3-video.js"
import { cleanupWorkDir, createWorkDir } from "../../providers/video/ffmpeg-utils.js"
import { prepareVideoMaskSource, renderMaskVideo, type MaskGeometry } from "../../providers/video/video-mask.js"
import { maskComposite } from "../../providers/video/mask-composite.js"
import {
  commitJobCredits,
  completeFfmpegVideoJob,
  generateAndUploadThumbnail,
  markJobCompleted,
  setJobProgress,
  shouldSaveJobResult,
  withProgressRamp,
  type HandlerFn,
} from "../shared.js"

/** Frames the model should return for this geometry. */
function expectedFrames(g: MaskGeometry): number | undefined {
  const [n, d] = g.frameRate.split("/").map(Number)
  const fps = d ? n! / d : n
  return fps && Number.isFinite(fps) && fps > 0 ? Math.round(g.durationSec * fps) : undefined
}

/**
 * The model returns one mask per decoded frame. A count far from the clip's
 * own means it decoded something else (another rate, a cut stream), and a
 * mask drawn from it would drift against the footage — refuse it instead.
 */
export function assertFrameCountMatches(returned: number, geometry: MaskGeometry): void {
  const expected = expectedFrames(geometry)
  if (expected === undefined) return
  const tolerance = Math.max(3, Math.ceil(expected * 0.03))
  if (Math.abs(returned - expected) > tolerance) {
    // Deterministic: the model decodes the clip the same way on every retry, and each retry pays again.
    throw new DeterministicJobError(`SAM 3 returned ${returned} frame masks for a clip of about ${expected} frames`)
  }
}

/** Scratch file name of a finished segmentation (`job-scratch-keys.ts` adds a nonce). */
const RLE_CACHE_NAME = "sam3-rle"

interface CachedSegmentation {
  readonly geometry: MaskGeometry
  readonly rle: readonly string[]
  readonly cost: number | null
}

/**
 * A segmentation this job already paid for, kept in the job's scratch folder
 * (emptied when the job ends). A BullMQ retry after the model answered — a
 * failed encode, upload or a worker restart — draws the mask from it instead
 * of paying the model again. Only for the same geometry (the source is
 * prepared again on every attempt). Any read problem counts as no cache.
 */
async function readCachedSegmentation(jobId: string, geometry: MaskGeometry): Promise<CachedSegmentation | null> {
  try {
    const objects = await listObjectsByPrefixWithMeta(jobScratchPrefix(jobId))
    const hit = objects.find((o) => o.key.slice(jobScratchPrefix(jobId).length).startsWith(`${RLE_CACHE_NAME}-`))
    if (!hit) return null
    const body = await readR2ObjectBuffer(hit.key)
    if (!body) return null
    const cached = JSON.parse(body.toString("utf8")) as CachedSegmentation
    const g = cached.geometry
    const same = g && g.width === geometry.width && g.height === geometry.height && g.frameRate === geometry.frameRate
    return same && Array.isArray(cached.rle) ? cached : null
  } catch {
    return null
  }
}

async function cacheSegmentation(jobId: string, value: CachedSegmentation): Promise<void> {
  try {
    await uploadJobScratchBuffer(Buffer.from(JSON.stringify(value)), RLE_CACHE_NAME, "json", "application/json", jobId)
  } catch (err) {
    console.warn(`[worker] video-mask ${jobId}: could not keep the segmentation for a retry: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const handleVideoMask: HandlerFn = async function handleVideoMask(job, ctx) {
  const { videoUrl, prompt, threshold, provider } = job.data as {
    jobId: string
    videoUrl: string
    prompt: string
    threshold?: number
    provider?: string
  }
  const model = resolveVideoMaskProvider(provider)
  console.log(`[worker] video-mask ${ctx.jobId}: "${prompt}" (${model}, threshold ${threshold ?? VIDEO_MASK_LIMITS.THRESHOLD_DEFAULT})`)

  const workDir = await createWorkDir("video-mask")
  try {
    const prepared = await prepareVideoMaskSource(videoUrl, workDir)
    await setJobProgress(job, ctx.jobId, 10)

    let result: { rle: readonly string[]; cost: number | null } | null = await readCachedSegmentation(ctx.jobId, prepared.geometry)
    if (result) {
      console.log(`[worker] video-mask ${ctx.jobId}: drawing the segmentation an earlier attempt paid for`)
    } else {
      // A re-encoded clip is what the model must see (the mask is drawn on its
      // geometry). It goes to the job's scratch folder: never billed to the
      // user's storage, and deleted when the job ends.
      const modelInputUrl = prepared.normalisedPath
        ? await uploadJobScratchFile(prepared.normalisedPath, "mask-src", "mp4", "video/mp4", ctx.jobId)
        : videoUrl
      const answer = await withProgressRamp(job, ctx.jobId, { start: 10, cap: 80 }, () =>
        runSam3Video({
          videoUrl: modelInputUrl,
          prompt,
          threshold: threshold ?? VIDEO_MASK_LIMITS.THRESHOLD_DEFAULT,
          frameCount: expectedFrames(prepared.geometry),
        }),
      )
      result = { rle: answer.rle, cost: answer.cost }
      await cacheSegmentation(ctx.jobId, { geometry: prepared.geometry, rle: answer.rle, cost: answer.cost })
    }
    assertFrameCountMatches(result.rle.length, prepared.geometry)

    const maskPath = join(workDir, "mask.mp4")
    const { coveredFraction } = await renderMaskVideo(result.rle, prepared.geometry, maskPath)
    await setJobProgress(job, ctx.jobId, 90)

    // POST-PROVIDER: the segmentation is delivered and paid for; an upload
    // failure from here on is post-delivery (no refund).
    const maskUrl = await runPostProcessing(() => uploadFileToR2(maskPath, ctx.jobId, "video", ctx.jobUserId))
    const thumbnailUrl = await generateAndUploadThumbnail(maskUrl, ctx.jobId, ctx.jobUserId)
    if (!await shouldSaveJobResult(ctx.jobId)) return
    const ok = await markJobCompleted(ctx.jobId, {
      output_data: {
        videoUrl: maskUrl,
        thumbnailUrl,
        width: prepared.geometry.width,
        height: prepared.geometry.height,
        frames: result.rle.length,
        coverage: Number(coveredFraction.toFixed(4)),
      },
      provider: model,
      provider_cost: result.cost,
    })
    if (!ok) return
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
    console.log(`[worker] Job ${ctx.jobId} completed: mask=${maskUrl} (${(coveredFraction * 100).toFixed(1)}% covered)`)
  } finally {
    await cleanupWorkDir(workDir)
  }
}

const handleMaskComposite: HandlerFn = async function handleMaskComposite(job, ctx) {
  const data = job.data as { jobId: string; foregroundUrl: string; backgroundUrl: string; maskUrl: string } & Record<string, unknown>
  if (!data.foregroundUrl || !data.backgroundUrl || !data.maskUrl) {
    throw new DeterministicJobError("Mask Composite needs a foreground video, a background video and a mask video.")
  }
  const settings = resolveMaskCompositeSettings(data)
  console.log(`[worker] mask-composite ${ctx.jobId} (fit ${settings.backgroundFit}, audio ${settings.audioSource}${settings.invertMask ? ", inverted" : ""})`)
  const result = await maskComposite({
    foregroundUrl: data.foregroundUrl,
    backgroundUrl: data.backgroundUrl,
    maskUrl: data.maskUrl,
    settings,
  })
  try {
    await setJobProgress(job, ctx.jobId, 80)
    await completeFfmpegVideoJob(result.outputPath, ctx, { width: result.width, height: result.height, durationSec: result.durationSec })
  } finally {
    await cleanupWorkDir(dirname(result.outputPath))
  }
}

export const videoMaskHandlers: Record<string, HandlerFn> = {
  "video-mask": handleVideoMask,
  "mask-composite": handleMaskComposite,
}
