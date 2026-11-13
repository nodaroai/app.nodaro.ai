/**
 * The extend stitch: the source, then the extension generated from its tail,
 * as one clip at the source's size (rounded down to even, `deliveredShape`),
 * frame rate and picture quality.
 *
 * - The boundary is found on two small proxies (the source's last
 *   `framesFromPrev` frames and the extension's first `framesFromNext`, each
 *   with a margin of frames beyond its window, `boundaryProxySpans`, made
 *   exactly as the stitch reads each picture) by the smart-cut matcher when
 *   one is registered (`smart-cut.ts`). With no matcher, no match or a failed
 *   search, the caller's fixed trims apply: combineVideos' semantics.
 * - When the caller asks (`dropLeadingRepeats`: PixVerse V6), the frames at
 *   the start of the kept extension that repeat the extension's frame before
 *   them, measured on its own frames at its own rate, are dropped after the
 *   cut by their time and counted in its start trim (`extend-stitch-repeats.ts`).
 * - The picture, the sound and the encode are built by `extend-stitch-args.ts`
 *   (pure), as its header sets out; here both clips are probed, each picture's
 *   frames counted at the output rate, the boundary found, and ffmpeg run.
 */
import { join } from "node:path"
import { probeAudioSampleRate, probeVideoOverlayBase, runFfmpeg, type VideoOverlayBaseProbe } from "./ffmpeg-utils.js"
import { probeMatched, probeMatchedOrThrow, type MatchedProbe } from "./matched-encode.js"
import {
  boundaryProxySpans,
  deliveredPictureFilter,
  deliveredShape,
  extendStitchArgs,
  extensionPicture,
  isHdr,
  pictureSize,
  sourcePicture,
  stitchEncodesAtBitRate,
  stitchProxyArgs,
  stitchRate,
  type ExtendStitchEncode,
  type PictureShape,
  type StitchRate,
} from "./extend-stitch-args.js"
import { getSmartCutMatcher, type SmartCutBoundary } from "./smart-cut.js"
import { measureLeadingRepeats, type LeadingRepeats } from "./extend-stitch-repeats.js"
import { cameraMegapixelsOf, canvasPeakMemoryMiB, toneMapPeakMemoryMiB, UHD_CANVAS } from "./ffmpeg-memory-model.js"
import { defaultLaunchPeakMiB } from "./ffmpeg-admission-instance.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"

export interface ExtendStitchArgs {
  sourcePath: string
  extensionPath: string
  /** Where the proxies, the two-pass log and the result are written; the caller removes it. */
  workDir: string
  /** Search the boundary with the smart-cut matcher over these windows. Absent: the fixed trims. */
  smartCut?: { framesFromPrev: number; framesFromNext: number }
  /** Frames dropped from the source's end and the extension's start when no match is applied. */
  fallbackTrims: { trimEndFrames: number; trimStartFrames: number }
  /** The sound's crossfade at the join, in seconds. */
  audioFadeSec: number
  /**
   * After the cut, also drop the frames at the start of the kept extension
   * that repeat the extension's frame before them (`extend-stitch-repeats.ts`):
   * PixVerse V6's native extension, whose new part can open on a brief hold.
   * Their count is added to the reported start trim. Absent: nothing more is
   * dropped.
   */
  dropLeadingRepeats?: boolean
}

export interface ExtendStitchResult {
  outputPath: string
  /** Where the stitch cut, in combineVideos' `smartCuts` terms (one boundary). */
  boundary: {
    /** True: the matcher's cut was applied. False: the fixed trims were. */
    matched: boolean
    /** The best pair's PSNR, rounded to 0.01 dB (identical frames: 100); null when no search ran or it failed. */
    psnrDb: number | null
    /** Frames dropped from the source's end, as applied. */
    trimEndFrames: number
    /**
     * Frames dropped from the extension's start (at the source's rate), as
     * applied: the cut's, plus the output frames that showed its leading
     * repeats (`dropLeadingRepeats`: measured on its own frames, dropped by
     * their time). With no cut those repeats follow its first frame, which is
     * kept.
     */
    trimStartFrames: number
    /** The windows the matcher searched (its clamp); null when no search ran or it failed. */
    searchedPrevFrames: number | null
    searchedNextFrames: number | null
  }
}

interface StitchLayout {
  source: MatchedProbe
  extension: MatchedProbe
  rate: StitchRate
  shape: PictureShape
  sourceFrames: number
  extensionFrames: number
}

/**
 * The matcher's verdict on the boundary, or null when there is none to have:
 * no smart cut asked for, no matcher registered, or the search (proxies
 * included) failed. A failure never fails the stitch.
 */
