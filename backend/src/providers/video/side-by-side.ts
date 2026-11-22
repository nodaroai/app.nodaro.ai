// @reads-none renders two downloaded clips into its own work dir
/**
 * Side by side: a clip and a result made from it, in ONE video, each in its
 * own pane with a small label ("Original", "Remake"), the result's sound.
 * Video Remake's "Download side by side" renders it
 * (ee/lib/video-remake-side-by-side-job.ts).
 *
 * - The layout follows the result's shape, Video Remake's compare rule (the
 *   tools feed's `stageLayout`): a picture wider than square is STACKED, the
 *   original on top; a square or taller one sits SIDE BY SIDE, the original
 *   on the left (in every language: the panes are a picture, not a reading
 *   order).
 * - Each pane is the result's own size. The result is drawn as it is. The
 *   original is the stretch of the clip the result was made from (`startSec`,
 *   `lengthSec`), cut by frame number at the clip's own rate as the run cut it
 *   (from frame round(start × rate), round(length × rate) frames), put on the
 *   result's frame rate, delivered in SDR / limited range as the stitch
 *   delivers a source (`deliveredPictureFilter`: an HDR phone clip is
 *   tone-mapped, never shown washed out), and fitted INSIDE the pane (scaled
 *   down to fit, the rest black): a clip of another shape is never stretched
 *   or cropped.
 * - The length is the result's: its frame count, every frame of it. The
 *   original's last frame is held for as long as it comes up short (a result
 *   is often a frame or two longer than the clip it was made from), and a
 *   longer original is cut there.
 * - The sound is the result's first track, copied as it is when it is AAC,
 *   else encoded AAC; none when the result has none.
 * - The picture is encoded once at the result's quality (`matched-encode.ts`):
 *   H.264 at twice the result's picture bitrate (two panes of its size), in
 *   two passes, its pixel format and colour tags; the visually lossless
 *   constant quality when the result's bitrate cannot be read.
 */
import { join } from "node:path"
import { downloadFile, probeVideoFrameCount, runFfmpeg } from "./ffmpeg-utils.js"
import { matchedHasBitRate, matchedPictureArgs, probeMatchedOrThrow, type MatchedProbe } from "./matched-encode.js"
import { deliveredPictureFilter } from "./extend-stitch-args.js"
import { parseFrameRate } from "./frame-rate.js"
import { canvasPeakMemoryMiB, cameraMegapixelsOf } from "./ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"

/** How the two panes are set: stacked (the original on top) or side by side (the original on the left). */
export type SideBySideLayout = "stack" | "side"

/** The words on the panes. English: the file is one picture for every language. */
export const SIDE_BY_SIDE_LABELS = { original: "Original", result: "Remake" } as const

/** A picture wider than square stacks; a square or taller one sits side by side (Video Remake's compare rule). */
export function sideBySideLayout(shape: { readonly width: number; readonly height: number }): SideBySideLayout {
  return shape.width / shape.height > 1 ? "stack" : "side"
}

/** Down to even: 4:2:0 needs even sides. */
const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

/** Seconds as ffmpeg reads them, to the microsecond. */
const sec = (n: number): string => (Math.round(n * 1e6) / 1e6).toString()

/** The cut of the original, by frame number at its own rate (the run's `trimOp`). */
export function originalFrameSpan(startSec: number, lengthSec: number, fps: number): { startFrame: number; frames: number } {
  return { startFrame: Math.max(0, Math.round(startSec * fps)), frames: Math.max(1, Math.round(lengthSec * fps)) }
}

/** A label drawn in a pane's top start corner: small, white on a soft dark box, sized from the pane. */
export function labelFilter(text: string, pane: { readonly width: number; readonly height: number }): string {
  const short = Math.min(pane.width, pane.height)
  const size = Math.max(14, Math.round(short * 0.036))
  const pad = Math.max(4, Math.round(size * 0.45))
  const margin = Math.max(8, Math.round(short * 0.03))
  return `drawtext=text='${text}':fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${pad}:x=${margin + pad}:y=${margin + pad}`
}

/** What one side-by-side encode is built from (`sideBySideArgs`). */
export interface SideBySideEncode {
  readonly originalPath: string
  readonly resultPath: string
  readonly outputPath: string
  /** The original as probed. */
  readonly original: MatchedProbe
  /** The result as probed: its size, rate, sound and quality set the output's. */
  readonly result: MatchedProbe
  /** The result's frames: the output's. */
  readonly resultFrames: number
  /** Where the stretch the result was made from starts in the original, and how long it is. */
  readonly startSec: number
  readonly lengthSec: number
  /** One of the two passes, which share `log` (pass 1 measures the picture and writes nothing). */
  readonly pass?: { readonly n: 1 | 2; readonly log: string }
}

/** The pane: the result's size, rounded down to even. */
export function paneOf(result: MatchedProbe): { width: number; height: number } {
  return { width: even(result.width ?? 0), height: even(result.height ?? 0) }
}

/** The output's size for a pane and a layout. */
export function canvasOf(pane: { readonly width: number; readonly height: number }, layout: SideBySideLayout): { width: number; height: number } {
  return layout === "stack" ? { width: pane.width, height: pane.height * 2 } : { width: pane.width * 2, height: pane.height }
}

/** The result's picture bitrate twice over (two panes of its size); undefined when it is unread. */
const doubledBitRate = (result: MatchedProbe): number | undefined => (result.videoBitRate ? result.videoBitRate * 2 : undefined)

/** Whether the encode runs at a bitrate (two passes) rather than at the constant quality (one). */
export function sideBySideEncodesAtBitRate(result: MatchedProbe): boolean {
  return matchedHasBitRate(result, { targetBitRate: doubledBitRate(result) })
}

