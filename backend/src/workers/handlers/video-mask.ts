/**
 * Video Mask + Mask Composite worker handlers.
 *
 * video-mask: SAM 3.1 / SAM 3 (fal) segment the clip from a text prompt; the
 * per-frame RLE they return is drawn locally into a mask video (white = the
 * subject). A clip longer than 1,800 frames is cut into chunks segmented in
 * parallel (at most 3 at once) and joined frame for frame.
 * The fal request is NOT registered with the reconcile cron (see
 * providers/fal/sam3-video.ts): a crash re-runs the job on its BullMQ retry,
 * the pre-task sweep is the backstop. Masks are intermediate artifacts — never
 * watermarked (a watermark would corrupt the mask).
 *
 * mask-composite: local ffmpeg (providers/video/mask-composite.ts), finished
 * through the shared ffmpeg completion like every other processing node.
 */

import { dirname, join } from "node:path"
import { gzipSync, gunzipSync } from "node:zlib"
import { maskCompositeEffectiveAudioSource, maskCompositeUsesForeground, resolveMaskCompositeSettings, resolveVideoMaskProvider, VIDEO_MASK_LIMITS } from "@nodaro/shared/media"
import { listObjectsByPrefixWithMeta, readR2ObjectBuffer, uploadFileToR2 } from "../../lib/storage.js"
import { jobScratchPrefix, uploadJobScratchBuffer, uploadJobScratchFile } from "../../lib/job-scratch.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { runSam3Video } from "../../providers/fal/sam3-video.js"
import { cleanupWorkDir, createWorkDir } from "../../providers/video/ffmpeg-utils.js"
import {
  VIDEO_MASK_CHUNK_FRAMES,
  planMaskChunks,
  prepareVideoMaskSource,
  renderMaskVideo,
  splitMaskSource,
  holdLastMaskFrames,
  dropMaskRegionsBySize,
  type MaskChunk,
  type MaskGeometry,
} from "../../providers/video/video-mask.js"
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
 * The model returns one mask per decoded frame. A count far from the
 * expected one means it decoded something else (another rate, a cut stream),
 * and a mask drawn from it would drift against the footage — refuse it.
 */
export function assertFrameCountMatches(returned: number, expected: number | MaskGeometry | undefined): void {
  const want = typeof expected === "object" ? expectedFrames(expected) : expected
  if (want === undefined) return
  const tolerance = Math.max(3, Math.ceil(want * 0.03))
  if (Math.abs(returned - want) > tolerance) {
    // Deterministic: the model decodes the clip the same way on every retry, and each retry pays again.
    throw new DeterministicJobError(`SAM 3 returned ${returned} frame masks for a clip of about ${want} frames`)
  }
}

/** Scratch file name of one chunk's finished segmentation (`job-scratch-keys.ts` adds a nonce). */
const rleCacheName = (chunk: number) => `sam3-rle-c${chunk}`

/** Model requests in flight at once for one long clip (each ≤ 1,800 frames). */
const CHUNK_CONCURRENCY = 3

interface CachedChunk {
  readonly model: string
  readonly geometry: MaskGeometry
  readonly chunk: MaskChunk
  readonly rle: readonly string[]
  readonly cost: number | null
}

const sameGeometry = (a: MaskGeometry, b: MaskGeometry) =>
  a.width === b.width && a.height === b.height && a.frameRate === b.frameRate

/**
 * The chunks this job already paid for, kept (gzipped) in the job's scratch
 * folder, which the job's end empties. A BullMQ retry after the model
 * answered — a failed chunk, encode or upload, a worker restart — draws those
 * chunks instead of paying for them again. Only for the same model, geometry
 * and chunk plan (the source is prepared again on every attempt). Any read
 * problem counts as no cache.
 */
