/**
 * Video Mask — the local half of a SAM 3 run: get the clip into a geometry the
 * model and the mask agree on, then turn the model's per-frame RLE into a mask
 * VIDEO (white = the subject, black = everything else).
 *
 * Geometry: the RLE indexes the frames the model decoded. A rotated clip (phone
 * footage carrying a rotation tag), a non-square-pixel one, a variable frame
 * rate or one larger than `VIDEO_MASK_MAX_EDGE` is first re-encoded to a plain
 * upright, square-pixel, constant-rate mp4 — what any decoder reads the same
 * way — and THAT file is what the model sees and what the mask is drawn on. A
 * plain clip goes to the model as it is.
 */

import { join } from "node:path"
import { once } from "node:events"
import type { Writable } from "node:stream"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { constantFrameRate, downloadFile, parseFrameRate, probeVideoOverlayBase, runFfmpeg, runFfprobe, withFfmpegSlot, type VideoOverlayBaseProbe } from "./ffmpeg-utils.js"
import { spawnFfmpeg } from "./ffmpeg-process.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "./ffmpeg-timeouts.js"
import { cameraMegapixelsOf, canvasPeakMemoryMiB } from "./ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"

/** Longest edge the model is sent. Larger clips are scaled down (the mask is
 *  stretched back over the full-size foreground by Mask Composite). */
export const VIDEO_MASK_MAX_EDGE = 1920
/** Frame rate a variable-rate clip is normalised to. */
const NORMALISED_FPS = 30

/**
 * Frames per model request. A longer clip is cut into chunks of this many
 * frames, segmented separately and joined frame for frame. Measured
 * 2026-10-12 on 1,800 frames of 1080p: SAM 3.1 4.2 min, SAM 3 6.8 min, a
 * ~50 MB answer — inside the fal poll ceiling (30 min) and a worker's memory,
 * where a 5-minute clip in one request would be neither.
 */
export const VIDEO_MASK_CHUNK_FRAMES = 1800

/** A kill budget that grows with the clip: the default plus 4 s per second of footage. */
export function videoMaskFfmpegTimeoutMs(durationSec: number): number {
  return DEFAULT_FFMPEG_TIMEOUT_MS + Math.ceil(Math.max(0, durationSec)) * 4_000
}

/** One model request's share of the clip: frames [startFrame, startFrame + frames). */
export interface MaskChunk {
  readonly index: number
  readonly startFrame: number
  readonly frames: number
}

/** Cut `totalFrames` into model requests of at most `chunkFrames`. Pure. */
export function planMaskChunks(totalFrames: number, chunkFrames: number = VIDEO_MASK_CHUNK_FRAMES): MaskChunk[] {
  const total = Math.max(1, Math.round(totalFrames))
  const chunks: MaskChunk[] = []
  for (let start = 0, index = 0; start < total; start += chunkFrames, index++) {
    chunks.push({ index, startFrame: start, frames: Math.min(chunkFrames, total - start) })
  }
  return chunks
}

/**
 * The split's argv: ONE re-encode with a keyframe forced on every chunk
 * boundary, cut by the segment muxer at exactly those frames, so chunk i holds
 * frames [i·N, (i+1)·N) and their masks join back frame for frame. Same size,
 * same rate (the mask geometry is unchanged). Pure.
 */
export function buildSplitArgs(inputPath: string, outputPattern: string, chunks: readonly MaskChunk[]): string[] {
  const n = chunks.length > 1 ? chunks[1]!.startFrame : chunks[0]!.frames
  const boundaries = chunks.slice(1).map((c) => c.startFrame).join(",")
  return [
    "-y", "-i", inputPath, "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
    "-force_key_frames", `expr:eq(mod(n,${n}),0)`,
    "-f", "segment", "-segment_frames", boundaries, "-reset_timestamps", "1",
    outputPattern,
  ]
}

/** The frames the model segments and the mask is drawn on. */
export interface MaskGeometry {
  readonly width: number
  readonly height: number
  /** ffmpeg rational, e.g. "30000/1001". */
  readonly frameRate: string
  readonly durationSec: number
}

/**
 * The clip's constant frame rate as an ffmpeg rational, or undefined for a
 * variable-rate clip — by `constantFrameRate`, the SAME rule `probeVideoSource`
 * prices with, so a clip is never priced at one rate and segmented at another.
 */
export function constantRateOf(probe: Pick<VideoOverlayBaseProbe, "avgFrameRate" | "rFrameRate">): string | undefined {
  const avg = parseFrameRate(probe.avgFrameRate)
  const nominal = parseFrameRate(probe.rFrameRate)
  if (constantFrameRate(avg, nominal) === undefined) return undefined
  return avg !== undefined ? probe.avgFrameRate : probe.rFrameRate
}

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

