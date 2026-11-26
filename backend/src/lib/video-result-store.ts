/**
 * THE funnel every stored video result goes through (decided 2026-11-22): a
 * provider's delivered file, or a file our own mux / stitch wrote from one.
 * `video-result-store-totality.test.ts` fails the build on a video stored past
 * it.
 *
 * What it stores, by the PROBED file (never a model or provider id):
 *
 * - A watermarked run: the watermarked browser-safe file at `videos/<id>.mp4`,
 *   and nothing else, exactly as before (no unwatermarked byte is stored).
 * - A file the browser-safe step would not change (H.264 yuv420p): that file,
 *   at `videos/<id>.mp4`. No original: the two would be the same picture.
 * - Any other file: the file UNTOUCHED as the original, at
 *   `videos/<id>-master.<ext>` with its own content type, uploaded FIRST; then
 *   its browser-safe preview (`providers/video/browser-safe-preview.ts`: an HDR
 *   picture tone-mapped to SDR, a 10-bit one taken to 8-bit) at
 *   `videos/<id>.mp4`. `videoUrl` names the preview, `originalVideoUrl` the
 *   original. A preview that fails or runs out of time does not lose the run:
 *   `videoUrl` names the original and `videoPreviewUnavailable` says there is
 *   no preview copy.
 *
 * Both keys are in the job's own family (`<id>` and `<id>-master`), so the
 * result gate, the retention sweep and the app expunge find the original in
 * `output_data` with nothing more to do — as long as the caller writes every
 * field `storedVideoFields` returns at the completion write, which is why the
 * funnel returns them together and never a bare url.
 *
 * A caller that keeps no original (`original: "never"`: the plugin toolkit's
 * string-returning wrappers, whose callers could not record one) stores only
 * the browser-safe file, as before; its preview failure fails the store.
 *
 * `storeVideoAsIs` is the one other door: a file stored exactly as it is
 * under a caller-chosen container (a QuickTime child result its parent
 * re-encodes, an extension kept as the next extend's reference). It never
 * transcodes and never keeps a second copy.
 *
 * POST-PROVIDER by construction: every failure here is a PostProcessingError
 * (the refund guard skips it).
 */
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { runPostProcessing } from "./post-processing-error.js"
import { mediaObjectKey, uploadFileToR2, uploadToR2, type VideoContainerExt } from "./storage.js"
import {
  deleteUnnamedDeliveredObject,
  deliveredKeepsKey,
  discardIfNeverRecorded,
  discardJustStored,
  isLastAttempt,
  jobIdOfStoreId,
  recordStoredObjectAndCharge,
  storeBeginTime,
} from "./job-server-output.js"
import { DeterministicJobError } from "./deterministic-job-error.js"
import { supabase } from "./supabase.js"
import { isResourceShortage } from "../providers/video/ffmpeg-shortage-retry.js"
import { applyVideoWatermark } from "../utils/watermark.js"
import { cleanupWorkDir, createWorkDir, downloadFile, runFfprobe, transcodeToBrowserSafe } from "../providers/video/ffmpeg-utils.js"
import { parseMatchedProbe, type MatchedProbe } from "../providers/video/matched-encode.js"
import { encodeBrowserSafePreview, pictureDecodes, previewChangesFile } from "../providers/video/browser-safe-preview.js"
import { toolRefusedInput } from "../providers/video/ffmpeg-input-verdict.js"
import { originalVideoObjectId } from "./video-original-keys.js"
import { isDrainAbortError } from "./worker-drain.js"
import { getJobId, isFinalAttemptOfRunningJob, JobCancelledError } from "./job-cancellation.js"

export { originalVideoObjectId }

/** What a stored video result is: the fields its job's `output_data` records. */
export interface StoredVideo {
  /** The browser-safe file — or, with `videoPreviewUnavailable`, the original. */
  readonly videoUrl: string
  /** The provider's file as it was delivered, when the browser-safe step changed it. */
  readonly originalVideoUrl?: string
  /** The preview could not be made: `videoUrl` is the original, which a browser may not play. */
  readonly videoPreviewUnavailable?: true
}

