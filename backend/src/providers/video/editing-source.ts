// @reads-none downloads and conforms a run's own video inputs inside the caller's work dir
/**
 * How a step of ours reads a video input (decided 2026-11-22): from the kept
 * original behind the preview the run names, when it may (`lib/video-source.ts`).
 *
 * Two doors, one for each kind of step:
 *
 * - {@link downloadEditingSource}: an EDITING step (Combine, Trim, Loop,
 *   Captions, the Remotion renders and every other node that re-encodes the
 *   picture into an 8-bit H.264 result). It reads the original and makes from
 *   it the step's SOURCE: the preview's own chain (`editingSourceEncodeArgs`:
 *   the same frames, timing and sound, an HDR picture tone-mapped to SDR by
 *   the preview's own tone map) at the working copy's near-lossless quality,
 *   in place of the preview's CRF 23. So the step loses one generation less,
 *   runs exactly as it did on the preview (8-bit H.264 4:2:0 in, the same
 *   length its run was priced on), and its result looks like the preview. A
 *   file given as it is that is HDR (an HDR upload, a kept original whose
 *   preview could not be made) is tone-mapped the same way, keyed on its
 *   probed transfer (HLG or PQ), never on a model name. Every tone-mapped
 *   source is said in the job's result (`hdr_tone_mapped`,
 *   `lib/video-source-context.ts`).
 * - {@link downloadVideoSource}: Merge Video & Audio, which copies the
 *   picture: the original downloaded as it is.
 * - {@link tenBitJoinSource}: the Extend join, onto the original only when
 *   both its inputs are 10-bit; every 8-bit join and the tail sent to the
 *   model read the preview, as before.
 *
 * A step that delivers the picture it was given by stream copy (Loop Video's
 * repeat, Trim's keyframe cut, a lossless loop cut, Adjust Volume's and Pitch
 * & Tempo's video lanes, the scene graph's fast path) reads its input as
 * given: a copy of the conformed source would hand a user the working copy.
 * Every step that does read the source delivers it at the very encode
 * settings it used on the preview (the census holds both).
 *
 * Only a job that reads originals (`VIDEO_SOURCE_JOB_NAMES`, and the renders)
 * takes either path: every other caller of the same provider functions (a
 * product's flow, a plugin's, a pipeline's, a generation composing its own
 * clips) downloads its input exactly as before, with no probe.
 *
 * The new path only ever upgrades: any failure along it — the original gone
 * or over the step's download limit, a probe, a conform that fails, runs out
 * of time or would not fit the box's ffmpeg memory — reads the url as given,
 * exactly as before, and is logged. Only a drain or a cancel propagates.
 *
 * Memory and time are the preview's own (`previewPeakMemoryMiB`,
 * `previewTimeoutMs`: the canvas model at the picture's size, the tone map's
 * frames for HDR). A conform the box's whole ffmpeg budget cannot hold is not
 * attempted. All of a job's conforms together are held to
 * {@link EDITING_SOURCE_BUDGET_MS}: each takes its allowance from the budget
 * in one step before it starts (parallel conforms included), runs at most that
 * long once ffmpeg admits it, and gives back what it did not use; one that
 * does not fit what is left is not started, and the input reads the preview.
 */
import { rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { downloadFile } from "./ffmpeg-utils.js"
import { probeMatched, type MatchedProbe } from "./matched-encode.js"
import { deliveredShape, isHdr, stitchKeepsTenBit } from "./extend-stitch-args.js"
import { extendPeakMemoryMiB } from "./extend-stitch.js"
import { UHD_CANVAS } from "./ffmpeg-memory-model.js"
import { isTenBitOrMore } from "./hevc10-encode.js"
import { encodeEditingSource, previewAllowanceMs, previewChangesFile, previewPeakMemoryMiB, previewTimeoutMs } from "./browser-safe-preview.js"
import { ffmpegMemoryBudgetNow } from "./ffmpeg-admission-instance.js"
import { isKeptOriginalUrl, resolveVideoSource, type VideoSourceDeps } from "../../lib/video-source.js"
import { conformSpentMs, readsOriginalsHere, recordVideoSourceNotice, reserveConformMs, settleConformMs, videoSourceOwner } from "../../lib/video-source-context.js"
import { isDrainAbortError } from "../../lib/worker-drain.js"

/** What `downloadFile` takes as its third argument: the caller's limits, passed on to every download here. */
export type SourceDownloadOptions = NonNullable<Parameters<typeof downloadFile>[2]>

/**
 * The most a job spends conforming originals for its editing steps, all its
 * inputs together: 15 minutes, a sixth of a node's 90-minute ceiling, so the
 * step's own work keeps the time it always had.
 */
export const EDITING_SOURCE_BUDGET_MS = 15 * 60 * 1000

/**
 * The least one conform reserves (and may run for): its allowance under the
 * preview's time model, but never under a minute, so a short clip is not
 * killed for a busy box's slower start.
 */
const MIN_CONFORM_MS = 60 * 1000

/** Where an editing step's input came from. */
export type SourceOrigin =
  /** The kept original behind the preview the run named. */
  | "original"
  /** The url the run named. */
  | "as-given"
  /** The original was found but could not be used: the preview, as given. */
  | "preview-fallback"

export interface EditingSourceRead {
  readonly origin: SourceOrigin
  /** The picture was HDR and was tone-mapped to SDR (said in the job's result). */
  readonly toneMapped: boolean
}

export interface SourceReadOptions {
  /** The run's owner; default the active job's (`lib/video-source-context.ts`). */
  readonly owner?: string
  /** The caller's own download limits, as `downloadFile` takes them. */
  readonly download?: SourceDownloadOptions
  /** Injectable for tests. */
  readonly deps?: VideoSourceDeps
}

/** A drain or a cancel: never read as a failure of this path. */
function mustPropagate(err: unknown): boolean {
  return isDrainAbortError(err) || (err as { name?: unknown } | null)?.name === "JobCancelledError"
}

const brief = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 300)

/** `downloadFile` with the caller's own options, passing none when it gave none (as its plain call did). */
function download(url: string, dest: string, options: SourceDownloadOptions | undefined): Promise<void> {
  return options ? downloadFile(url, dest, options) : downloadFile(url, dest)
}

async function removeQuietly(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined)
}

/**
 * Conform `input` (probed as `probe`) into `dest` as an editing source, or say
 * why not (undefined: the caller keeps what it has). Held to what is left of
 * the job's budget and to the box's whole ffmpeg memory.
 */
async function conformInto(input: string, dest: string, probe: MatchedProbe, what: string): Promise<boolean> {
  // The time the preview's model allows this picture (a 10 s 1080p clip:
  // about 38 s), at least a minute and at most the preview's own limit: what
  // this conform takes from the job's budget BEFORE it starts, in one step (so
  // parallel conforms never spend the same time twice), and the longest it may
  // run once admitted. A long or unmeasured picture, or one the budget cannot
  // cover, reads as given at once rather than after a conform that runs out.
  const allowance = previewAllowanceMs(probe)
  const reserve = allowance === undefined ? undefined : Math.min(previewTimeoutMs(probe), Math.max(MIN_CONFORM_MS, allowance))
  if (reserve === undefined || !reserveConformMs(reserve, EDITING_SOURCE_BUDGET_MS)) {
    console.warn(`[editing-source] ${what}: its conform does not fit the job's time for conforming sources (${Math.round(conformSpentMs() / 1000)} s of ${EDITING_SOURCE_BUDGET_MS / 1000} s taken, ${reserve === undefined ? "length unread" : `${Math.round(reserve / 1000)} s needed`}); reading the input as given`)
    return false
  }
  // Its clock starts once ffmpeg admits it: a wait for a slot or memory is
  // never conform time. An encode that finished without saying when it was
  // admitted is charged its whole reservation, so the budget never stops
  // limiting.
  let admittedAt: number | undefined
  let finished = false
  try {
    const peak = previewPeakMemoryMiB(probe)
    const budget = ffmpegMemoryBudgetNow().budgetMiB
    if (peak > budget) {
      console.warn(`[editing-source] ${what}: its conform (${peak} MiB predicted) does not fit this box's ffmpeg memory (${budget} MiB); reading the input as given`)
      return false
    }
    const tmp = `${dest}.conform.mp4`
    try {
      await encodeEditingSource(input, tmp, probe, { timeoutMs: reserve, onAdmitted: () => { admittedAt ??= Date.now() } })
      finished = true
      await rename(tmp, dest)
      return true
    } catch (err) {
      if (mustPropagate(err)) throw err
      console.warn(`[editing-source] ${what}: the conform failed; reading the input as given: ${brief(err)}`)
      return false
    } finally {
      await removeQuietly(tmp)
    }
  } finally {
    settleConformMs(reserve, admittedAt !== undefined ? Date.now() - admittedAt : finished ? reserve : 0)
  }
}

