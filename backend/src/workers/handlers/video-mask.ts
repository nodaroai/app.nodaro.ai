/**
 * Video Mask + Mask Composite worker handlers.
 *
 * video-mask: SAM 3.1 / SAM 3 (fal) segment the clip from a text prompt; the
 * per-frame RLE they return is drawn locally into a mask video (white = the
 * subject). A clip longer than 1,800 frames is cut into chunks segmented in
 * parallel (at most 3 at once) and joined frame for frame. With `perShot`,
 * the clip's scene cuts are found first (services/scene-cut-frames.ts) and
 * every cut starts a chunk too: the model starts afresh on each shot (a
 * tracker started on the first shot finds no new subject after a hard cut),
 * and `holdLastMask` never carries a mask across a cut. With
 * `redetectEverySec`, each shot (the whole clip without `perShot`) is also
 * cut into requests of at most that many seconds, so the model detects its
 * subjects again at each — a face that turns to the camera mid-shot is found
 * there. Those boundaries are not cuts: `holdLastMask` holds across them.
 * With `steadyRegions`, a pass that follows the mask's regions across frames
 * (providers/video/video-mask-steady.ts) replaces `holdLastMask`: it fills short
 * gaps (up to HOLD_MAX_SEC when the mask holds nothing at all and a subject seen
 * for long enough returns), removes pops, and sends the largest subjects lost for longer to the
 * model once more (at most 3 requests, each kept for a retry like a chunk). An
 * extra request that fails only leaves that subject lost; it never fails the job.
 * The fal request is NOT registered with the reconcile cron (see
 * providers/fal/sam3-video.ts): a crash re-runs the job on its BullMQ retry,
 * the pre-task sweep is the backstop. Masks are intermediate artifacts — never
 * watermarked (a watermark would corrupt the mask).
 *
 * mask-composite: local ffmpeg (providers/video/mask-composite.ts), finished
 * through the shared ffmpeg completion like every other processing node.
 *
 * mask-erase: local ffmpeg (providers/video/mask-erase.ts) — an internal
 * child step (routes/mask-erase.ts): a mask with the regions centred in its
 * boxes dropped, same frames, never watermarked.
 */