/**
 * What a clip needs before the model sees it. `null` = send it as it is.
 * Pure: decided from the probe alone.
 */
export function planVideoMaskSource(probe: VideoOverlayBaseProbe): { readonly width: number; readonly height: number; readonly fps?: number } | null {
  const variable = constantRateOf(probe) === undefined
  const edge = Math.max(probe.width, probe.height)
  const odd = probe.width % 2 !== 0 || probe.height % 2 !== 0
  if (probe.rotation === 0 && probe.sar === 1 && !variable && edge <= VIDEO_MASK_MAX_EDGE && !odd) return null
  // Display size with square pixels, scaled to fit the edge cap.
  const displayW = probe.width * (probe.sar > 0 ? probe.sar : 1)
  const scale = Math.min(1, VIDEO_MASK_MAX_EDGE / Math.max(displayW, probe.height))
  return {
    width: even(displayW * scale),
    height: even(probe.height * scale),
    ...(variable ? { fps: NORMALISED_FPS } : {}),
  }
}

/**
 * The picture frames in a local file, counted from its packets (no decode):
 * the chunk plan must cut exactly where the frames are, and duration × rate
 * can be a frame or two off. Undefined when the count fails.
 */
export async function countVideoFrames(path: string): Promise<number | undefined> {
  try {
    const out = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path])
    const n = Number.parseInt(out.trim().split(/[\s,]+/)[0] ?? "", 10)
    return Number.isInteger(n) && n > 0 ? n : undefined
  } catch {
    return undefined
  }
}