/**
 * Download the kept original at `originalUrl` to `raw` and probe it; undefined
 * when it cannot be read (gone, over the caller's limits, no picture).
 */
async function fetchOriginal(originalUrl: string, raw: string, opts: SourceReadOptions, what: string): Promise<MatchedProbe | undefined> {
  try {
    await download(originalUrl, raw, opts.download)
  } catch (err) {
    if (mustPropagate(err)) throw err
    console.warn(`[editing-source] ${what}: its kept original could not be downloaded; reading the preview: ${brief(err)}`)
    return undefined
  }
  const probe = await probeMatched(raw)
  if (!probe.videoCodec || !probe.width || !probe.height) {
    console.warn(`[editing-source] ${what}: its kept original has no picture the probe reads; reading the preview`)
    return undefined
  }
  return probe
}

/**
 * Download an EDITING step's video input `url` to `dest` (module note): the
 * conformed original when the run may read one, else `url` as given —
 * tone-mapped to SDR in place when it is HDR, or itself a kept original.
 */
export async function downloadEditingSource(url: string, dest: string, opts: SourceReadOptions = {}): Promise<EditingSourceRead> {
  // Any other job (a product's, a plugin's, a generation's own), and any read
  // outside a job: exactly the plain download it always was.
  if (!readsOriginalsHere()) {
    await download(url, dest, opts.download)
    return { origin: "as-given", toneMapped: false }
  }
  const owner = opts.owner ?? videoSourceOwner()
  const source = await resolveVideoSource(url, owner, opts.deps)
  if (source.kind === "original") {
    const what = `the input from job ${source.jobId}`
    const raw = `${dest}.original`
    try {
      const probe = await fetchOriginal(source.url, raw, opts, what)
      if (probe) {
        const used = previewChangesFile(probe) ? await conformInto(raw, dest, probe, what) : await rename(raw, dest).then(() => true)
        if (used) {
          const toneMapped = previewChangesFile(probe) && isHdr(probe)
          if (toneMapped) recordVideoSourceNotice("hdr_tone_mapped")
          console.log(`[editing-source] ${what}: read from its kept original${toneMapped ? " (HDR, tone-mapped to SDR)" : ""}`)
          return { origin: "original", toneMapped }
        }
      }
    } finally {
      await removeQuietly(raw)
    }
    await download(url, dest, opts.download)
    return { origin: "preview-fallback", toneMapped: false }
  }
  await download(url, dest, opts.download)
  return { origin: "as-given", toneMapped: await toneMapInPlace(url, dest) }
}

/** How much longer a conform may read than the file it was made from (a rounding of timestamps), in seconds. */
const LENGTH_SLACK_SEC = 0.05

/** Whether `conformed` reads longer than `given`, by its container or its picture stream (a length it does not read is not longer). */
function readsLonger(conformed: MatchedProbe, given: MatchedProbe): boolean {
  const longer = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && a > b + LENGTH_SLACK_SEC
  return longer(conformed.durationSec, given.durationSec) || longer(conformed.videoDurationSec, given.videoDurationSec) || !conformed.videoCodec
}

/**
 * A file read as given that an editing step cannot take as it is: HDR (its
 * probed transfer is HLG or PQ), or itself a kept original (a job whose
 * preview could not be made). Conformed in place; when that cannot be done
 * the file stays as it was downloaded, as before. True when it was
 * tone-mapped.
 */
async function toneMapInPlace(url: string, dest: string): Promise<boolean> {
  const probe = await probeMatched(dest)
  if (!probe.videoCodec || !previewChangesFile(probe)) return false
  const hdr = isHdr(probe)
  if (!hdr && !(await isKeptOriginalUrl(url))) return false
  const raw = `${dest}.as-given`
  const what = hdr ? "an HDR input" : "a kept original given as it is"
  try {
    await rename(dest, raw)
    const conformed = await conformInto(raw, dest, probe, what)
    // The run was priced on the file as given: a conform that reads longer
    // (its sound re-encoded) is not used, so no length check can refuse it.
    if (!conformed || readsLonger(await probeMatched(dest), probe)) {
      if (conformed) console.warn(`[editing-source] ${what}: its conform reads longer than the file as given; reading the file as given`)
      await rename(raw, dest)
      return false
    }
  } finally {
    await removeQuietly(raw)
  }
  if (hdr) recordVideoSourceNotice("hdr_tone_mapped")
  return hdr
}

