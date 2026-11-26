/**
 * The face grow over a whole mask video (Mask Composite's internal
 * `faceGrowPct`, mask-face-grow.ts): the mask (white = a face) decoded to
 * Video Mask's per-frame RLE, the clip decoded beside it frame for frame AT
 * THE MASK'S GEOMETRY — scaled to its size, and on a variable-rate clip
 * re-timed exactly as Video Mask normalised it (`planVideoMaskSource`), so
 * frame i of the clip is the frame mask i was found on — each frame grown,
 * and the result drawn back with `renderMaskVideo` on the mask's own size and
 * rate, one frame for every mask frame. A mask frame the clip has no frame
 * for (a clip a frame short) is kept as it is: the frame count never moves.
 * The composite then reads the grown mask exactly as it read the mask.
 */
import { FfmpegDiagnostics, spawnExit } from "./ffmpeg-failure-detail.js"
import { join } from "node:path"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { constantFrameRate, ffmpegFailureError, parseFrameRate, probeVideoOverlayBase, withFfmpegSlot } from "./ffmpeg-utils.js"
import { spawnFfmpeg } from "./ffmpeg-process.js"
import { canvasPeakMemoryMiB, cameraMegapixelsOf } from "./ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"
import { countVideoFrames, planVideoMaskSource, renderMaskVideo, videoMaskFfmpegTimeoutMs, type MaskGeometry } from "./video-mask.js"
import { decodeMaskVideoRle } from "./mask-erase.js"
import { combineFaceGrowFrames, growFaceMaskFrameParts, type FaceGrowFrameParts } from "./mask-face-grow.js"

/** What the grow did, answered in the composite's `output_data.faceGrow`. */
export interface FaceGrowStats {
  /** The grow asked for, % of each face's height. */
  readonly growPct: number
  /** The mask's frames, and those the grow widened. */
  readonly frames: number
  readonly grownFrames: number
  /** The grown mask's covered pixels over the mask's, on every frame (1 = nothing added). */
  readonly areaRatio: number
}

/**
 * The clip decode's argv: its first picture stream at the mask's size, raw
 * RGB on stdout, one frame per mask frame at most. `fps` only when Video Mask
 * re-timed the clip (a variable rate); else every frame as it is. Pure.
 */