/** The normalising re-encode's argv (ffmpeg autorotates the input). Pure. */
export function buildNormaliseArgs(inputPath: string, outputPath: string, plan: { width: number; height: number; fps?: number }): string[] {
  const vf = [`scale=${plan.width}:${plan.height}`, "setsar=1", ...(plan.fps ? [`fps=${plan.fps}`] : [])].join(",")
  return ["-y", "-i", inputPath, "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath]
}

export interface PreparedMaskSource {
  /** The file the model must be sent (a local path when re-encoded, else undefined: send the original URL). */
  readonly normalisedPath?: string
  /** The local copy of what the model sees — the re-encode, else the downloaded original (cut into chunks from here). */
  readonly localPath: string
  /** Picture frames in `localPath`, counted (undefined when the count failed — the duration estimate stands in). */
  readonly frameCount?: number
  readonly geometry: MaskGeometry
}

/** Download + probe the clip; re-encode it when `planVideoMaskSource` says so. */
export async function prepareVideoMaskSource(videoUrl: string, workDir: string): Promise<PreparedMaskSource> {
  const sourcePath = join(workDir, "source.mp4")
  await downloadFile(videoUrl, sourcePath)
  const probe = await probeVideoOverlayBase(sourcePath)
  const plan = planVideoMaskSource(probe)
  if (!plan) {
    return {
      localPath: sourcePath,
      frameCount: await countVideoFrames(sourcePath),
      geometry: { width: probe.width, height: probe.height, frameRate: constantRateOf(probe)!, durationSec: probe.streamDurationSec },
    }
  }
  const normalisedPath = join(workDir, "normalised.mp4")
  await runFfmpeg(buildNormaliseArgs(sourcePath, normalisedPath, plan), videoMaskFfmpegTimeoutMs(probe.streamDurationSec), {
    peakMemoryMiB: canvasPeakMemoryMiB({ width: Math.max(probe.width, plan.width), height: Math.max(probe.height, plan.height) }, 1, ffmpegEffectiveThreads(), {
      inputs: 1,
      cameraMegapixels: cameraMegapixelsOf(probe),
    }),
  })
  const after = await probeVideoOverlayBase(normalisedPath)
  return {
    normalisedPath,
    localPath: normalisedPath,
    frameCount: await countVideoFrames(normalisedPath),
    geometry: { width: after.width, height: after.height, frameRate: constantRateOf(after) ?? `${plan.fps ?? NORMALISED_FPS}/1`, durationSec: after.streamDurationSec },
  }
}

/**
 * Cut the prepared clip into the planned chunks (local files, in order). One
 * chunk = no cut: the caller sends the clip as it is.
 */
export async function splitMaskSource(localPath: string, workDir: string, geometry: MaskGeometry, chunks: readonly MaskChunk[]): Promise<string[]> {
  if (chunks.length <= 1) return [localPath]
  const pattern = join(workDir, "chunk-%03d.mp4")
  await runFfmpeg(buildSplitArgs(localPath, pattern, chunks), videoMaskFfmpegTimeoutMs(geometry.durationSec), {
    peakMemoryMiB: canvasPeakMemoryMiB(geometry, 1, ffmpegEffectiveThreads(), { inputs: 1, cameraMegapixels: cameraMegapixelsOf(geometry) }),
  })
  return chunks.map((c) => join(workDir, `chunk-${String(c.index).padStart(3, "0")}.mp4`))
}

/**
 * Decode one frame's RLE into `out` (width × height bytes, overwritten).
 * Each pair is (start, length) over the frame's pixels in row-major order,
 * with a ONE-BASED start: pixel index = start − 1. Measured 2026-10-12: with
 * that offset every run's first and last pixel land on the subject's edge in
 * the model's own masked video (834/834 runs, against 24 misses one pixel
 * off), and a mask touching the frame's last pixel ends at width·height + 1.
 * Throws when a run leaves the frame — the RLE was drawn on other geometry
 * than the one we hold, and drawing it anyway would produce a mask that
 * silently does not line up.
 */
export function decodeMaskRle(rle: string, out: Uint8Array): number {
  out.fill(0)
  if (rle.trim() === "") return 0
  const nums = rle.trim().split(/\s+/).map(Number)
  // Deterministic: the same answer decodes the same way on every retry (and each retry would pay the model again).
  if (nums.length % 2 !== 0) throw new DeterministicJobError("SAM 3 mask RLE has an odd number of values")
  let covered = 0
  for (let i = 0; i < nums.length; i += 2) {
    const start = nums[i]!
    const len = nums[i + 1]!
    const first = start - 1
    if (!Number.isInteger(start) || !Number.isInteger(len) || first < 0 || len < 0 || first + len > out.length) {
      throw new DeterministicJobError(`SAM 3 mask RLE run [${start}, ${len}] leaves the ${out.length}-pixel frame`)
    }
    out.fill(255, first, first + len)
    covered += len
  }
  return covered
}

/** The mask encode's argv: raw gray frames on stdin → near-lossless h264. Pure. */
export function buildMaskEncodeArgs(geometry: MaskGeometry, outputPath: string): string[] {
  return [
    "-y",
    "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${geometry.width}x${geometry.height}`, "-framerate", geometry.frameRate,
    "-i", "pipe:0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ]
}

async function writeFrame(stdin: Writable, frame: Uint8Array): Promise<void> {
  if (!stdin.write(Buffer.from(frame))) await once(stdin, "drain")
}

/**
 * Draw the per-frame RLE as a mask video at `geometry`. Refuses a run where
 * nothing matched on any frame (a verdict about the prompt — the job fails and
 * refunds rather than delivering an all-black mask).
 */
export async function renderMaskVideo(rle: readonly string[], geometry: MaskGeometry, outputPath: string): Promise<{ readonly coveredFraction: number }> {
  const pixels = geometry.width * geometry.height
  const frame = new Uint8Array(pixels)
  // Validate every frame BEFORE spawning: a geometry mismatch or an empty
  // result never costs an encode.
  let covered = 0
  for (const r of rle) covered += decodeMaskRle(r, frame)
  if (covered === 0) {
    throw new DeterministicJobError(
      "No region matched the mask prompt on any frame. Try a shorter, plainer subject phrase (\"the dog\", \"the red car\") or a lower threshold.",
    )
  }
  const argv = buildMaskEncodeArgs(geometry, outputPath)
  // 10 min plus 60 ms a frame: a 5-minute 1080p mask (9,000 frames) gets 19 min.
  const timeoutMs = DEFAULT_FFMPEG_TIMEOUT_MS + rle.length * 60
  await withFfmpegSlot(() => new Promise<void>((resolve, reject) => {
    const proc = spawnFfmpeg(argv, { stdio: ["pipe", "ignore", "pipe"] })
    let stderr = ""
    proc.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-4000) })
    const watchdog = setTimeout(() => proc.kill("SIGKILL"), timeoutMs)
    proc.on("error", (err) => { clearTimeout(watchdog); reject(err) })
    proc.on("close", (code) => {
      clearTimeout(watchdog)
      if (code === 0) resolve()
      else reject(new Error(`mask encode exited with code ${code}: ${stderr.trim().split("\n").pop() ?? ""}`))
    })
    const stdin = proc.stdin
    stdin.on("error", () => { /* surfaced by close */ })
    void (async () => {
      try {
        for (const r of rle) {
          decodeMaskRle(r, frame)
          await writeFrame(stdin, frame)
        }
      } finally {
        stdin.end()
      }
    })().catch(() => proc.kill("SIGKILL"))
  }), {
    timeoutMs,
    label: "video mask encode",
    peakMemoryMiB: canvasPeakMemoryMiB(geometry, 1, ffmpegEffectiveThreads(), { inputs: 1, cameraMegapixels: cameraMegapixelsOf(geometry) }),
  })
  return { coveredFraction: covered / (pixels * rle.length) }
}