import { dirname, join } from "node:path"
import { gzipSync, gunzipSync } from "node:zlib"
import { maskCompositeEffectiveAudioSource, maskCompositeUsesForeground, resolveMaskCompositeSettings, resolveVideoMaskProvider, resolveVideoMaskRedetectSec, VIDEO_MASK_LIMITS, VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { listObjectsByPrefixWithMeta, readR2ObjectBuffer, uploadFileToR2 } from "../../lib/storage.js"
import { jobScratchPrefix, uploadJobScratchBuffer, uploadJobScratchFile } from "../../lib/job-scratch.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { withinTimeout } from "../../lib/concurrency-lanes/within-timeout.js"
import { runSam3Video } from "../../providers/fal/sam3-video.js"
import { detectCutFrames } from "../../services/scene-cut-frames.js"
import { cleanupWorkDir, createWorkDir, runFfmpeg } from "../../providers/video/ffmpeg-utils.js"
import {
  VIDEO_MASK_CHUNK_FRAMES,
  VIDEO_MASK_MIN_SHOT_FRAMES,
  buildFrameRangeArgs,
  maskRleCoveredPixels,
  planMaskChunks,
  redetectChunkFrames,
  prepareVideoMaskSource,
  renderMaskVideo,
  splitMaskSource,
  holdLastMaskFrames,
  holdMaxFrames,
  dropMaskRegions,
  normaliseMaskZone,
  shotCutFrames,
  fitMaskFrames,
  maskGeometryPeakMemoryMiB,
  videoMaskFfmpegTimeoutMs,
  type MaskChunk,
  type MaskGeometry,
  type MaskZone,
} from "../../providers/video/video-mask.js"
import { mergeRecoveredFace, pickLostFaces, steadyGapLimitFrames, steadyMaskPass, type SteadyPlan } from "../../providers/video/video-mask-steady.js"
import { maskComposite } from "../../providers/video/mask-composite.js"
import { eraseMaskVideo, type MaskEraseBoxInput } from "../../providers/video/mask-erase.js"
import { maskOutlineHandlers } from "./mask-outline.js"
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

/** How long one extra request of a steady pass may take, from asking for an ffmpeg slot to the model's answer; past that its subject stays lost. */
const STEADY_EXTRA_REQUEST_TIMEOUT_MS = 120_000

/** The kill budget of an extra request's cut. Its deadline can only stop the wait for a slot, never a launch already admitted. */
const STEADY_EXTRA_CUT_TIMEOUT_MS = 60_000

interface CachedChunk {
  readonly model: string
  readonly geometry: MaskGeometry
  readonly chunk: MaskChunk
  /** Kept by a `perShot` run (absent on chunks kept before perShot existed = false). */
  readonly perShot?: boolean
  /** Kept by a `redetectEverySec` run (absent on chunks kept before it existed, or with it off = 0). */
  readonly redetectEverySec?: number
  readonly rle: readonly string[]
  readonly cost: number | null
}

const sameGeometry = (a: MaskGeometry, b: MaskGeometry) =>
  a.width === b.width && a.height === b.height && a.frameRate === b.frameRate

/**
 * The chunks this job already paid for, kept (gzipped) in the job's scratch
 * folder, which the job's end empties. A BullMQ retry after the model
 * answered — a failed chunk, encode or upload, a worker restart — draws those
 * chunks instead of paying for them again. Only for the same model, geometry,
 * chunk plan, `perShot` and `redetectEverySec` (the source is prepared again on every attempt,
 * and so are its cuts — an attempt can plan other chunks than the last one,
 * so every kept answer for a chunk is looked at, not only the first). Any
 * read problem counts as no cache.
 */
async function readCachedChunks(
  jobId: string,
  model: string,
  geometry: MaskGeometry,
  chunks: readonly MaskChunk[],
  perShot: boolean,
  redetectEverySec: number,
): Promise<Map<number, CachedChunk>> {
  const found = new Map<number, CachedChunk>()
  try {
    const prefix = jobScratchPrefix(jobId)
    const objects = await listObjectsByPrefixWithMeta(prefix)
    for (const chunk of chunks) {
      const hits = objects.filter((o) => o.key.slice(prefix.length).startsWith(`${rleCacheName(chunk.index)}-`))
      for (const hit of hits) {
        const body = await readR2ObjectBuffer(hit.key)
        if (!body) continue
        const cached = JSON.parse(gunzipSync(body).toString("utf8")) as CachedChunk
        const samePlan = cached.chunk?.startFrame === chunk.startFrame && cached.chunk?.frames === chunk.frames && (cached.perShot ?? false) === perShot
          && (cached.redetectEverySec ?? 0) === redetectEverySec
        if (cached.model === model && cached.geometry && sameGeometry(cached.geometry, geometry) && samePlan && Array.isArray(cached.rle)) {
          found.set(chunk.index, cached)
          break
        }
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

/** What the mask job has at hand for a steady pass's extra requests. */
interface SteadyPassJob {
  readonly job: Parameters<HandlerFn>[0]
  readonly jobId: string
  readonly model: ReturnType<typeof resolveVideoMaskProvider>
  readonly prompt: string
  readonly threshold: number
  readonly localPath: string
  readonly workDir: string
  readonly geometry: MaskGeometry
  readonly chunks: readonly MaskChunk[]
  readonly cutFrames: readonly number[]
  readonly perShot: boolean
  readonly redetectEverySec: number
  /** The job's region filters, each 0 / null = off. */
  readonly minPct: number
  readonly maxPct: number
  readonly zone: MaskZone | null
}

/**
 * Ask the model about one window of the clip again: cut it, upload it, send it.
 * An optional step must not stall a job whose main answers are paid for, so one
 * deadline covers all of it, and rejects when it passes. The cut already running
 * by then has its own short kill budget and is not raced: left running, it would
 * still be writing into a work dir the job's end empties. No request is sent
 * once the deadline has passed.
 */
async function requestExtraAnswer(chunk: MaskChunk, s: SteadyPassJob) {
  const { jobId, geometry } = s
  const passed = () => new Error(`past its ${STEADY_EXTRA_REQUEST_TIMEOUT_MS / 1000} s deadline`)
  const deadline = Date.now() + STEADY_EXTRA_REQUEST_TIMEOUT_MS
  const timeLeft = () => deadline - Date.now()
  const controller = new AbortController()
  const { signal } = controller
  const timer = setTimeout(() => controller.abort(passed()), STEADY_EXTRA_REQUEST_TIMEOUT_MS)
  try {
    const clipPath = join(s.workDir, `steady-${chunk.startFrame}.mp4`)
    await runFfmpeg(buildFrameRangeArgs(s.localPath, clipPath, chunk.startFrame, chunk.frames), STEADY_EXTRA_CUT_TIMEOUT_MS, {
      peakMemoryMiB: maskGeometryPeakMemoryMiB(geometry),
      signal,
    })
    signal.throwIfAborted()
    const videoUrl = await withinTimeout(uploadJobScratchFile(clipPath, `mask-src-c${chunk.index}`, "mp4", "video/mp4", jobId), timeLeft(), passed)
    signal.throwIfAborted()
    return await withinTimeout(
      runSam3Video({ model: s.model, videoUrl, prompt: s.prompt, threshold: s.threshold, frameCount: chunk.frames }),
      timeLeft(),
      passed,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The steady pass over a whole clip, with its second look at the subjects it
 * lost. Each look is cut, sent and kept like a chunk; everything that can go
 * wrong with one (the cut, the upload, the model, a timeout, an answer of the
 * wrong length or a malformed one) is logged and leaves that subject lost. An
 * answer is kept before it is judged, so a retry reads the same verdict without
 * paying again; `cost` holds every answer the model gave, used or not. An answer
 * goes through the job's region filters like the clip's own frames, so a subject
 * the filters dropped is not painted back.
 */
async function runSteadyPass(rle: readonly string[], s: SteadyPassJob) {
  const { jobId, model, geometry, chunks, perShot, redetectEverySec, minPct, maxPct, zone } = s
  const { width, height } = geometry
  const plan: SteadyPlan = {
    width,
    height,
    cutFrames: s.cutFrames,
    detectionFrames: chunks.map((c) => c.startFrame),
    gapLimit: steadyGapLimitFrames(geometry.frameRate),
    emptyGapLimit: holdMaxFrames(geometry.frameRate),
  }
  const first = await steadyMaskPass(rle, plan)
  const faces = pickLostFaces(first.lost)
  const counts = { filledFrames: first.filledFrames, removedRegions: first.removedRegions }
  if (faces.length === 0) return { rle: first.rle, counts: { ...counts, extraRequests: 0, extraFound: 0 }, cost: null }

  // A window is decided by the frame it opens on, so faces lost on one frame share one look (and one answer).
  const looks = [...new Map(faces.map((f): [number, MaskChunk] => [
    f.startFrame,
    { index: 10_000 + f.startFrame, startFrame: f.startFrame, frames: f.endFrame - f.startFrame },
  ])).values()]
  const kept = await readCachedChunks(jobId, model, geometry, looks, perShot, redetectEverySec)
  if (kept.size > 0) console.log(`[worker] video-mask ${jobId}: drawing ${kept.size}/${looks.length} extra request(s) an earlier attempt paid for`)
  const answers = await withProgressRamp(s.job, jobId, { start: 80, cap: 88 }, () =>
    mapLimit(looks, CHUNK_CONCURRENCY, async (chunk): Promise<{ readonly startFrame: number; readonly rle?: readonly string[]; readonly cost: number | null }> => {
      let cost: number | null = null
      try {
        let answer: { readonly rle: readonly string[]; readonly cost: number | null } | undefined = kept.get(chunk.index)
        if (!answer) {
          answer = await requestExtraAnswer(chunk, s)
          await cacheChunk(jobId, { model, geometry, chunk, ...(perShot ? { perShot } : {}), ...(redetectEverySec > 0 ? { redetectEverySec } : {}), rle: answer.rle, cost: answer.cost })
        }
        cost = answer.cost
        assertFrameCountMatches(answer.rle.length, chunk.frames)
        const fitted = fitMaskFrames(answer.rle, chunk.frames)
        // On a copy: the filter replaces frames in place, and the fit can hand back the answer's own array.
        const rle = minPct > 0 || maxPct > 0 || zone
          ? (await dropMaskRegions([...fitted], geometry, { minSubjectHeightPct: minPct, maxSubjectHeightPct: maxPct, zone })).rle
          : fitted
        return { startFrame: chunk.startFrame, rle, cost }
      } catch (err) {
        console.warn(`[worker] video-mask ${jobId}: skipped the extra request at frame ${chunk.startFrame}: ${err instanceof Error ? err.message : String(err)}`)
        return { startFrame: chunk.startFrame, cost }
      }
    }),
  )
  const paid = answers.filter((a) => a.cost !== null)
  const cost = paid.length > 0 ? paid.reduce((sum, a) => sum + a.cost!, 0) : null

  let merged: readonly string[] = first.rle
  let extraFound = 0
  for (const face of faces) {
    const answer = answers.find((a) => a.startFrame === face.startFrame)?.rle
    if (!answer) continue
    try {
      const result = await mergeRecoveredFace(merged, face, answer, { width, height }, plan.gapLimit)
      merged = result.rle
      if (result.found) extraFound++
    } catch (err) {
      console.warn(`[worker] video-mask ${jobId}: skipped the extra answer at frame ${face.startFrame}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const extras = { extraRequests: looks.length, extraFound }
  if (extraFound === 0) return { rle: first.rle, counts: { ...counts, ...extras }, cost }

  // A recovered face can come back with a short gap to fill, or as a pop. Each pass counts only what it changed itself.
  const second = await steadyMaskPass(merged, plan)
  return {
    rle: second.rle,
    counts: { filledFrames: counts.filledFrames + second.filledFrames, removedRegions: counts.removedRegions + second.removedRegions, ...extras },
    cost,
  }
}

const handleVideoMask: HandlerFn = async function handleVideoMask(job, ctx) {
  const { videoUrl, prompt, threshold, provider, holdLastMask, minSubjectHeightPct, maxSubjectHeightPct, zone: rawZone, perShot: rawPerShot, redetectEverySec: rawRedetect, steadyRegions } = job.data as {
    jobId: string
    videoUrl: string
    prompt: string
    threshold?: number
    provider?: string
    holdLastMask?: boolean
    minSubjectHeightPct?: number
    maxSubjectHeightPct?: number
    zone?: unknown
    perShot?: boolean
    redetectEverySec?: number
    steadyRegions?: boolean
  }
  // Absent (a job queued before perShot existed) = one pass over the whole clip.
  const perShot = rawPerShot === true
  // Absent / 0 (a job queued before re-detection existed too) = off: requests start only at the clip's
  // start, every 1,800 frames and (perShot) every cut.
  const redetectEverySec = resolveVideoMaskRedetectSec(rawRedetect)
  const model = resolveVideoMaskProvider(provider)
  const detection = threshold ?? VIDEO_MASK_LIMITS.THRESHOLD_DEFAULT
  console.log(`[worker] video-mask ${ctx.jobId}: "${prompt}" (${model}, threshold ${detection})`)

  const workDir = await createWorkDir("video-mask")
  try {
    const prepared = await prepareVideoMaskSource(videoUrl, workDir)
    const totalFrames = prepared.frameCount ?? expectedFrames(prepared.geometry) ?? 1
    // perShot: the frames where a new shot starts, each one a chunk boundary (none = one shot, today's plan);
    // no shot shorter than VIDEO_MASK_MIN_SHOT_FRAMES (a shorter piece joins its neighbour).
    const cutFrames = perShot
      ? shotCutFrames(totalFrames, await detectCutFrames(prepared.localPath, prepared.geometry.frameRate, {
        timeoutMs: videoMaskFfmpegTimeoutMs(prepared.geometry.durationSec),
        peakMemoryMiB: maskGeometryPeakMemoryMiB(prepared.geometry),
      }))
      : []
    const shots = cutFrames.length + 1
    // redetectEverySec: each shot cut every that-many seconds of frames from its start (a last piece under
    // VIDEO_MASK_MIN_SHOT_FRAMES joins the one before); off = the 1,800-frame grid, planned exactly as before.
    const redetect = redetectEverySec > 0
    const chunks = redetect
      ? planMaskChunks(totalFrames, redetectChunkFrames(prepared.geometry.frameRate, redetectEverySec), cutFrames, VIDEO_MASK_MIN_SHOT_FRAMES)
      : planMaskChunks(totalFrames, VIDEO_MASK_CHUNK_FRAMES, cutFrames)
    if (perShot || redetect) {
      console.log(`[worker] video-mask ${ctx.jobId}: ${shots} shot(s)${cutFrames.length > 0 ? ` (cuts at frames ${cutFrames.join(", ")})` : ""}, ${chunks.length} chunk(s)${redetect ? ` (re-detect every ${redetectEverySec} s)` : ""}`)
    }
    await setJobProgress(job, ctx.jobId, 10)

    const cached = await readCachedChunks(ctx.jobId, model, prepared.geometry, chunks, perShot, redetectEverySec)
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
        await cacheChunk(ctx.jobId, { model, geometry: prepared.geometry, chunk, ...(perShot ? { perShot } : {}), ...(redetect ? { redetectEverySec } : {}), rle: answer.rle, cost: answer.cost })
        return { rle: answer.rle, cost: answer.cost }
      }),
    )
    const cost = answers.every((a) => a.cost === null) ? null : answers.reduce((sum, a) => sum + (a.cost ?? 0), 0)
    // perShot / redetect: each chunk fitted to exactly its planned frames, so a count the tolerance let
    // through in one chunk never moves the next chunk's masks off its boundary (dozens of short re-detection
    // chunks would otherwise add up to a drift). Both off: joined as the model answered.
    const modelRle = perShot || redetect ? answers.flatMap((a, i) => fitMaskFrames(a.rle, chunks[i]!.frames)) : answers.flatMap((a) => a.rle)
    // The chunks' own arrays are no longer needed: let them go, so a frame the size filter replaces
    // leaves no second copy behind (the retry cache already holds the model's answer).
    answers.length = 0
    cached.clear()
    // The model's frame count is checked first: a wrong count is refused as itself, never as a post-processing error.
    assertFrameCountMatches(modelRle.length, totalFrames)
    // All off by default: the model's mask, frame for frame. The region filters run FIRST — the size cut
    // (min ≤ height ≤ max), then the zone (bounding-box centre inside the margins), in one labelling pass
    // a frame — so a frame left with nothing kept counts as empty and is held from the last one.
    const pctOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0)
    const minPct = pctOf(minSubjectHeightPct)
    const maxPct = pctOf(maxSubjectHeightPct)
    // null / absent / all-zero margins (a job queued before zones existed too) = off.
    const zone = normaliseMaskZone(rawZone)
    // In place, frame by frame, yielding to the event loop (other jobs on this worker keep running).
    const filtered = minPct > 0 || maxPct > 0 || zone
      ? await dropMaskRegions(modelRle, prepared.geometry, { minSubjectHeightPct: minPct, maxSubjectHeightPct: maxPct, zone })
      : undefined
    // The model matched something but no region passed the filters: the person asked to ignore those
    // subjects, so an all-black mask (coverage 0) is the answer — delivered and charged as usual.
    const noneLeft = filtered !== undefined && filtered.matched && !filtered.kept
    if (filtered) {
      const cuts = [
        ...(minPct > 0 || maxPct > 0 ? [`${filtered.droppedBySize} outside ${minPct}–${maxPct || 100}% of the frame height`] : []),
        ...(zone ? [`${filtered.droppedByZone} centred outside the zone (margins L${zone.leftPct} R${zone.rightPct} T${zone.topPct} B${zone.bottomPct}%)`] : []),
      ]
      console.log(`[worker] video-mask ${ctx.jobId}: dropped regions — ${cuts.join(", ")}${noneLeft ? " — none left: an empty mask" : ""}`)
    }
    const afterFilters = filtered?.rle ?? modelRle
    // In place, yielding to the event loop like the region filters. Per shot: a held mask never crosses a cut
    // — the CUTS only, never the re-detection boundaries (a subject hidden across one stays held);
    // and never for longer than HOLD_MAX_SEC (a cut the scan missed, a subject that left).
    // steadyRegions: the steady pass takes the hold's place, so a subject is never both held and filled.
    const steady = steadyRegions === true
      ? await runSteadyPass(afterFilters, { job, jobId: ctx.jobId, model, prompt, threshold: detection, localPath: prepared.localPath, workDir, geometry: prepared.geometry, chunks, cutFrames, perShot, redetectEverySec, minPct, maxPct, zone })
      : undefined
    const held = !steady && holdLastMask === true
      ? await holdLastMaskFrames(afterFilters, prepared.geometry.width * prepared.geometry.height, cutFrames, holdMaxFrames(prepared.geometry.frameRate))
      : undefined
    const rle = steady?.rle ?? held?.rle ?? afterFilters
    if (held) console.log(`[worker] video-mask ${ctx.jobId}: held the last mask over ${held.heldFrames} empty frame(s)`)
    if (steady) {
      const { filledFrames, removedRegions, extraRequests, extraFound } = steady.counts
      console.log(`[worker] video-mask ${ctx.jobId}: steady regions — filled ${filledFrames} frame(s), removed ${removedRegions} pop region(s), ${extraRequests} extra request(s) found ${extraFound} subject(s)`)
    }
    const covers = (frames: readonly string[]) => frames.some((f) => maskRleCoveredPixels(f) > 0)
    // The model matched something and the steady pass left nothing: every region was a pop. `afterFilters` is the
    // model's own mask when no filter ran; a filter ran in place on it, and says for itself what the model matched.
    const emptiedBySteady = steady !== undefined && (filtered?.matched ?? covers(afterFilters)) && !covers(rle)

    const maskPath = join(workDir, "mask.mp4")
    const { coveredFraction } = noneLeft || emptiedBySteady
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
        shots,
        coverage: Number(coveredFraction.toFixed(4)),
        // Any region kept on any frame after the filters (exact: `coverage` is rounded to 4 decimals, so a
        // mask of a few pixels reads 0 there). false only when the filters or the steady pass left an empty mask.
        kept: coveredFraction > 0,
        ...(held ? { heldFrames: held.heldFrames } : {}),
        ...(steady ? { steady: steady.counts } : {}),
        // Size and zone together (a region dropped by both counts once).
        ...(filtered ? { droppedRegions: filtered.droppedRegions } : {}),
        // What made this mask: a mask stored and reused later is out of date once it changes.
        recipe: VIDEO_MASK_RECIPE,
      },
      provider: model,
      provider_cost: steady?.cost != null ? (cost ?? 0) + steady.cost : cost,
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

const handleMaskErase: HandlerFn = async function handleMaskErase(job, ctx) {
  const data = job.data as { jobId: string; maskUrl?: string; erase?: MaskEraseBoxInput[]; keep?: MaskEraseBoxInput[]; eraseAlways?: MaskEraseBoxInput[] }
  if (!data.maskUrl || !Array.isArray(data.erase) || data.erase.length === 0) {
    throw new DeterministicJobError("Mask Erase needs a mask video and at least one box.")
  }
  // Regions centred in a keep box are never dropped by an erase box (none = every erase box applies);
  // those in an eraseAlways box always are.
  const keep = Array.isArray(data.keep) ? data.keep : []
  const eraseAlways = Array.isArray(data.eraseAlways) ? data.eraseAlways : []
  const lists = keep.length > 0 || eraseAlways.length > 0
  console.log(`[worker] mask-erase ${ctx.jobId}: ${data.erase.length} box(es)${keep.length > 0 ? `, ${keep.length} kept` : ""}${eraseAlways.length > 0 ? `, ${eraseAlways.length} always` : ""}`)
  const workDir = await createWorkDir("mask-erase")
  try {
    const result = await eraseMaskVideo(data.maskUrl, data.erase, workDir, { keep, eraseAlways })
    await setJobProgress(job, ctx.jobId, 80)
    // Uploaded as it is: a watermark would corrupt the mask.
    await completeFfmpegVideoJob(result.outputPath, ctx, {
      width: result.width,
      height: result.height,
      frames: result.frames,
      coverage: Number(result.coveredFraction.toFixed(4)),
      droppedRegions: result.droppedRegions,
      // Exact (`coverage` is rounded): false only when the erase left nothing.
      kept: result.kept,
      // Said whenever keep or eraseAlways was sent: a worker that predates them never says it.
      ...(lists ? { keptRegions: result.keptRegions } : {}),
    })
    console.log(`[worker] mask-erase ${ctx.jobId}: dropped ${result.droppedRegions} region(s) over ${result.frames} frames${result.kept ? "" : " — none left"}`)
  } finally {
    await cleanupWorkDir(workDir)
  }
}

export const videoMaskHandlers: Record<string, HandlerFn> = {
  "video-mask": handleVideoMask,
  "mask-composite": handleMaskComposite,
  "mask-erase": handleMaskErase,
  // Mask Outline (a trend face mask's role outlines): its own file, the mask's family.
  ...maskOutlineHandlers,
}