async function searchBoundary(
  args: ExtendStitchArgs,
  layout: StitchLayout,
  launch: { peakMemoryMiB: number },
): Promise<SmartCutBoundary | null> {
  if (!args.smartCut) return null
  const matcher = getSmartCutMatcher()
  if (!matcher) {
    console.warn("[extendStitch] smart cut requested but no matcher engine is registered (cloud plugin absent or outdated) — keeping the fixed trims")
    return null
  }
  const { framesFromPrev, framesFromNext } = args.smartCut
  const { source, rate, shape, sourceFrames, extensionFrames } = layout
  const spans = boundaryProxySpans(args.smartCut, { source: sourceFrames, extension: extensionFrames })
  const prev = join(args.workDir, "stitch-prev.mp4")
  const next = join(args.workDir, "stitch-next.mp4")
  try {
    await runFfmpeg(stitchProxyArgs(args.sourcePath, sourcePicture(source, shape, rate, spans.prev.start, spans.prev.end), prev), undefined, launch)
    await runFfmpeg(stitchProxyArgs(args.extensionPath, extensionPicture(rate, shape, spans.next.start, spans.next.end), next), undefined, launch)
    return await matcher(prev, next, framesFromPrev, framesFromNext, "best-pair")
  } catch (err) {
    console.log(`[extendStitch] smart cut failed, keeping the fixed trims: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * The frames at the start of the kept extension that repeat the extension's
 * frame before them (`measureLeadingRepeats`), counted after the cut
 * `applied` on the extension's own frames, at its own rate, and the output
 * frames that show them, when the caller asked for the drop: at most
 * `MAX_LEADING_REPEATS` of its own frames, never its last frame. None when
 * not asked for, when nothing repeats, or when the measure fails: a failure
 * never fails the stitch.
 */
async function leadingRepeatsAfter(
  args: ExtendStitchArgs,
  layout: StitchLayout,
  applied: ExtendStitchResult["boundary"],
  launch: { peakMemoryMiB: number },
): Promise<LeadingRepeats | undefined> {
  if (!args.dropLeadingRepeats) return undefined
  try {
    // The extension's own rate, read as the stitch reads a source's, and its own frame count at it.
    const native = stitchRate(layout.extension).fps
    const repeats = await measureLeadingRepeats({
      extensionPath: args.extensionPath,
      rates: { native, output: layout.rate.fps },
      keptStart: applied.trimStartFrames,
      nativeFrames: Math.round((pictureSecondsOf(layout.extension) ?? 0) * native),
      outputFrames: layout.extensionFrames,
    }, launch)
    return repeats.output.count > 0 ? repeats : undefined
  } catch (err) {
    console.log(`[extendStitch] leading-repeat measure failed, dropping none: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}

/** A trim that would leave its side no picture is skipped, as `trimEdgeFrames` skips one. */
const keepingSome = (trim: number, frames: number): number => (trim > 0 && trim < frames ? trim : 0)

/** The boundary applied: the matcher's cut when it matched, else the fixed trims (combineVideos' reporting). */
function boundaryOf(
  fallback: ExtendStitchArgs["fallbackTrims"],
  cut: SmartCutBoundary | null,
  frames: { source: number; extension: number },
): ExtendStitchResult["boundary"] {
  const trims = cut?.matched ? cut : fallback
  return {
    matched: cut?.matched ?? false,
    psnrDb: cut ? (Number.isFinite(cut.psnr) ? Math.round(cut.psnr * 100) / 100 : 100) : null,
    trimEndFrames: keepingSome(trims.trimEndFrames, frames.source),
    trimStartFrames: keepingSome(trims.trimStartFrames, frames.extension),
    searchedPrevFrames: cut?.searchedPrevFrames ?? null,
    searchedNextFrames: cut?.searchedNextFrames ?? null,
  }
}

/**
 * An encode at the source's size (`canvas`) of the `decoded` pictures, one
 * input each, predicted from the largest of them; with the tone-map's buffers
 * when it takes an HDR source to SDR (`toneMap`).
 */
function extendPeakMemoryMiB(canvas: PictureShape, decoded: readonly PictureShape[], toneMap: boolean): number {
  return canvasPeakMemoryMiB(canvas, decoded.length, ffmpegEffectiveThreads(), {
    inputs: decoded.length,
    cameraMegapixels: Math.max(...decoded.map(cameraMegapixelsOf)),
    toneMap,
  })
}

/** The picture the default launch estimate (`defaultLaunchPeakMiB`) is the base of: 1080p. */
const DEFAULT_ESTIMATE_PICTURE: PictureShape = { width: 1920, height: 1080 }

/**
 * What re-encoding one picture of `size` holds beyond the same launch on a
 * 1080p picture, the one the default launch estimate is the base of: the
 * stitch's size → memory model (`extendPeakMemoryMiB`) at the two sizes, 0 at
 * or below 1080p's megapixels.
 */
function pictureAboveDefaultMiB(size: PictureShape): number {
  const reencode = (picture: PictureShape): number => extendPeakMemoryMiB(picture, [picture], false)
  return Math.max(0, reencode(size) - reencode(DEFAULT_ESTIMATE_PICTURE))
}

/**
 * How the extend's tail (its `@video_1` reference, and the last frame taken
 * from it) is cut from `source` (`extractTailToFile`'s options). An HDR, a
 * full-range or an odd-size source: its picture through the stitch's own
 * conversion (`deliveredPictureFilter`: rounded down to even, to SDR, to
 * limited range), so the model continues the very picture the result shows,
 * the boundary match compares like with like, and an odd-size picture can be
 * encoded at all (H.264 4:2:0 needs even sides). Any other source's picture is
 * cut as it always was.
 *
 * Every cut decodes and re-encodes the source's picture, so it is admitted at
 * what a tail cut reserves (the default launch, `defaultLaunchPeakMiB`, a
 * 1080p estimate) plus what a picture of the source's stored size holds beyond
 * 1080p (`pictureAboveDefaultMiB`; 4K when it reports no size), plus the
 * tone-map's buffers at that size for an HDR source. A cut that adds nothing
 * to the default (an SDR source at or below 1080p) names no launch: admitted
 * at the default, exactly as before.
 */
export function extendTailPicture(source: MatchedProbe): { pictureFilter?: string; launch?: { peakMemoryMiB: number } } {
  const pictureFilter = deliveredPictureFilter(source)
  const size: PictureShape = source.width && source.height ? { width: source.width, height: source.height } : { ...UHD_CANVAS }
  const toneMap = pictureFilter !== undefined && isHdr(source)
  const aboveDefaultMiB = pictureAboveDefaultMiB(size) + (toneMap ? Math.ceil(toneMapPeakMemoryMiB(size)) : 0)
  return {
    ...(pictureFilter ? { pictureFilter } : {}),
    ...(aboveDefaultMiB > 0 ? { launch: { peakMemoryMiB: defaultLaunchPeakMiB() + aboveDefaultMiB } } : {}),
  }
}

/** How far `probe`'s sound starts after its picture, in seconds (negative: before it); 0 when either start is unread. */
function soundOffsetOf(probe: MatchedProbe): number {
  return probe.audioStartSec !== undefined && probe.videoStartSec !== undefined ? probe.audioStartSec - probe.videoStartSec : 0
}

/**
 * A clip's picture length as the stitch counts it: the picture stream's own,
 * else the container's; undefined when it has no picture (or reports no
 * length). What the extend measures an extension by before stitching it
 * (`extensionTooShort`).
 */
export function pictureSecondsOf(probe: MatchedProbe): number | undefined {
  if (!probe.width || !probe.height) return undefined
  return probe.videoDurationSec ?? probe.durationSec
}

/**
 * The picture length of the extension at `path` (`pictureSecondsOf`), from a
 * probe that read the file: undefined when it has no picture. A probe that
 * FAILED (timed out, could not start, could not read the file) says nothing
 * about the extension's length, so it throws a plain error, retried like any
 * transient failure, and never the short-extension refusal: a timeout as it
 * is, any other failure in the stitch's words with its cause kept.
 */
export async function extensionPictureSeconds(path: string): Promise<number | undefined> {
  let probe: MatchedProbe
  try {
    probe = await probeMatchedOrThrow(path)
  } catch (err) {
    if ((err as { timedOut?: unknown }).timedOut === true) throw err
    throw new Error("Extend stitch: the extension's picture could not be read", { cause: err })
  }
  return pictureSecondsOf(probe)
}

/**
 * A conformed picture's frame count at the output rate: its length
 * (`pictureSecondsOf`) at that rate. A picture that reports no length fails
 * the stitch.
 */
function conformedFrames(probe: MatchedProbe, which: "source" | "extension", rate: StitchRate): number {
  const length = pictureSecondsOf(probe)
  if (!length) throw new Error(`Extend stitch: the ${which} reports no length`)
  return Math.round(length * rate.fps)
}

/**
 * Stitch the extension onto the source (local files) into `workDir`, as this
 * module's header and `extend-stitch-args.ts`' set out. Throws (the run fails
 * and is refunded) when either clip has no picture or no readable length, or
 * ffmpeg fails; a failed boundary search does not.
 *
 * Everything it writes (the proxies, the two-pass log, the result) goes into
 * `workDir` under fixed names, and it removes nothing: the caller gives each
 * stitch its own `workDir` and removes it once done, on success and failure.
 */
export async function stitchExtension(args: ExtendStitchArgs): Promise<ExtendStitchResult> {
  const { sourcePath, extensionPath, workDir } = args
  const [source, extension] = await Promise.all([probeMatched(sourcePath), probeMatched(extensionPath)])
  const extensionSize = pictureSize(extension, "extension")
  pictureSize(source, "source")
  // Both pictures are conformed to the source's nominal rate, counted at it.
  const rate = stitchRate(source)
  const sourceFrames = conformedFrames(source, "source", rate)
  const extensionFrames = conformedFrames(extension, "extension", rate)
  if (sourceFrames < 1 || extensionFrames < 1) throw new Error("Extend stitch: a clip has no picture to stitch")
  // The source as [0:v] arrives: upright (90°/270° swap the axes), at its SAR (Video Overlay's probe).
  let seen: VideoOverlayBaseProbe
  try {
    seen = await probeVideoOverlayBase(sourcePath)
  } catch (err) {
    throw new Error("Extend stitch: the source's picture could not be read", { cause: err })
  }
  const shape: PictureShape = { width: seen.width, height: seen.height, ...(seen.sarRatio ? { sarRatio: seen.sarRatio } : {}) }
  // What the result is encoded at: the source's size, rounded down to even.
  const delivered = deliveredShape(shape)

  const launch = { peakMemoryMiB: extendPeakMemoryMiB(delivered, [shape, extensionSize], isHdr(source)) }
  const layout: StitchLayout = { source, extension, rate, shape, sourceFrames, extensionFrames }
  const cut = await searchBoundary(args, layout, launch)
  const applied = boundaryOf(args.fallbackTrims, cut, { source: sourceFrames, extension: extensionFrames })
  // The new part's leading repeats, after the cut: the output frames that show them,
  // counted in its reported start trim.
  const repeats = await leadingRepeatsAfter(args, layout, applied, launch)
  const boundary = repeats ? { ...applied, trimStartFrames: applied.trimStartFrames + repeats.output.count } : applied
  const repeatsSaid = repeats
    ? `${repeats.output.count} of them leading repeats (its own frames ${repeats.native.from}–${repeats.native.from + repeats.native.count - 1})`
    : "none of them leading repeats"
  console.log(
    `[extendStitch] ${boundary.matched ? "smart cut" : "fixed trims"}: end-trim ${boundary.trimEndFrames}, start-trim ${boundary.trimStartFrames}` +
      `${args.dropLeadingRepeats ? ` (${repeatsSaid})` : ""}` +
      `${boundary.psnrDb !== null ? ` (PSNR ${boundary.psnrDb} dB)` : ""}, ${delivered.width}x${delivered.height}` +
      `${delivered === shape ? "" : ` (from ${shape.width}x${shape.height})`}${shape.sarRatio ? ` SAR ${shape.sarRatio}` : ""} @ ${rate.spelling}`,
  )

  const sourceHasAudio = Boolean(source.audioCodec)
  const sampleRate = sourceHasAudio ? await probeAudioSampleRate(sourcePath).catch(() => undefined) : undefined
  // Always an MP4: the delivery (`deliveryPicture`), whatever the source's container.
  const outputPath = join(workDir, "stitched.mp4")
  const encode: ExtendStitchEncode = {
    sourcePath,
    extensionPath,
    outputPath,
    source,
    picture: shape,
    sourceFrames,
    extensionFrames,
    trimEndFrames: applied.trimEndFrames,
    trimStartFrames: applied.trimStartFrames,
    ...(repeats ? { repeatFrames: repeats.output } : {}),
    audioFadeSec: args.audioFadeSec,
    sourceHasAudio,
    extensionHasAudio: Boolean(extension.audioCodec),
    soundOffsetSec: { source: soundOffsetOf(source), extension: soundOffsetOf(extension) },
    ...(sampleRate ? { audioSampleRate: sampleRate } : {}),
  }
  if (stitchEncodesAtBitRate(source)) {
    const log = join(workDir, "stitch-pass")
    await runFfmpeg(extendStitchArgs({ ...encode, pass: { n: 1, log } }), undefined, launch)
    await runFfmpeg(extendStitchArgs({ ...encode, pass: { n: 2, log } }), undefined, launch)
  } else {
    await runFfmpeg(extendStitchArgs(encode), undefined, launch)
  }
  return { outputPath, boundary }
}