/**
 * Download a FINISHING step's video input `url` to `dest` (module note): the
 * kept original as it is when the run may read one, else `url` as given. An
 * original that cannot be downloaded reads `url`.
 */
export async function downloadVideoSource(url: string, dest: string, opts: SourceReadOptions = {}): Promise<{ readonly origin: SourceOrigin }> {
  if (!readsOriginalsHere()) {
    await download(url, dest, opts.download)
    return { origin: "as-given" }
  }
  const owner = opts.owner ?? videoSourceOwner()
  const source = await resolveVideoSource(url, owner, opts.deps)
  if (source.kind === "original") {
    const what = `the input from job ${source.jobId}`
    const probe = await fetchOriginal(source.url, dest, opts, what)
    // A step decodes this picture where it decoded the preview (the Extend's
    // tail and join): one the box's whole ffmpeg memory cannot hold, at the
    // preview's own prediction, reads the preview.
    const peak = probe ? previewPeakMemoryMiB(probe) : undefined
    const budget = peak === undefined ? undefined : ffmpegMemoryBudgetNow().budgetMiB
    if (probe && peak !== undefined && budget !== undefined && peak <= budget) {
      console.log(`[editing-source] ${what}: read from its kept original`)
      return { origin: "original" }
    }
    if (probe) console.warn(`[editing-source] ${what}: its kept original (${peak} MiB predicted) does not fit this box's ffmpeg memory (${budget} MiB); reading the preview`)
    await removeQuietly(dest)
    await download(url, dest, opts.download)
    return { origin: "preview-fallback" }
  }
  await download(url, dest, opts.download)
  return { origin: "as-given" }
}

/** The 10-bit join's launch prediction (`extendPeakMemoryMiB`), from the two probes; a side with no size counts as 4K. */
function joinPeakMemoryMiB(original: MatchedProbe, extension: MatchedProbe): number {
  const sizeOf = (p: MatchedProbe) => (p.width && p.height ? { width: p.width, height: p.height } : { ...UHD_CANVAS })
  const source = sizeOf(original)
  return extendPeakMemoryMiB(deliveredShape(source), [source, sizeOf(extension)], false)
}

/**
 * The source an Extend joins its extension onto (decided 2026-11-22: the join
 * writes 10-bit HEVC when its inputs are 10-bit). The run's own download of
 * the url it named (`givenPath`, the preview) everywhere it always was: the
 * tail sent to the model, the checks, and every 8-bit join, so those deliver
 * exactly what they did. Only when the extension is 10-bit, the run keeps
 * 10-bit (`keep`: unwatermarked) and the kept original behind the source is
 * 10-bit of the same dynamic range (`stitchKeepsTenBit`) is the join made onto
 * that original instead, downloaded into `dir` — when the box's ffmpeg memory
 * holds the stitch's own prediction for that join. Anything else is `givenPath`.
 */
export async function tenBitJoinSource(args: {
  readonly sourceUrl: string
  readonly givenPath: string
  readonly extensionPath: string
  readonly dir: string
  readonly keep: boolean
  readonly deps?: VideoSourceDeps
}): Promise<string> {
  if (!args.keep || !readsOriginalsHere()) return args.givenPath
  const extension = await probeMatched(args.extensionPath)
  if (!isTenBitOrMore(extension)) return args.givenPath
  const source = await resolveVideoSource(args.sourceUrl, videoSourceOwner(), args.deps)
  if (source.kind !== "original") return args.givenPath
  const what = `the Extend source from job ${source.jobId}`
  const originalPath = join(args.dir, "source-original")
  const original = await fetchOriginal(source.url, originalPath, {}, what)
  // The stitch's own prediction for this join: two inputs (the original and
  // the extension) at the source's delivered size, with no tone map (a 10-bit
  // join keeps its dynamic range).
  const fits = original !== undefined && joinPeakMemoryMiB(original, extension) <= ffmpegMemoryBudgetNow().budgetMiB
  if (original && fits && stitchKeepsTenBit(original, extension, true)) {
    console.log(`[editing-source] ${what}: joined onto its kept original (both 10-bit)`)
    return originalPath
  }
  if (original && !fits) console.warn(`[editing-source] ${what}: its kept original does not fit this box's ffmpeg memory; joining onto the preview`)
  await removeQuietly(originalPath)
  return args.givenPath
}