/** The `output_data` fields of a stored video, for the completion write. */
export function storedVideoFields(stored: StoredVideo): {
  videoUrl: string
  originalVideoUrl?: string
  videoPreviewUnavailable?: true
} {
  return {
    videoUrl: stored.videoUrl,
    ...(stored.originalVideoUrl !== undefined ? { originalVideoUrl: stored.originalVideoUrl } : {}),
    ...(stored.videoPreviewUnavailable ? { videoPreviewUnavailable: true as const } : {}),
  }
}

/**
 * The files of a store that were charged when they were uploaded (the
 * preview, or the file stored as it is). A kept original is not among them:
 * it is charged, claimed and given back through its job's record
 * (lib/job-server-output.ts), never by a caller's own ledger.
 */
export function uploadChargedVideoUrls(stored: StoredVideo): string[] {
  return stored.videoUrl === stored.originalVideoUrl ? [] : [stored.videoUrl]
}

/** A stored video whose only file is `url`: what a writer outside the funnel hands on (a url it did not store). */
export function storedVideoAt(url: string): StoredVideo {
  return { videoUrl: url }
}


/**
 * The far end's file a RELAYED video run brings home (decided 2026-11-22):
 * the original it kept (its `originalVideoUrl`) on an unwatermarked run, so
 * this instance keeps it too, else its playable copy. A watermarked run
 * watermarks the playable copy, as before.
 */
export function relaySourceOf(output: Record<string, unknown>, playable: string, watermark: boolean): string {
  const original = output.originalVideoUrl
  return !watermark && typeof original === "string" && /^https:\/\//.test(original) ? original : playable
}

/** The source of a store: a url to fetch or a local file. */
export type VideoSource = { readonly url: string } | { readonly path: string }

export interface StoreVideoOptions {
  /** The object id: `videos/<jobId>.mp4` (a job id, or one in its family: `<jobId>-merged`). */
  readonly jobId: string
  readonly userId: string | undefined
  /** The run is watermarked (`jobs.should_watermark`): only the watermarked file is stored. */
  readonly watermark: boolean
  /** The preview's CRF (default 23; an upscale keeps 18). */
  readonly crf?: string
  /** `"never"`: keep no original (a caller that cannot record one). Default: keep it when the preview changes the file. */
  readonly original?: "keep" | "never"
}

/**
 * A delivered video the platform cannot use (decided 2026-11-23): empty, or
 * with no picture that decodes. The provider's result, not a fault of ours:
 * the job fails and its credits are refunded at once (a DeterministicJobError,
 * never a PostProcessingError), and a reconcile gives it up on its first try.
 */
export class UnusableVideoError extends DeterministicJobError {
  constructor(jobId: string, why: string, options?: { cause?: unknown }) {
    super(`${UNUSABLE_VIDEO_PREFIX} the video delivered for ${jobId} ${why}`, options)
    this.name = "UnusableVideoError"
  }
}

/** The message prefix of an UnusableVideoError (the reconcile's deterministic patterns match it). */
export const UNUSABLE_VIDEO_PREFIX = "unusable-video:"

/** The containers an original is stored as, by what ffprobe read of the file; undefined for one we do not store as an original. */
function originalContainer(formatName: string | undefined, probe: MatchedProbe): VideoContainerExt | undefined {
  const names = (formatName ?? "").split(",")
  if (names.includes("mov") || names.includes("mp4")) return probe.quickTime ? "mov" : "mp4"
  if (names.includes("matroska") || names.includes("webm")) {
    return ["vp8", "vp9", "av1"].includes(probe.videoCodec ?? "") ? "webm" : "mkv"
  }
  return undefined
}

/**
 * What the funnel's probe read: a video stream (`probe.videoCodec`) and its
 * container; nothing (`read: false`: ffprobe answered the file has no video
 * stream, or refused it as invalid); or could not tell (`read: "unknown"`:
 * the machine failed the probe).
 */
type StoredProbe = { read: true; probe: MatchedProbe; formatName?: string } | { read: false } | { read: "unknown"; cause: unknown }