/**
 * The ffmpeg arguments of one side-by-side encode (pure). Pass 1 builds the
 * same picture graph and writes nothing; pass 2, or the single
 * constant-quality pass, writes `outputPath`.
 */
export function sideBySideArgs(p: SideBySideEncode): string[] {
  const pane = paneOf(p.result)
  const layout = sideBySideLayout(pane)
  const originalFps = parseFrameRate(p.original.nominalFpsRational ?? p.original.fpsRational)
  const resultRate = p.result.fpsRational ?? p.result.nominalFpsRational

  // The original: cut by frame number at its own rate (seeked to half a frame before its first frame, so that frame
  // is the first one kept), else by time; on the result's rate; as a delivery; fitted inside the pane; held on its
  // last frame for as long as the result runs.
  const span = originalFps !== undefined ? originalFrameSpan(p.startSec, p.lengthSec, originalFps) : null
  const seekSec = span && originalFps !== undefined ? Math.max(0, (span.startFrame - 0.5) / originalFps) : p.startSec
  const cut = span ? `trim=end_frame=${span.frames}` : `trim=duration=${sec(p.lengthSec)}`
  const delivered = deliveredPictureFilter(p.original)
  const originalChain = [
    cut,
    "setpts=PTS-STARTPTS",
    ...(delivered ? [delivered] : []),
    ...(resultRate ? [`fps=${resultRate}`] : []),
    `scale=${pane.width}:${pane.height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`,
    `pad=${pane.width}:${pane.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
    "tpad=stop_mode=clone:stop=-1",
    labelFilter(SIDE_BY_SIDE_LABELS.original, pane),
  ].join(",")
  const resultChain = [
    "setpts=PTS-STARTPTS",
    `crop=${pane.width}:${pane.height}:0:0`,
    "setsar=1",
    labelFilter(SIDE_BY_SIDE_LABELS.result, pane),
  ].join(",")
  const stack = layout === "stack" ? "vstack" : "hstack"
  const graph = `[0:v:0]${originalChain}[o];[1:v:0]${resultChain}[r];[o][r]${stack}=inputs=2:shortest=1[v]`

  const inputs = [
    "-y",
    ...(seekSec > 0 ? ["-ss", sec(seekSec)] : []),
    "-i", p.originalPath,
    "-i", p.resultPath,
  ]
  const encode = matchedPictureArgs(p.result, { targetBitRate: doubledBitRate(p.result), ...(p.pass ? { pass: p.pass } : {}) })
  const frames = ["-frames:v", String(p.resultFrames)]
  if (p.pass?.n === 1) return [...inputs, "-filter_complex", graph, "-map", "[v]", "-an", ...frames, ...encode, "-f", "null", "-"]
  const sound = p.result.audioCodec ? ["-map", "1:a:0", ...(p.result.audioCodec === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"])] : ["-an"]
  return [
    ...inputs,
    "-filter_complex", graph,
    "-map", "[v]",
    ...sound,
    ...frames,
    ...encode,
    // The sound is the result's, as long as its picture.
    "-t", sec(p.resultFrames / (parseFrameRate(resultRate) ?? 24)),
    "-movflags", "+faststart",
    p.outputPath,
  ]
}

/** What `composeSideBySide` made. */
export interface SideBySideOutput {
  readonly outputPath: string
  readonly layout: SideBySideLayout
  readonly width: number
  readonly height: number
  readonly frames: number
}

/**
 * Download the original and the result into `workDir` and render the side by
 * side there (`sideBySideArgs`). The caller owns `workDir` and removes it.
 * Throws when either file cannot be read as a video.
 */
export async function composeSideBySide(opts: {
  readonly originalUrl: string
  readonly resultUrl: string
  readonly startSec: number
  readonly lengthSec: number
  readonly workDir: string
}): Promise<SideBySideOutput> {
  const originalPath = join(opts.workDir, "original")
  const resultPath = join(opts.workDir, "result")
  await Promise.all([downloadFile(opts.originalUrl, originalPath), downloadFile(opts.resultUrl, resultPath)])
  const [original, result] = await Promise.all([probeMatchedOrThrow(originalPath), probeMatchedOrThrow(resultPath)])
  if (!original.width || !original.height) throw new Error("The original clip has no picture")
  if (!result.width || !result.height) throw new Error("The result has no picture")
  const resultFrames = await probeVideoFrameCount(resultPath)
  const pane = paneOf(result)
  const layout = sideBySideLayout(pane)
  const canvas = canvasOf(pane, layout)
  const outputPath = join(opts.workDir, "side-by-side.mp4")
  const encode: SideBySideEncode = {
    originalPath,
    resultPath,
    outputPath,
    original,
    result,
    resultFrames,
    startSec: opts.startSec,
    lengthSec: opts.lengthSec,
  }
  const launch = {
    peakMemoryMiB: canvasPeakMemoryMiB(canvas, 2, ffmpegEffectiveThreads(), {
      inputs: 2,
      cameraMegapixels: Math.max(cameraMegapixelsOf({ width: original.width, height: original.height }), cameraMegapixelsOf(pane)),
      toneMap: deliveredPictureFilter(original)?.includes("tonemap") ?? false,
    }),
  }
  if (sideBySideEncodesAtBitRate(result)) {
    const log = join(opts.workDir, "side-by-side-pass")
    await runFfmpeg(sideBySideArgs({ ...encode, pass: { n: 1, log } }), undefined, launch)
    await runFfmpeg(sideBySideArgs({ ...encode, pass: { n: 2, log } }), undefined, launch)
  } else {
    await runFfmpeg(sideBySideArgs(encode), undefined, launch)
  }
  return { outputPath, layout, width: canvas.width, height: canvas.height, frames: resultFrames }
}
