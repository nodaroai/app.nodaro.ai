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
import { constantFrameRate, downloadFile, parseFrameRate, probeVideoOverlayBase, runFfmpeg, withFfmpegSlot, type VideoOverlayBaseProbe } from "./ffmpeg-utils.js"
import { spawnFfmpeg } from "./ffmpeg-process.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "./ffmpeg-timeouts.js"
import { canvasPeakMemoryMiB } from "./ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"

/** Longest edge the model is sent. Larger clips are scaled down (the mask is
 *  stretched back over the full-size foreground by Mask Composite). */
export const VIDEO_MASK_MAX_EDGE = 1920
/** Frame rate a variable-rate clip is normalised to. */
const NORMALISED_FPS = 30

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

/** The normalising re-encode's argv (ffmpeg autorotates the input). Pure. */
export function buildNormaliseArgs(inputPath: string, outputPath: string, plan: { width: number; height: number; fps?: number }): string[] {
  const vf = [`scale=${plan.width}:${plan.height}`, "setsar=1", ...(plan.fps ? [`fps=${plan.fps}`] : [])].join(",")
  return ["-y", "-i", inputPath, "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath]
}

export interface PreparedMaskSource {
  /** The file the model must be sent (a local path when re-encoded, else undefined: send the original URL). */
  readonly normalisedPath?: string
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
      geometry: { width: probe.width, height: probe.height, frameRate: constantRateOf(probe)!, durationSec: probe.streamDurationSec },
    }
  }
  const normalisedPath = join(workDir, "normalised.mp4")
  await runFfmpeg(buildNormaliseArgs(sourcePath, normalisedPath, plan), DEFAULT_FFMPEG_TIMEOUT_MS, {
    peakMemoryMiB: canvasPeakMemoryMiB({ width: Math.max(probe.width, plan.width), height: Math.max(probe.height, plan.height) }, 1, ffmpegEffectiveThreads()),
  })
  const after = await probeVideoOverlayBase(normalisedPath)
  return {
    normalisedPath,
    geometry: { width: after.width, height: after.height, frameRate: constantRateOf(after) ?? `${plan.fps ?? NORMALISED_FPS}/1`, durationSec: after.streamDurationSec },
  }
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
  await withFfmpegSlot(() => new Promise<void>((resolve, reject) => {
    const proc = spawnFfmpeg(argv, { stdio: ["pipe", "ignore", "pipe"] })
    let stderr = ""
    proc.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-4000) })
    const watchdog = setTimeout(() => proc.kill("SIGKILL"), DEFAULT_FFMPEG_TIMEOUT_MS)
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
    timeoutMs: DEFAULT_FFMPEG_TIMEOUT_MS,
    label: "video mask encode",
    peakMemoryMiB: canvasPeakMemoryMiB(geometry, 1, ffmpegEffectiveThreads()),
  })
  return { coveredFraction: covered / (pixels * rle.length) }
}