/** One ffprobe of the file: the shared picture probe plus the container's name. Throws ffprobe's own failure. */
async function probeOnce(path: string): Promise<StoredProbe> {
  const json = await runFfprobe([
    "-v", "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,pix_fmt,bit_rate,r_frame_rate,avg_frame_rate,duration,start_time,color_space,color_primaries,color_transfer,color_range:format=format_name,bit_rate,duration:format_tags=major_brand",
    "-of", "json",
    path,
  ])
  const probe = parseMatchedProbe(json)
  if (!probe.videoCodec) return { read: false }
  const formatName = (JSON.parse(json) as { format?: { format_name?: unknown } }).format?.format_name
  return { read: true, probe, ...(typeof formatName === "string" ? { formatName } : {}) }
}

/**
 * The probe, asked twice when the first ask fails (a probe that throws once on
 * a healthy file must not change what is stored). `read: false` when it never
 * read a video stream: the file is then stored exactly as before this funnel
 * existed (`storeLocal`).
 */
async function probeStored(path: string): Promise<StoredProbe> {
  let last: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await probeOnce(path)
    } catch (err) {
      // Asked once more below.
      last = err
    }
  }
  // Nothing read only when ffprobe itself refused the file (a positive rule,
  // decided 2026-11-23); any other failure is the machine's: could not tell.
  return toolRefusedInput((last as { message?: unknown } | null)?.message as string | undefined) ? { read: false } : { read: "unknown", cause: last }
}

/**
 * Whether a failed preview encode is the ENCODE failing — ffmpeg ran and
 * exited non-zero, or ran past its own time limit — and so may leave the job
 * on its original. Every other failure keeps its own handling and is rethrown:
 * a drain or a cancel (the job is re-picked or ends), a launch that was
 * aborted or never started, a box short of threads or memory, a slot wait that
 * gave up. Only `runFfmpeg`'s own failure carries `killed` (execFailureFlags).
 */
export function isPreviewEncodeFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  if (isDrainAbortError(err) || err instanceof JobCancelledError || (err as { name?: unknown }).name === "JobCancelledError") return false
  const flags = err as { killed?: unknown; notStarted?: unknown; aborted?: unknown; truncated?: unknown; signalledFromOutside?: unknown }
  if (typeof flags.killed !== "boolean" || flags.notStarted === true || flags.aborted === true) return false
  // The box's failures, never the encode's: a child the kernel killed (out of
  // memory: SIGKILL, `killed` false, no exit code), or a log that outgrew its
  // capture buffer.
  if (flags.signalledFromOutside === true || flags.truncated === true) return false
  return !isResourceShortage(err)
}

/** How often a running preview encode asks whether its job was cancelled. */
const CANCEL_POLL_MS = 4000

/**
 * A signal that aborts (with `JobCancelledError`) once job `jobId`'s row is
 * cancelled or failed, polled while a preview encode runs; `stop()` ends the
 * poll. Never the worker's drain: a drain hands a job on at its next boundary
 * and never throws away a paid result mid-store (`workerDrainSignal`).
 */
function cancelSignalOf(jobId: string | undefined): { signal?: AbortSignal; stop: () => void } {
  if (!jobId) return { stop: () => undefined }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const poll = async () => {
    try {
      // trash-read: the worker asking whether the job it is storing for was cancelled — never answered to a user
      const { data } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle()
      const status = (data as { status?: unknown } | null)?.status
      if (status === "cancelled" || status === "failed") controller.abort(new JobCancelledError(jobId))
    } catch {
      // A failed read is asked again on the next tick.
    }
    if (!stopped && !controller.signal.aborted) timer = setTimeout(() => void poll(), CANCEL_POLL_MS)
  }
  timer = setTimeout(() => void poll(), CANCEL_POLL_MS)
  return {
    signal: controller.signal,
    stop: () => {
      stopped = true
      clearTimeout(timer)
    },
  }
}