export function buildFaceGrowClipDecodeArgs(clipPath: string, geometry: Pick<MaskGeometry, "width" | "height">, frames: number, fps?: number): string[] {
  const vf = [`scale=${geometry.width}:${geometry.height}`, "setsar=1", ...(fps ? [`fps=${fps}`] : [])].join(",")
  return [
    "-hide_banner", "-nostats", "-v", "error",
    "-i", clipPath,
    "-map", "0:v:0",
    "-vf", vf,
    ...(fps ? [] : ["-fps_mode", "passthrough"]),
    "-frames:v", String(frames),
    "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ]
}

/**
 * The grow's own work per mask pixel, ms (decided 2026-11-23 from a measured worst case, with room): added to the
 * decode's kill budget so a long, large mask is never killed for the work done between its frames.
 */
export const FACE_GROW_MS_PER_MEGAPIXEL = 60

/** The grow pass's kill budget: the decode's own, plus the grow's work on every pixel of every mask frame. */
export function faceGrowTimeoutMs(durationSec: number, frames: number, width: number, height: number): number {
  return videoMaskFfmpegTimeoutMs(durationSec) + Math.ceil((frames * width * height * FACE_GROW_MS_PER_MEGAPIXEL) / 1_000_000)
}

/** The mask's geometry as its own probe reads it (Mask Erase's rule: a constant rate, else the nominal). */
async function maskGeometryOf(maskPath: string): Promise<MaskGeometry> {
  const probe = await probeVideoOverlayBase(maskPath)
  if (probe.rotation !== 0 || (probe.sar > 0 && probe.sar !== 1)) {
    throw new DeterministicJobError("The mask video is rotated or has non-square pixels: it is not a mask this platform drew.")
  }
  const avg = parseFrameRate(probe.avgFrameRate)
  const nominal = parseFrameRate(probe.rFrameRate)
  const frameRate = constantFrameRate(avg, nominal) !== undefined && avg !== undefined ? probe.avgFrameRate! : probe.rFrameRate
  if (!frameRate || parseFrameRate(frameRate) === undefined) throw new DeterministicJobError("The mask video's frame rate could not be read.")
  return { width: probe.width, height: probe.height, frameRate, durationSec: probe.streamDurationSec }
}

/**
 * Grow the face mask at `maskPath` by `growPct` % of each face's height, the
 * colours read from the clip at `clipPath` (the video the composite keeps
 * outside the mask: the clip the mask was made from). Writes the grown mask
 * into `workDir` and answers its path and what was grown.
 */
export async function growFaceMaskVideo(args: {
  readonly maskPath: string
  readonly clipPath: string
  readonly workDir: string
  readonly growPct: number
}): Promise<{ readonly outputPath: string; readonly stats: FaceGrowStats }> {
  const geometry = await maskGeometryOf(args.maskPath)
  const rle = await decodeMaskVideoRle(args.maskPath, geometry)
  if (rle.length === 0) throw new DeterministicJobError("The mask video has no frames.")
  const clip = await probeVideoOverlayBase(args.clipPath)
  const plan = planVideoMaskSource(clip)
  const frameBytes = geometry.width * geometry.height * 3
  const timeoutMs = faceGrowTimeoutMs(Math.max(geometry.durationSec, clip.streamDurationSec), rle.length, geometry.width, geometry.height)
  const grown = rle.slice()
  let before = 0
  let after = 0
  let grownFrames = 0
  /** Frames read so far; the last two read are held (`held[0]` the earlier) until the next one smooths them. */
  let read = 0
  const held: FaceGrowFrameParts[] = []
  let prev: FaceGrowFrameParts | null = null
  const settle = (index: number, before0: FaceGrowFrameParts | null, cur: FaceGrowFrameParts, next: FaceGrowFrameParts | null) => {
    const r = combineFaceGrowFrames(before0, cur, next)
    grown[index] = r.rle
    before += r.before
    after += r.after
    if (r.after > r.before) grownFrames++
  }
  await withFfmpegSlot(() => new Promise<void>((resolve, reject) => {
    const proc = spawnFfmpeg(buildFaceGrowClipDecodeArgs(args.clipPath, geometry, rle.length, plan?.fps), { stdio: ["ignore", "pipe", "pipe"] })
    const stderr = FfmpegDiagnostics.capture(proc.stderr, 4_000)
    let failed: unknown = null
    const frame = new Uint8Array(frameBytes)
    let filled = 0
    let timedOut = false
    const watchdog = setTimeout(() => { timedOut = true; proc.kill("SIGKILL") }, timeoutMs)
    proc.stdout.on("data", (chunk: Buffer) => {
      let at = 0
      while (at < chunk.length && failed === null) {
        const take = Math.min(frameBytes - filled, chunk.length - at)
        frame.set(chunk.subarray(at, at + take), filled)
        filled += take
        at += take
        if (filled < frameBytes) continue
        filled = 0
        if (read >= rle.length) continue
        try {
          held.push(growFaceMaskFrameParts(rle[read]!, frame, geometry.width, geometry.height, args.growPct))
          read++
          // The frame before this one has both its neighbours now: smoothed and settled.
          if (held.length === 2) {
            settle(read - 2, prev, held[0]!, held[1]!)
            prev = held.shift()!
          }
        } catch (err) {
          failed = err
          proc.kill("SIGKILL")
        }
      }
      // One frame's work at a time: other jobs on this worker (and its lock renewals) run between frames.
      if (failed === null) {
        proc.stdout.pause()
        setImmediate(() => proc.stdout.resume())
      }
    })
    proc.on("error", (err) => { clearTimeout(watchdog); reject(err) })
    proc.on("close", (code, signal) => {
      clearTimeout(watchdog)
      if (failed !== null) return reject(failed)
      if (code !== 0) return reject(ffmpegFailureError(stderr, signal ? `face grow clip decode killed (${signal}) after ${timeoutMs} ms` : `face grow clip decode exited with code ${code}`, spawnExit(code, signal, timedOut)))
      resolve()
    })
  }), {
    timeoutMs,
    label: "mask composite face grow",
    // The clip decoded at its own size and scaled to the mask's.
    peakMemoryMiB: canvasPeakMemoryMiB(
      { width: Math.max(clip.width, geometry.width), height: Math.max(clip.height, geometry.height) },
      1,
      ffmpegEffectiveThreads(),
      { inputs: 1, cameraMegapixels: cameraMegapixelsOf(clip) },
    ),
  })
  // The last frame read has no next neighbour.
  if (held.length === 1) settle(read - 1, prev, held[0]!, null)
  // The mask frames the clip had no frame for are kept as they are (counted as not grown).
  for (let i = read; i < rle.length; i++) {
    const n = growFaceMaskFrameParts(rle[i]!, new Uint8Array(0), geometry.width, geometry.height, 0).before
    before += n
    after += n
  }
  const outputPath = join(args.workDir, "mask-grown.mp4")
  await renderMaskVideo(grown, geometry, outputPath, { allowEmpty: true })
  const drawn = await countVideoFrames(outputPath)
  if (drawn !== undefined && drawn !== rle.length) throw new Error(`The grown mask has ${drawn} frames, not the mask's ${rle.length}.`)
  return {
    outputPath,
    stats: {
      growPct: args.growPct,
      frames: rle.length,
      grownFrames,
      areaRatio: before > 0 ? Number((after / before).toFixed(4)) : 1,
    },
  }
}