async function readCachedChunks(jobId: string, model: string, geometry: MaskGeometry, chunks: readonly MaskChunk[]): Promise<Map<number, CachedChunk>> {
  const found = new Map<number, CachedChunk>()
  try {
    const prefix = jobScratchPrefix(jobId)
    const objects = await listObjectsByPrefixWithMeta(prefix)
    for (const chunk of chunks) {
      const hit = objects.find((o) => o.key.slice(prefix.length).startsWith(`${rleCacheName(chunk.index)}-`))
      if (!hit) continue
      const body = await readR2ObjectBuffer(hit.key)
      if (!body) continue
      const cached = JSON.parse(gunzipSync(body).toString("utf8")) as CachedChunk
      const samePlan = cached.chunk?.startFrame === chunk.startFrame && cached.chunk?.frames === chunk.frames
      if (cached.model === model && cached.geometry && sameGeometry(cached.geometry, geometry) && samePlan && Array.isArray(cached.rle)) {
        found.set(chunk.index, cached)
      }
    }
  } catch {
    // A cache that cannot be read is no cache: the chunks are segmented again.
  }
  return found
}

async function cacheChunk(jobId: string, value: CachedChunk): Promise<void> {
  try {
    await uploadJobScratchBuffer(gzipSync(JSON.stringify(value)), rleCacheName(value.chunk.index), "gz", "application/gzip", jobId)
  } catch (err) {
    console.warn(`[worker] video-mask ${jobId}: could not keep chunk ${value.chunk.index} for a retry: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Run `fn` over `items` with at most `limit` in flight; results in input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const handleVideoMask: HandlerFn = async function handleVideoMask(job, ctx) {
  const { videoUrl, prompt, threshold, provider, holdLastMask, minSubjectHeightPct, maxSubjectHeightPct } = job.data as {
    jobId: string
    videoUrl: string
    prompt: string
    threshold?: number
    provider?: string
    holdLastMask?: boolean
    minSubjectHeightPct?: number
    maxSubjectHeightPct?: number
  }
  const model = resolveVideoMaskProvider(provider)
  const detection = threshold ?? VIDEO_MASK_LIMITS.THRESHOLD_DEFAULT
  console.log(`[worker] video-mask ${ctx.jobId}: "${prompt}" (${model}, threshold ${detection})`)

  const workDir = await createWorkDir("video-mask")
  try {
    const prepared = await prepareVideoMaskSource(videoUrl, workDir)
    const totalFrames = prepared.frameCount ?? expectedFrames(prepared.geometry) ?? 1
    const chunks = planMaskChunks(totalFrames, VIDEO_MASK_CHUNK_FRAMES)
    await setJobProgress(job, ctx.jobId, 10)

    const cached = await readCachedChunks(ctx.jobId, model, prepared.geometry, chunks)
    if (cached.size > 0) console.log(`[worker] video-mask ${ctx.jobId}: drawing ${cached.size}/${chunks.length} chunk(s) an earlier attempt paid for`)
    const missing = chunks.filter((c) => !cached.has(c.index))
    // A long clip is cut once, locally; a one-chunk clip goes as it is.
    const chunkPaths = missing.length > 0 && chunks.length > 1
      ? await splitMaskSource(prepared.localPath, workDir, prepared.geometry, chunks)
      : []

    const answers = await withProgressRamp(job, ctx.jobId, { start: 10, cap: 80 }, () =>
      mapLimit(chunks, CHUNK_CONCURRENCY, async (chunk): Promise<{ rle: readonly string[]; cost: number | null }> => {
        const hit = cached.get(chunk.index)
        if (hit) return hit
        // What the model sees goes to the job's scratch folder (no quota,
        // deleted at job end) — except a one-chunk plain clip, sent as it is.
        const modelInputUrl = chunks.length > 1
          ? await uploadJobScratchFile(chunkPaths[chunk.index]!, `mask-src-c${chunk.index}`, "mp4", "video/mp4", ctx.jobId)
          : prepared.normalisedPath
            ? await uploadJobScratchFile(prepared.normalisedPath, "mask-src-c0", "mp4", "video/mp4", ctx.jobId)
            : videoUrl
        const answer = await runSam3Video({ model, videoUrl: modelInputUrl, prompt, threshold: detection, frameCount: chunk.frames })
        assertFrameCountMatches(answer.rle.length, chunk.frames)
        await cacheChunk(ctx.jobId, { model, geometry: prepared.geometry, chunk, rle: answer.rle, cost: answer.cost })
        return { rle: answer.rle, cost: answer.cost }
      }),
    )
    const cost = answers.every((a) => a.cost === null) ? null : answers.reduce((sum, a) => sum + (a.cost ?? 0), 0)
    const modelRle = answers.flatMap((a) => a.rle)
    // The chunks' own arrays are no longer needed: let them go, so a frame the size filter replaces
    // leaves no second copy behind (the retry cache already holds the model's answer).
    answers.length = 0
    cached.clear()
    // The model's frame count is checked first: a wrong count is refused as itself, never as a post-processing error.
    assertFrameCountMatches(modelRle.length, totalFrames)
    // All off by default: the model's mask, frame for frame. The size filter (min ≤ height ≤ max) runs
    // FIRST, so a frame left with nothing in the band counts as empty and is held from the last one.
    const pctOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0)
    const minPct = pctOf(minSubjectHeightPct)
    const maxPct = pctOf(maxSubjectHeightPct)
    // In place, frame by frame, yielding to the event loop (other jobs on this worker keep running).
    const sized = minPct > 0 || maxPct > 0 ? await dropMaskRegionsBySize(modelRle, prepared.geometry, minPct, maxPct) : undefined
    // The model matched something but no region is in the band: the person asked to ignore those
    // subjects, so an all-black mask (coverage 0) is the answer — delivered and charged as usual.
    const allSmall = sized !== undefined && sized.matched && !sized.kept
    if (sized) console.log(`[worker] video-mask ${ctx.jobId}: dropped ${sized.droppedRegions} region(s) outside ${minPct}–${maxPct || 100}% of the frame height${allSmall ? " — none left: an empty mask" : ""}`)
    const afterSize = sized?.rle ?? modelRle
    // In place, yielding to the event loop like the size filter.
    const held = holdLastMask === true ? await holdLastMaskFrames(afterSize, prepared.geometry.width * prepared.geometry.height) : undefined
    const rle = held?.rle ?? afterSize
    if (held) console.log(`[worker] video-mask ${ctx.jobId}: held the last mask over ${held.heldFrames} empty frame(s)`)

    const maskPath = join(workDir, "mask.mp4")
    const { coveredFraction } = allSmall
      ? await renderMaskVideo(rle, prepared.geometry, maskPath, { allowEmpty: true })
      : await renderMaskVideo(rle, prepared.geometry, maskPath)
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
        frames: rle.length,
        chunks: chunks.length,
        coverage: Number(coveredFraction.toFixed(4)),
        ...(held ? { heldFrames: held.heldFrames } : {}),
        ...(sized ? { droppedRegions: sized.droppedRegions } : {}),
      },
      provider: model,
      provider_cost: cost,
    })
    if (!ok) return
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
    console.log(`[worker] Job ${ctx.jobId} completed: mask=${maskUrl} (${chunks.length} chunk(s), ${(coveredFraction * 100).toFixed(1)}% covered)`)
  } finally {
    await cleanupWorkDir(workDir)
  }
}

const handleMaskComposite: HandlerFn = async function handleMaskComposite(job, ctx) {
  const data = job.data as { jobId: string; foregroundUrl?: string; backgroundUrl: string; maskUrl: string } & Record<string, unknown>
  const settings = resolveMaskCompositeSettings(data)
  // Pixelate / blur fill from the background: no foreground is needed (one sent is ignored).
  const usesForeground = maskCompositeUsesForeground(settings.fill)
  if ((usesForeground && !data.foregroundUrl) || !data.backgroundUrl || !data.maskUrl) {
    throw new DeterministicJobError(
      usesForeground
        ? "Mask Composite needs a foreground video, a background video and a mask video."
        : "Mask Composite needs a background video and a mask video.",
    )
  }
  // The audio the render carries (pixelate / blur: always the background's), not the stored choice.
  console.log(`[worker] mask-composite ${ctx.jobId} (fill ${settings.fill}, fit ${settings.backgroundFit}, audio ${maskCompositeEffectiveAudioSource(settings)}${settings.invertMask ? ", inverted" : ""})`)
  const result = await maskComposite({
    ...(usesForeground ? { foregroundUrl: data.foregroundUrl } : {}),
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