/**
 * The job a store may record its original on: the UUID head of its store id,
 * and only when that is the job this worker is running (`getJobId()`, where a
 * job context is active) — a plugin that names another job's id keeps no
 * original, so it can never record onto (or charge through) another row.
 */
function recordingJobOf(storeId: string): string | undefined {
  const head = jobIdOfStoreId(storeId)
  const running = getJobId()
  if (running !== undefined && head !== running) return undefined
  return head
}

/**
 * The preview encode of a file whose picture did not decode or could not be
 * read: when ffmpeg itself RAN and answered that it cannot use the file (it
 * exited on its own with an error, or made no frame of it), the file is the
 * provider's unusable result (`UnusableVideoError`, decided 2026-11-23). Any
 * other failure stays its own and is retried as before: a cancel, a launch
 * that never started, ffmpeg's own time limit, a kill, a log that outgrew its
 * buffer, a machine short of threads or memory, or a frame count that could
 * not run.
 */
async function encodeOrUnusable(path: string, previewPath: string, probe: MatchedProbe, opts: StoreVideoOptions, why: string): Promise<void> {
  try {
    await encodePreviewFor(path, previewPath, probe, opts)
  } catch (err) {
    const flags = (err ?? {}) as { killed?: unknown; timedOut?: unknown; noVideoFrame?: unknown; message?: unknown }
    // ffmpeg ran to its own end and named the input as invalid (a positive
    // rule, `toolRefusedInput`): never an exit code alone.
    const ffmpegRefused = isPreviewEncodeFailure(err) && flags.killed === false && flags.timedOut !== true
      && toolRefusedInput(typeof flags.message === "string" ? flags.message : undefined)
    if (ffmpegRefused || flags.noVideoFrame === true) {
      throw new UnusableVideoError(opts.jobId, why, { cause: err })
    }
    throw err
  }
}

/**
 * A probe or decode check the machine could not run (decided 2026-11-23):
 * retried like any other failure, except on the job's last attempt, where the
 * file is stored the way it always was (`storeAsBefore`) so the job delivers
 * its video instead of ending failed with nothing.
 */
async function checkCouldNotRun(path: string, workDir: string, opts: StoreVideoOptions, cause: unknown, what: string): Promise<StoredVideo> {
  const job = recordingJobOf(opts.jobId) ?? jobIdOfStoreId(opts.jobId)
  if (job !== undefined && (await isLastAttempt(job, isFinalAttemptOfRunningJob()))) {
    console.warn(`[video-result-store] the video of ${opts.jobId} could not be ${what} on its last attempt; stored as before:`, cause)
    return storeAsBefore(path, workDir, opts)
  }
  throw new Error(`[video-result-store] the video of ${opts.jobId} could not be ${what}`, { cause })
}

/** The preview encode with the job's cancel wired in (`cancelSignalOf`). */
async function encodePreviewFor(path: string, previewPath: string, probe: MatchedProbe, opts: StoreVideoOptions): Promise<void> {
  // The running job where a job context is active (a plugin-named id never picks which job's cancel is watched).
  const cancel = cancelSignalOf(getJobId() ?? jobIdOfStoreId(opts.jobId))
  try {
    await encodeBrowserSafePreview(path, previewPath, probe, opts.crf, cancel.signal)
  } finally {
    cancel.stop()
  }
}

/**
 * The store from before this change (decided 2026-11-22): the browser-safe
 * transcode as it always ran, and that file alone. What a store does where an
 * original's record did not land, or a check could not run on the last
 * attempt — so there no original ever exists, and nothing is charged that no
 * record can give back.
 */
async function storeAsBefore(path: string, workDir: string, opts: StoreVideoOptions): Promise<StoredVideo> {
  const uploadPath = await transcodeToBrowserSafe(path, join(workDir, "before.mp4"), opts.crf)
  return { videoUrl: await uploadFileToR2(uploadPath, opts.jobId, "video", opts.userId) }
}

/**
 * The machine's failures of an encode (an encode the system killed for memory,
 * a log that outgrew its buffer): retried like any other on every attempt but
 * the job's last, where the job completes on its original instead.
 */
