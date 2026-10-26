/**
 * Mask Erase — drop regions from a mask video by boxes over frame ranges
 * (decided 2026-10-26; the core half of a trend face mask's `"erased"` marks).
 *
 * The mask (white = covered) is decoded to gray frames, each thresholded at
 * 128 into a per-frame RLE in Video Mask's own form (one-based starts,
 * row-major), and every connected white region whose bounding-box CENTRE lies
 * inside a box, on a frame in that box's range, is dropped whole — Video
 * Mask's region labelling (`dropMaskRegionsWhere`) and the same centre test
 * its `zone` applies, the other way round. Never a paint of pixels: a kept
 * region is kept exactly. The result is drawn with `renderMaskVideo` on the
 * mask's own geometry and frame rate, one frame for every frame decoded
 * (checked), so it still lines up with the clip it was made for.
 */

import { join } from "node:path"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { constantFrameRate, downloadFile, ffmpegFailureMessage, parseFrameRate, probeVideoOverlayBase, withFfmpegSlot } from "./ffmpeg-utils.js"
import { spawnFfmpeg } from "./ffmpeg-process.js"
import {
  countVideoFrames,
  dropMaskRegionsWhere,
  maskGeometryPeakMemoryMiB,
  renderMaskVideo,
  videoMaskFfmpegTimeoutMs,
  type MaskGeometry,
  type MaskRegionBox,
} from "./video-mask.js"

/** One box of a mask erase: a frame range (0-based, inclusive) and the box's edges, % of the frame. */
export interface MaskEraseBoxInput {
  readonly fromFrame: number
  readonly toFrame: number
  readonly leftPct: number
  readonly topPct: number
  readonly rightPct: number
  readonly bottomPct: number
}

/** A box in pixels of a `width × height` frame (bounds inclusive) and the frames it holds on. */
export interface MaskEraseRect {
  readonly fromFrame: number
  readonly toFrame: number
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
}

/** Gray values at or above this are white (the mask's covered part). */
export const MASK_ERASE_THRESHOLD = 128

/** The boxes in pixels of a `width × height` frame. Pure. */
export function maskEraseRects(boxes: readonly MaskEraseBoxInput[], width: number, height: number): MaskEraseRect[] {
  return boxes.map((b) => ({
    fromFrame: b.fromFrame,
    toFrame: b.toFrame,
    x0: (width * b.leftPct) / 100,
    x1: (width * b.rightPct) / 100,
    y0: (height * b.topPct) / 100,
    y1: (height * b.bottomPct) / 100,
  }))
}

/**
 * Whether a region is erased on frame `frame`: its bounding-box centre (in
 * continuous coordinates, a pixel spanning [x, x + 1) — the zone filter's
 * reading) lies inside a box whose range holds the frame. Pure.
 */
export function regionErased(box: MaskRegionBox, frame: number, rects: readonly MaskEraseRect[]): boolean {
  const cx = (box.left + box.right) / 2
  const cy = (box.top + box.bottom + 1) / 2
  for (const r of rects) {
    if (frame < r.fromFrame || frame > r.toFrame) continue
    if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) return true
  }
  return false
}

/**
 * One gray frame (`width × height` bytes) as Video Mask's RLE: "start length"
 * pairs over the frame's pixels in row-major order, starts ONE-based
 * (`decodeMaskRle`), for every run at or above `threshold`. Pure.
 */
export function grayFrameToRle(frame: Uint8Array, threshold: number = MASK_ERASE_THRESHOLD): string {
  const parts: string[] = []
  let start = -1
  for (let i = 0, n = frame.length; i <= n; i++) {
    const white = i < n && frame[i]! >= threshold
    if (white && start < 0) start = i
    else if (!white && start >= 0) {
      parts.push(`${start + 1} ${i - start}`)
      start = -1
    }
  }
  return parts.join(" ")
}

/** How long a pass runs before it lets other work on the worker go (ms). */
const SLICE_MS = 8

/**
 * The erase over a whole mask's RLE, IN PLACE on `rle` (a frame that loses a
 * region is replaced; the others stay the same strings), yielding to the event
 * loop every few milliseconds. No box holding on a frame = that frame as it
 * is. `matched` / `kept`: whether any frame had white before / after;
 * `droppedRegions`: every region dropped, on every frame.
 */
export async function eraseMaskRegions(
  rle: string[],
  geometry: Pick<MaskGeometry, "width" | "height">,
  boxes: readonly MaskEraseBoxInput[],
): Promise<{ readonly rle: string[]; readonly droppedRegions: number; readonly matched: boolean; readonly kept: boolean }> {
  const { width, height } = geometry
  const rects = maskEraseRects(boxes, width, height)
  let droppedRegions = 0
  let matched = false
  let kept = false
  let sliceStart = performance.now()
  for (let f = 0; f < rle.length; f++) {
    const active = rects.filter((r) => f >= r.fromFrame && f <= r.toFrame)
    if (active.length === 0) {
      if (rle[f] !== "") {
        // A frame with no box: the RLE as it is (white when it has any run).
        matched = true
        kept = true
      }
    } else {
      const r = dropMaskRegionsWhere(rle[f]!, width, height, (box) => regionErased(box, f, active))
      if (r.covered > 0) matched = true
      if (r.dropped > 0) rle[f] = r.rle
      if (r.dropped === 0 ? r.covered > 0 : r.rle !== "") kept = true
      droppedRegions += r.dropped
    }
    if (performance.now() - sliceStart >= SLICE_MS) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      sliceStart = performance.now()
    }
  }
  return { rle, droppedRegions, matched, kept }
}