function isMachineEncodeFailure(err: unknown): boolean {
  const flags = (err ?? {}) as { signalledFromOutside?: unknown; truncated?: unknown }
  return flags.signalledFromOutside === true || flags.truncated === true
}

/** Store a local file through the rule (module note). `workDir` holds the preview. */
async function storeLocal(path: string, workDir: string, opts: StoreVideoOptions): Promise<StoredVideo> {
  if (opts.watermark) {
    const wmPath = join(workDir, "watermarked.mp4")
    await applyVideoWatermark(path, wmPath)
    return { videoUrl: await uploadFileToR2(wmPath, opts.jobId, "video", opts.userId) }
  }
  if ((await sizeOf(path)) === 0) throw new UnusableVideoError(opts.jobId, "is empty")
  const stored = await probeStored(path)
  const previewPath = join(workDir, "preview.mp4")
  // The probe could not run (the machine's failure): retried; on the job's
  // last attempt the file is stored the way it always was, so the user still
  // gets their video (decided 2026-11-23).
  if (stored.read === "unknown") return checkCouldNotRun(path, workDir, opts, stored.cause, "probed")
  // Nothing read (an error page, a truncated file, sound alone, a probe that
  // kept failing): the browser-safe encode as it always ran. A file it cannot
  // make a picture of is the provider's unusable result. Never an original.
  if (!stored.read) {
    await encodeOrUnusable(path, previewPath, {}, opts, "has no picture that decodes")
    return { videoUrl: await uploadFileToR2(previewPath, opts.jobId, "video", opts.userId) }
  }
  const { probe, formatName } = stored
  if (!previewChangesFile(probe)) {
    return { videoUrl: await uploadFileToR2(path, opts.jobId, "video", opts.userId) }
  }
  const ext = originalContainer(formatName, probe)
  const owner = recordingJobOf(opts.jobId)
  // No original for: a caller that keeps none, a container we do not keep, a
  // store with no job of its own to record it on, and a file whose picture
  // does not decode (a header that reads over media data that is zeroed,
  // missing or cut away, or a picture with no size) — that one is stored the
  // old way, which fails the store when the preview has nothing in it:
  // nothing kept, nothing charged (decided 2026-11-22).
  const decodes = await pictureDecodes(path, probe)
  // The check could not run (the machine's failure): retried, never read as
  // "no picture"; on the last attempt stored the way it always was.
  if (typeof decodes === "object") return checkCouldNotRun(path, workDir, opts, decodes.unknown, "checked")
  if (decodes === "no") {
    await encodeOrUnusable(path, previewPath, probe, opts, "has no picture that decodes")
    return { videoUrl: await uploadFileToR2(previewPath, opts.jobId, "video", opts.userId) }
  }
  if (opts.original === "never" || ext === undefined || owner === undefined) {
    await encodePreviewFor(path, previewPath, probe, opts)
    return { videoUrl: await uploadFileToR2(previewPath, opts.jobId, "video", opts.userId) }
  }
  // When this store began, by the database's clock: a key another store of
  // the job discards after this is not recorded by this store.
  const begunAt = await storeBeginTime()
  if (begunAt === undefined) return storeAsBefore(path, workDir, opts)
  // The original first: it is the delivered render, and what completes the job
  // if the preview encode fails. It exists only if its record lands
  // (`recordStoredObjectAndCharge`: on its live job, charged to that job's
  // owner once per key, so a retry is not charged twice). The fallback below
  // completes a job only on an original that passed the decode check above.
  const originalId = originalVideoObjectId(opts.jobId)
  const originalVideoUrl = await uploadFileToR2(path, originalId, "video", undefined, { ext })
  const originalKey = mediaObjectKey(originalId, "video", ext)
  const bytes = (await sizeOf(path)) ?? 0
  const recorded = await recordStoredObjectAndCharge({ jobId: owner, key: originalKey, bytes, begunAt })
  switch (recorded.outcome) {
    case "ended":
      // The job was cancelled or failed while the original was stored: it is
      // deleted, nothing stays charged, and the store stops as a cancel.
      await discardJustStored(owner, originalKey, "ended")
      throw new JobCancelledError(owner)
    case "unrecorded":
      // Its record did not land, so it must not exist: deleted (unless another
      // store of the job recorded that key meanwhile), and the file stored
      // exactly as before this change.
      await discardJustStored(owner, originalKey, "unrecorded")
      return storeAsBefore(path, workDir, opts)
    case "unknown":
      // Whether it was recorded cannot be told: no original is named. It is
      // discarded as an unrecorded one is — never when a record names it
      // (the completion's prune claims that one), and left to the delete
      // retry pass when the database cannot be asked (decided 2026-11-23).
      await discardIfNeverRecorded(owner, originalKey)
      return storeAsBefore(path, workDir, opts)
    case "delivered":
      // The job already completed (a second finalizer of a delivered job), or
      // its row is gone. The object stays only when the completed output names
      // that very key (it IS the delivered original, overwritten in place);
      // otherwise nothing ever will name it, so it is deleted (decided
      // 2026-11-23). This store's result is then thrown away by its
      // completion, which misses as it always did.
      if ((await deliveredKeepsKey(owner, originalKey)) !== "named") {
        await deleteUnnamedDeliveredObject(owner, originalKey)
        return storeAsBefore(path, workDir, opts)
      }
      break
    case "recorded":
      break
  }
  try {
    await encodePreviewFor(path, previewPath, probe, opts)
  } catch (err) {
    if (!isPreviewEncodeFailure(err) && !(isMachineEncodeFailure(err) && (await isLastAttempt(owner, isFinalAttemptOfRunningJob())))) throw err
    console.warn(`[video-result-store] preview encode of ${opts.jobId} failed; the result is the original alone:`, err)
    return { videoUrl: originalVideoUrl, originalVideoUrl, videoPreviewUnavailable: true }
  }
  // Outside the fallback: a failed upload of the preview is a storage failure,
  // retried like any other, never a job completed without its preview.
  const videoUrl = await uploadFileToR2(previewPath, opts.jobId, "video", opts.userId)
  return { videoUrl, originalVideoUrl }
}

/** A local file's size in bytes, or undefined when it cannot be read. */
async function sizeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size
  } catch {
    return undefined
  }
}

/**
 * Store a video result (module note). Returns every field its job's
 * `output_data` records (`storedVideoFields`).
 */
export async function storeVideoResult(source: VideoSource, opts: StoreVideoOptions): Promise<StoredVideo> {
  // A cancel stays a cancel (the worker's own handling), and a delivered video
  // we cannot use fails with its refund: neither is a post-processing failure.
  return storeAsPostProcessing(source, opts).catch((err: unknown) => {
    const cause = (err as { cause?: unknown } | null)?.cause
    throw cause instanceof JobCancelledError || cause instanceof UnusableVideoError ? cause : err
  })
}

async function storeAsPostProcessing(source: VideoSource, opts: StoreVideoOptions): Promise<StoredVideo> {
  return runPostProcessing(async () => {
    const workDir = await createWorkDir("vstore")
    try {
      let path: string
      if ("path" in source) {
        path = source.path
      } else {
        path = join(workDir, "input.mp4")
        await downloadFile(source.url, path)
      }
      return await storeLocal(path, workDir, opts)
    } finally {
      await cleanupWorkDir(workDir)
    }
  })
}

/**
 * Store a video exactly as it is, under `ext` (module note): a fetched url or
 * a local file. Never transcoded, never watermarked, no second copy — so a
 * caller only reaches it for a file no watermarked run delivers.
 */
export async function storeVideoAsIs(source: VideoSource, opts: { jobId: string; userId: string | undefined; ext: VideoContainerExt }): Promise<StoredVideo> {
  return runPostProcessing(async () => ({
    videoUrl: "path" in source
      ? await uploadFileToR2(source.path, opts.jobId, "video", opts.userId, { ext: opts.ext })
      : await uploadToR2(source.url, opts.jobId, "video", opts.userId, { ext: opts.ext }),
  }))
}