/** The decode's argv: the mask's first picture stream, every frame as it is, as raw gray bytes on stdout. Pure. */
export function buildMaskDecodeArgs(inputPath: string): string[] {
  return ["-hide_banner", "-nostats", "-v", "error", "-i", inputPath, "-map", "0:v:0", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]
}

/**
 * Decode a local mask video into its per-frame RLE, frame by frame as ffmpeg
 * writes it (never the whole raw video in memory: 30 s of 1080p is ~1.8 GB),
 * under a shared ffmpeg slot. Throws when the bytes do not end on a whole frame.
 */
export async function decodeMaskVideoRle(path: string, geometry: MaskGeometry): Promise<string[]> {
  const frameBytes = geometry.width * geometry.height
  const timeoutMs = videoMaskFfmpegTimeoutMs(geometry.durationSec)
  const frames: string[] = []
  await withFfmpegSlot(() => new Promise<void>((resolve, reject) => {
    const proc = spawnFfmpeg(buildMaskDecodeArgs(path), { stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    const frame = new Uint8Array(frameBytes)
    let filled = 0
    const watchdog = setTimeout(() => proc.kill("SIGKILL"), timeoutMs)
    proc.stdout.on("data", (chunk: Buffer) => {
      let at = 0
      while (at < chunk.length) {
        const take = Math.min(frameBytes - filled, chunk.length - at)
        frame.set(chunk.subarray(at, at + take), filled)
        filled += take
        at += take
        if (filled === frameBytes) {
          frames.push(grayFrameToRle(frame))
          filled = 0
        }
      }
    })
    proc.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-4_000) })
    proc.on("error", (err) => { clearTimeout(watchdog); reject(err) })
    proc.on("close", (code, signal) => {
      clearTimeout(watchdog)
      if (code !== 0) return reject(new Error(ffmpegFailureMessage(stderr, signal ? `mask decode killed (${signal}) after ${timeoutMs} ms` : `mask decode exited with code ${code}`)))
      if (filled !== 0) return reject(new DeterministicJobError(`The mask video's last frame is incomplete (${filled} of ${frameBytes} bytes)`))
      resolve()
    })
  }), { timeoutMs, label: "mask erase decode", peakMemoryMiB: maskGeometryPeakMemoryMiB(geometry) })
  return frames
}

export interface MaskEraseResult {
  readonly outputPath: string
  readonly width: number
  readonly height: number
  readonly frames: number
  /** The share of the picture the erased mask covers, 0–1 (exact). */
  readonly coveredFraction: number
  readonly droppedRegions: number
  /** Whether any region is left on any frame. */
  readonly kept: boolean
}

/**
 * Erase `boxes` from the mask at `maskUrl`: download it into `workDir`,
 * decode, drop, re-draw at its own geometry and rate, and check that the new
 * mask has exactly the frames decoded (and the container's count, when it
 * states one). An erase that leaves nothing draws an all-black mask
 * (`kept: false`) rather than failing.
 */
export async function eraseMaskVideo(maskUrl: string, boxes: readonly MaskEraseBoxInput[], workDir: string): Promise<MaskEraseResult> {
  const inputPath = join(workDir, "mask-in.mp4")
  await downloadFile(maskUrl, inputPath)
  const probe = await probeVideoOverlayBase(inputPath)
  if (probe.rotation !== 0 || (probe.sar > 0 && probe.sar !== 1)) {
    throw new DeterministicJobError("The mask video is rotated or has non-square pixels: it is not a mask this platform drew.")
  }
  const avg = parseFrameRate(probe.avgFrameRate)
  const nominal = parseFrameRate(probe.rFrameRate)
  const frameRate = constantFrameRate(avg, nominal) !== undefined && avg !== undefined ? probe.avgFrameRate! : probe.rFrameRate
  if (!frameRate || parseFrameRate(frameRate) === undefined) throw new DeterministicJobError("The mask video's frame rate could not be read.")
  const geometry: MaskGeometry = { width: probe.width, height: probe.height, frameRate, durationSec: probe.streamDurationSec }

  const rle = await decodeMaskVideoRle(inputPath, geometry)
  if (rle.length === 0) throw new DeterministicJobError("The mask video has no frames.")
  const stated = await countVideoFrames(inputPath)
  if (stated !== undefined && stated !== rle.length) {
    throw new DeterministicJobError(`The mask video decoded to ${rle.length} frames, but holds ${stated}.`)
  }
  const erased = await eraseMaskRegions(rle, geometry, boxes)
  const outputPath = join(workDir, "mask-erased.mp4")
  const { coveredFraction } = await renderMaskVideo(erased.rle, geometry, outputPath, { allowEmpty: true })
  const drawn = await countVideoFrames(outputPath)
  if (drawn !== undefined && drawn !== rle.length) {
    throw new Error(`The erased mask has ${drawn} frames, not the mask's ${rle.length}.`)
  }
  return {
    outputPath,
    width: geometry.width,
    height: geometry.height,
    frames: rle.length,
    coveredFraction,
    droppedRegions: erased.droppedRegions,
    kept: coveredFraction > 0,
  }
}
