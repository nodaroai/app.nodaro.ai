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
import { VIDEO_MASK_LIMITS, resolveVideoMaskZone, type VideoMaskZone } from "@nodaro/shared/media"
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

/**
 * The predicted peak memory of an ffmpeg launch that decodes or encodes ONE
 * picture at the mask's geometry — the chunk split, the cut scan (`perShot`)
 * and the mask encode.
 */
export function maskGeometryPeakMemoryMiB(geometry: Pick<MaskGeometry, "width" | "height">): number {
  return canvasPeakMemoryMiB(geometry, 1, ffmpegEffectiveThreads(), { inputs: 1, cameraMegapixels: cameraMegapixelsOf(geometry) })
}

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

/**
 * The cut frames a plan of `totalFrames` can use: whole frames strictly
 * inside the clip (0 starts the first shot already), sorted, each once. Pure.
 */
export function validCutFrames(totalFrames: number, cutFrames: readonly number[]): number[] {
  const total = Math.max(1, Math.round(totalFrames))
  return [...new Set(cutFrames.filter((f) => Number.isInteger(f) && f > 0 && f < total))].sort((a, b) => a - b)
}

/**
 * The shortest shot `perShot` segments on its own (frames). A shorter piece
 * — a quick insert, a cut a few frames from the end — joins its neighbour:
 * a request of a frame or two is all overhead, and the frame-count check's
 * tolerance (±3) would cover its whole answer.
 */
export const VIDEO_MASK_MIN_SHOT_FRAMES = 8

/**
 * The cuts a `perShot` plan uses: `validCutFrames`, then no shot shorter
 * than `minShotFrames`. Walking forward, a cut is kept only when it is at
 * least `minShotFrames` after the last kept start (frame 0 first) — so of
 * two close cuts the EARLIER is kept and the short piece after it joins the
 * shot before the later one; then a kept cut leaving a last shot shorter
 * than that is dropped (the piece joins the shot before it). Pure.
 */
export function shotCutFrames(totalFrames: number, cutFrames: readonly number[], minShotFrames: number = VIDEO_MASK_MIN_SHOT_FRAMES): number[] {
  const total = Math.max(1, Math.round(totalFrames))
  const kept: number[] = []
  let lastStart = 0
  for (const cut of validCutFrames(total, cutFrames)) {
    if (cut - lastStart < minShotFrames) continue
    kept.push(cut)
    lastStart = cut
  }
  while (kept.length > 0 && total - kept[kept.length - 1]! < minShotFrames) kept.pop()
  return kept
}

/**
 * One chunk's masks fitted to exactly `frames` (`perShot`): a short answer
 * repeats its last frame (nothing at all: empty frames), a long one loses
 * its tail — so a count the tolerance let through can never move the next
 * shot's masks off its cut. The same array when it already fits. Pure.
 */
export function fitMaskFrames(rle: readonly string[], frames: number): readonly string[] {
  if (rle.length === frames) return rle
  if (rle.length > frames) return rle.slice(0, frames)
  const pad = rle.length > 0 ? rle[rle.length - 1]! : ""
  return [...rle, ...Array<string>(frames - rle.length).fill(pad)]
}

/**
 * Cut `totalFrames` into model requests of at most `chunkFrames`. With
 * `cutFrames` (`perShot`: the frames where a new shot starts), every cut
 * starts a chunk, and a shot longer than `chunkFrames` is cut every
 * `chunkFrames` from ITS start — so no chunk spans a cut and the model starts
 * afresh on every shot. No cuts = the plain grid.
 *
 * `minTailFrames` (`redetectEverySec`, whose short grid leaves a remainder in
 * almost every shot): a shot's last piece shorter than this joins the chunk
 * before it in the same shot, as long as that chunk stays within
 * `VIDEO_MASK_CHUNK_FRAMES` — so the chunk can run to `chunkFrames +
 * minTailFrames − 1`. 0 (the default) = no merging: a 1,800-frame grid keeps
 * its plan exactly as before re-detection existed. Pure.
 */
export function planMaskChunks(
  totalFrames: number,
  chunkFrames: number = VIDEO_MASK_CHUNK_FRAMES,
  cutFrames: readonly number[] = [],
  minTailFrames: number = 0,
): MaskChunk[] {
  const total = Math.max(1, Math.round(totalFrames))
  const shotStarts = [0, ...validCutFrames(total, cutFrames)]
  const chunks: MaskChunk[] = []
  for (const [s, shotStart] of shotStarts.entries()) {
    const shotEnd = shotStarts[s + 1] ?? total
    const first = chunks.length
    for (let start = shotStart; start < shotEnd; start += chunkFrames) {
      const frames = Math.min(chunkFrames, shotEnd - start)
      const prev = chunks[chunks.length - 1]
      if (frames < minTailFrames && prev && chunks.length > first && prev.frames + frames <= VIDEO_MASK_CHUNK_FRAMES) {
        chunks[chunks.length - 1] = { ...prev, frames: prev.frames + frames }
        continue
      }
      chunks.push({ index: chunks.length, startFrame: start, frames })
    }
  }
  return chunks
}

/**
 * The chunk length `redetectEverySec` asks for at `frameRate` (an ffmpeg
 * rational): `sec` seconds of frames, never fewer than
 * `VIDEO_MASK_MIN_SHOT_FRAMES` nor more than `VIDEO_MASK_CHUNK_FRAMES` (a
 * request's cap); an unreadable rate counts as `FPS_BASIS`. 0 or less = off:
 * the plain `VIDEO_MASK_CHUNK_FRAMES`. Pure.
 */
export function redetectChunkFrames(frameRate: string, sec: number): number {
  if (!(sec > 0)) return VIDEO_MASK_CHUNK_FRAMES
  const fps = parseFrameRate(frameRate) ?? VIDEO_MASK_LIMITS.FPS_BASIS
  return Math.min(VIDEO_MASK_CHUNK_FRAMES, Math.max(VIDEO_MASK_MIN_SHOT_FRAMES, Math.round(fps * sec)))
}

/**
 * The split's argv: ONE re-encode with a keyframe forced on every chunk
 * boundary, cut by the segment muxer at exactly those frames (it cuts only on
 * a keyframe), so each chunk holds exactly its planned frames and their masks
 * join back frame for frame. An even grid (chunk i = frames [i·N, (i+1)·N))
 * forces every N-th frame; uneven boundaries (`perShot` cuts) are forced one
 * by one. Same size, same rate (the mask geometry is unchanged), no frame
 * added or dropped (`-fps_mode passthrough`). Pure.
 */
export function buildSplitArgs(inputPath: string, outputPattern: string, chunks: readonly MaskChunk[]): string[] {
  const n = chunks.length > 1 ? chunks[1]!.startFrame : chunks[0]!.frames
  const starts = chunks.slice(1).map((c) => c.startFrame)
  const evenGrid = starts.every((start, i) => start === (i + 1) * n)
  const keyframes = evenGrid ? `expr:eq(mod(n,${n}),0)` : `expr:${starts.map((start) => `eq(n,${start})`).join("+")}`
  return [
    "-y", "-i", inputPath, "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
    // Frame for frame: the segment muxer would otherwise pad a picture that starts after the sound
    // (0.041 s into a trimmed 23.976 fps clip) with a copy of its first frame, and every cut — counted
    // in frames — would land one frame early, opening a shot's chunk on the shot before it.
    "-fps_mode", "passthrough",
    "-force_key_frames", keyframes,
    "-f", "segment", "-segment_frames", starts.join(","), "-reset_timestamps", "1",
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
    peakMemoryMiB: maskGeometryPeakMemoryMiB(geometry),
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

/**
 * The pixels one frame's RLE covers — the run lengths summed, read straight
 * off the string (no split, no array: nothing is allocated). A malformed RLE
 * is left to `decodeMaskRle`, which refuses it when the frame is drawn (here
 * it counts what it can read).
 */
export function maskRleCoveredPixels(rle: string): number {
  let covered = 0
  let value = -1
  let index = 0
  for (let i = 0, len = rle.length; i <= len; i++) {
    const c = i < len ? rle.charCodeAt(i) : 32
    if (c >= 48 && c <= 57) {
      value = (value < 0 ? 0 : value * 10) + (c - 48)
    } else if (value >= 0) {
      // Every second number is a run length.
      if (index % 2 === 1) covered += value
      index++
      value = -1
    }
  }
  return covered
}

/** How long a whole-mask pass runs before it lets other work on the worker go (ms). */
const MASK_PASS_SLICE_MS = 8

/** Give the event loop a turn when the current slice has run its time; returns the new slice start. */
async function yieldIfDue(sliceStart: number): Promise<number> {
  if (performance.now() - sliceStart < MASK_PASS_SLICE_MS) return sliceStart
  await new Promise<void>((resolve) => setImmediate(resolve))
  return performance.now()
}

/**
 * The most frames `holdLastMaskFrames` holds a mask over at `frameRate` (an
 * ffmpeg rational): `VIDEO_MASK_LIMITS.HOLD_MAX_SEC` of them, at least one;
 * an unreadable rate counts as `FPS_BASIS`. Pure.
 */
export function holdMaxFrames(frameRate: string): number {
  const fps = parseFrameRate(frameRate) ?? VIDEO_MASK_LIMITS.FPS_BASIS
  return Math.max(1, Math.round(fps * VIDEO_MASK_LIMITS.HOLD_MAX_SEC))
}

/**
 * Hold the last mask where the subject is lost (`holdLastMask`). A frame whose
 * mask covers less than `VIDEO_MASK_LIMITS.HOLD_EMPTY_BELOW_FRACTION` of the
 * picture (0.002 %) is empty; every empty frame AFTER the first non-empty one
 * takes the most recent non-empty frame's mask. Empty frames before the first
 * detection stay empty. Same frame count, so the mask keeps its frame rate,
 * length and size; it is drawn and encoded exactly as the model's would be
 * (`renderMaskVideo`).
 *
 * In place on the caller's array (a held frame points at the same string as
 * the frame it repeats — nothing is copied), counting each frame's pixels
 * without allocating, and yielding to the event loop every few milliseconds
 * so the other jobs on the worker keep running.
 *
 * Why: a subject hidden for a moment (a hand in front of a face) leaves the
 * model's mask empty for those frames, and a mask used to hide the subject
 * would uncover it exactly then.
 *
 * `shotStarts` (`perShot`: the frames where a new shot starts): the hold
 * starts afresh at each, so a shot's empty frames are never drawn from the
 * shot before the cut — a held mask would sit on a picture it was not drawn
 * for. None = one shot.
 *
 * `maxHoldFrames` (`VIDEO_MASK_LIMITS.HOLD_MAX_SEC` at the clip's rate): a
 * run of empty frames is held for at most this many, the rest stay empty
 * until the next non-empty frame. A missed cut, or a subject that has left,
 * would otherwise leave the mask where the subject no longer is for as long
 * as the shot lasts. None = no limit.
 */
export async function holdLastMaskFrames(
  rle: string[],
  pixels: number,
  shotStarts: readonly number[] = [],
  maxHoldFrames: number = Number.POSITIVE_INFINITY,
): Promise<{ readonly rle: string[]; readonly heldFrames: number }> {
  const emptyBelow = pixels * VIDEO_MASK_LIMITS.HOLD_EMPTY_BELOW_FRACTION
  const starts = [...shotStarts].sort((a, b) => a - b)
  let nextStart = 0
  let last: string | undefined
  let run = 0
  let heldFrames = 0
  let sliceStart = performance.now()
  for (let f = 0; f < rle.length; f++) {
    // A new shot: nothing is held across the cut.
    while (nextStart < starts.length && starts[nextStart]! <= f) {
      if (starts[nextStart] === f) last = undefined
      nextStart++
    }
    const covered = maskRleCoveredPixels(rle[f]!)
    if (covered > 0 && covered >= emptyBelow) {
      last = rle[f]
      run = 0
    } else if (last !== undefined && run < maxHoldFrames) {
      rle[f] = last
      run++
      heldFrames++
    }
    sliceStart = await yieldIfDue(sliceStart)
  }
  return { rle, heldFrames }
}

/**
 * Working buffers for the region filters (size, zone), reused frame after
 * frame (grown when a frame needs more): one frame's runs, its row-runs, their
 * regions and each region's bounding box. Nothing per frame is allocated
 * except the replacement string of a frame that loses a region.
 */
const filterScratch: {
  nums: Int32Array; row: Int32Array; x0: Int32Array; x1: Int32Array
  parent: Int32Array; top: Int32Array; bottom: Int32Array; left: Int32Array; right: Int32Array; drop: Uint8Array
} = {
  nums: new Int32Array(1024),
  row: new Int32Array(1024),
  x0: new Int32Array(1024),
  x1: new Int32Array(1024),
  parent: new Int32Array(1024),
  top: new Int32Array(1024),
  bottom: new Int32Array(1024),
  left: new Int32Array(1024),
  right: new Int32Array(1024),
  drop: new Uint8Array(1024),
}

function growScratch(key: Exclude<keyof typeof filterScratch, "drop">, need: number): Int32Array {
  let buf = filterScratch[key]
  if (buf.length < need) {
    const next = new Int32Array(Math.max(need, buf.length * 2))
    next.set(buf)
    filterScratch[key] = next
    buf = next
  }
  return buf
}

/**
 * Label one frame's connected white regions, on the runs themselves, at the
 * frame's full resolution and without drawing the frame: each run is cut at
 * the row ends, the row-runs of a row are merged where they touch or overlap
 * (so overlapping or out-of-order input is handled), and a row-run joins the
 * ones it touches in the row above, diagonals included (8-connectivity).
 *
 * Returns `m` = the merged row-runs (0: nothing to filter) and `covered` = the
 * frame's white pixels as sent. On return, in `filterScratch`: `row` / `x0` /
 * `x1` hold the `m` row-runs (sorted, x1 exclusive), `parent[i]` is row-run
 * `i`'s region (a root index), and for each root `r`, `top[r]` / `bottom[r]`
 * (rows, inclusive) and `left[r]` / `right[r]` (columns, right exclusive) are
 * its bounding box (`bottom` < 0 for a non-root). Throws like
 * `decodeMaskRle` for a run that leaves the frame. Shared by every region
 * filter, so one labelling pass serves them all.
 */
function labelMaskRegions(rle: string, width: number, height: number): { readonly m: number; readonly covered: number } {
  const pixels = width * height
  // 1. The run pairs, parsed in place (no split / map).
  let nums = filterScratch.nums
  let n = 0
  let value = -1
  for (let i = 0, len = rle.length; i <= len; i++) {
    const c = i < len ? rle.charCodeAt(i) : 32
    if (c >= 48 && c <= 57) {
      value = (value < 0 ? 0 : value * 10) + (c - 48)
      if (value > 0x7fffffff) throw new DeterministicJobError("SAM 3 mask RLE has a value out of range")
    } else if (c === 32 || c === 9 || c === 10 || c === 13) {
      if (value >= 0) {
        if (n >= nums.length) nums = growScratch("nums", n + 1)
        nums[n++] = value
        value = -1
      }
    } else {
      throw new DeterministicJobError("SAM 3 mask RLE has a value that is not a whole number")
    }
  }
  if (n === 0) return { m: 0, covered: 0 }
  if (n % 2 !== 0) throw new DeterministicJobError("SAM 3 mask RLE has an odd number of values")

  // 2. Row-runs: each run cut at the row ends.
  let row = filterScratch.row, x0 = filterScratch.x0, x1 = filterScratch.x1
  let m = 0
  let covered = 0
  let sorted = true
  for (let i = 0; i < n; i += 2) {
    const start = nums[i]!
    let len = nums[i + 1]!
    let p = start - 1
    if (p < 0 || p + len > pixels) {
      throw new DeterministicJobError(`SAM 3 mask RLE run [${start}, ${len}] leaves the ${pixels}-pixel frame`)
    }
    covered += len
    while (len > 0) {
      const r = Math.floor(p / width)
      const a = p - r * width
      const take = Math.min(len, width - a)
      if (m >= row.length) {
        row = growScratch("row", m + 1)
        x0 = growScratch("x0", m + 1)
        x1 = growScratch("x1", m + 1)
      }
      if (m > 0 && (r < row[m - 1]! || (r === row[m - 1]! && a < x0[m - 1]!))) sorted = false
      row[m] = r
      x0[m] = a
      x1[m] = a + take
      m++
      p += take
      len -= take
    }
  }
  if (m === 0) return { m: 0, covered }
  if (!sorted) {
    // Out-of-order runs (not what the model sends): sort a copy once.
    const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => row[a]! - row[b]! || x0[a]! - x0[b]!)
    const r2 = order.map((i) => row[i]!), a2 = order.map((i) => x0[i]!), b2 = order.map((i) => x1[i]!)
    for (let i = 0; i < m; i++) { row[i] = r2[i]!; x0[i] = a2[i]!; x1[i] = b2[i]! }
  }

  // 3. Merge touching / overlapping row-runs within a row (in place).
  let k = 0
  for (let i = 0; i < m; i++) {
    if (k > 0 && row[k - 1] === row[i] && x0[i]! <= x1[k - 1]!) {
      if (x1[i]! > x1[k - 1]!) x1[k - 1] = x1[i]!
    } else {
      row[k] = row[i]!
      x0[k] = x0[i]!
      x1[k] = x1[i]!
      k++
    }
  }
  m = k

  // 4. Regions: union-find over each row and the row above (two pointers; diagonals touch).
  let parent = filterScratch.parent
  if (parent.length < m) parent = growScratch("parent", m)
  for (let i = 0; i < m; i++) parent[i] = i
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  let prevFrom = 0, prevTo = 0, curFrom = 0
  while (curFrom < m) {
    const r = row[curFrom]!
    let curTo = curFrom
    while (curTo < m && row[curTo] === r) curTo++
    if (prevTo > prevFrom && row[prevFrom] === r - 1) {
      let i = prevFrom, j = curFrom
      while (i < prevTo && j < curTo) {
        if (x0[i]! <= x1[j]! && x0[j]! <= x1[i]!) {
          const ri = find(i), rj = find(j)
          if (ri !== rj) parent[rj] = ri
        }
        if (x1[i]! < x1[j]!) i++
        else j++
      }
    }
    prevFrom = curFrom
    prevTo = curTo
    curFrom = curTo
  }

  // 5. Each region's bounding box; every row-run points straight at its root from here on.
  let top = filterScratch.top, bottom = filterScratch.bottom, left = filterScratch.left, right = filterScratch.right
  if (top.length < m) { top = growScratch("top", m); bottom = growScratch("bottom", m) }
  if (left.length < m) { left = growScratch("left", m); right = growScratch("right", m) }
  for (let i = 0; i < m; i++) { top[i] = 0x7fffffff; bottom[i] = -1; left[i] = 0x7fffffff; right[i] = -1 }
  for (let i = 0; i < m; i++) {
    const root = find(i)
    parent[i] = root
    if (row[i]! < top[root]!) top[root] = row[i]!
    if (row[i]! > bottom[root]!) bottom[root] = row[i]!
    if (x0[i]! < left[root]!) left[root] = x0[i]!
    if (x1[i]! > right[root]!) right[root] = x1[i]!
  }
  return { m, covered }
}

/** An inner rectangle in pixels, bounds inclusive (`zone`). */
interface ZoneRect { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number }

/** What one region-filter pass drops: outside min ≤ rows ≤ max, or centred outside `zone` (null = no zone). */
interface RegionCuts { readonly minRows: number; readonly maxRows: number; readonly zone: ZoneRect | null }

/**
 * Drop the regions a set of cuts rejects from one frame's RLE, in ONE
 * labelling pass (`labelMaskRegions`). A region is judged by size first
 * (bounding box shorter than `minRows` or taller than `maxRows`), then by
 * position (bounding-box centre outside `zone`); each dropped region counts
 * once, under the first cut that rejects it — exactly what the size filter
 * and then the zone filter would drop, since removing whole regions never
 * joins or splits the others. Every kept region is kept exactly. Returns the
 * frame unchanged (the same string) when nothing is dropped, and `covered` =
 * the frame's white pixels before the cuts. Pure apart from the shared
 * working buffers.
 */
function dropMaskRegionsInFrame(
  rle: string,
  width: number,
  height: number,
  cuts: RegionCuts,
): { readonly rle: string; readonly droppedBySize: number; readonly droppedByZone: number; readonly covered: number } {
  const { m, covered } = labelMaskRegions(rle, width, height)
  if (m === 0) return { rle, droppedBySize: 0, droppedByZone: 0, covered }
  const { row, x0, x1, parent, top, bottom, left, right } = filterScratch
  if (filterScratch.drop.length < m) filterScratch.drop = new Uint8Array(Math.max(m, filterScratch.drop.length * 2))
  const drop = filterScratch.drop
  const { minRows, maxRows, zone } = cuts
  let droppedBySize = 0
  let droppedByZone = 0
  for (let i = 0; i < m; i++) {
    drop[i] = 0
    if (bottom[i]! < 0) continue
    const rows = bottom[i]! - top[i]! + 1
    if (rows < minRows || rows > maxRows) { drop[i] = 1; droppedBySize++; continue }
    if (zone) {
      // The bounding box's centre in continuous coordinates (a pixel spans [x, x + 1)).
      const cx = (left[i]! + right[i]!) / 2
      const cy = (top[i]! + bottom[i]! + 1) / 2
      if (cx < zone.x0 || cx > zone.x1 || cy < zone.y0 || cy > zone.y1) { drop[i] = 1; droppedByZone++ }
    }
  }
  if (droppedBySize + droppedByZone === 0) return { rle, droppedBySize: 0, droppedByZone: 0, covered }
  const kept: string[] = []
  for (let i = 0; i < m; i++) if (!drop[parent[i]!]) kept.push(`${row[i]! * width + x0[i]! + 1} ${x1[i]! - x0[i]!}`)
  return { rle: kept.join(" "), droppedBySize, droppedByZone, covered }
}

/**
 * Drop the subjects outside a height band from one frame's RLE
 * (`minSubjectHeightPct` / `maxSubjectHeightPct`): a region whose bounding
 * box is shorter than `minRows` rows, or taller than `maxRows` (default: no
 * ceiling), is dropped; every other region is kept exactly (regions as
 * `labelMaskRegions` finds them, 8-connected). Returns the frame unchanged
 * (the same string) when nothing is dropped, and `covered` = the frame's
 * white pixels before the filter. Throws like `decodeMaskRle` for a run that
 * leaves the frame. Pure apart from the shared working buffers.
 */
export function dropMaskRegionsBySizeInFrame(
  rle: string,
  width: number,
  height: number,
  minRows: number,
  maxRows: number = Number.POSITIVE_INFINITY,
): { readonly rle: string; readonly dropped: number; readonly covered: number } {
  const r = dropMaskRegionsInFrame(rle, width, height, { minRows, maxRows, zone: null })
  return { rle: r.rle, dropped: r.droppedBySize, covered: r.covered }
}

/** `zone` margins: keep only regions whose bounding-box centre is inside them (% of the frame; see `VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_*`). */
export type MaskZone = VideoMaskZone

/**
 * A zone as the filter reads it: each margin a finite number clamped to
 * `ZONE_MARGIN_PCT_MIN`–`ZONE_MARGIN_PCT_MAX` (anything else is 0), and null
 * when there is no zone or every margin is 0 (off). Pure — the shared
 * reading (`resolveVideoMaskZone`), so a workflow run's payload and the node's
 * own run send exactly what the filter applies.
 */
export const normaliseMaskZone: (value: unknown) => MaskZone | null = resolveVideoMaskZone

/** The region filters a whole-mask pass applies (each 0 / null = that filter off). */
export interface MaskRegionFilters {
  readonly minSubjectHeightPct?: number
  readonly maxSubjectHeightPct?: number
  readonly zone?: MaskZone | null
}

const anyCovered = (rle: readonly string[]) => rle.some((f) => maskRleCoveredPixels(f) > 0)

/**
 * The region filters over a whole mask, in ONE labelling pass a frame:
 *   - size (`minSubjectHeightPct` / `maxSubjectHeightPct`): keep the regions
 *     whose bounding-box height is within min % ≤ h ≤ max % of the frame
 *     height (either 0 = that side off). The route refuses min > max.
 *   - `zone`: then keep only the regions whose bounding-box centre lies in
 *     `[w·left/100, w·(1−right/100)] × [h·top/100, h·(1−bottom/100)]`.
 * All off = the frames as they are (the same array, untouched). Frames are
 * replaced IN PLACE in `rle` (the caller's array — no second copy of the
 * mask; a replaced frame's old string is free to collect), one at a time,
 * and the loop yields to the event loop every few milliseconds so the other
 * jobs on the worker keep running. Same frame count, so the mask keeps its
 * rate, length and size. `matched` / `kept`: whether any frame had white
 * before / after the filters; `droppedRegions` = `droppedBySize` +
 * `droppedByZone`.
 */
export async function dropMaskRegions(
  rle: string[],
  geometry: Pick<MaskGeometry, "width" | "height">,
  filters: MaskRegionFilters,
): Promise<{
  readonly rle: string[]; readonly droppedRegions: number; readonly droppedBySize: number; readonly droppedByZone: number
  readonly matched: boolean; readonly kept: boolean
}> {
  const minPct = filters.minSubjectHeightPct ?? 0
  const maxPct = filters.maxSubjectHeightPct ?? 0
  const zone = normaliseMaskZone(filters.zone)
  if (!(minPct > 0) && !(maxPct > 0) && !zone) {
    const covered = anyCovered(rle)
    return { rle, droppedRegions: 0, droppedBySize: 0, droppedByZone: 0, matched: covered, kept: covered }
  }
  const { width, height } = geometry
  const cuts: RegionCuts = {
    minRows: minPct > 0 ? (height * Math.min(100, minPct)) / 100 : 0,
    maxRows: maxPct > 0 ? (height * Math.min(100, maxPct)) / 100 : Number.POSITIVE_INFINITY,
    zone: zone
      ? {
        x0: (width * zone.leftPct) / 100,
        x1: (width * (100 - zone.rightPct)) / 100,
        y0: (height * zone.topPct) / 100,
        y1: (height * (100 - zone.bottomPct)) / 100,
      }
      : null,
  }
  let droppedBySize = 0
  let droppedByZone = 0
  let matched = false
  let kept = false
  let sliceStart = performance.now()
  for (let f = 0; f < rle.length; f++) {
    const r = dropMaskRegionsInFrame(rle[f]!, width, height, cuts)
    const dropped = r.droppedBySize + r.droppedByZone
    if (r.covered > 0) matched = true
    if (dropped > 0) rle[f] = r.rle
    if (dropped === 0 ? r.covered > 0 : r.rle !== "") kept = true
    droppedBySize += r.droppedBySize
    droppedByZone += r.droppedByZone
    sliceStart = await yieldIfDue(sliceStart)
  }
  return { rle, droppedRegions: droppedBySize + droppedByZone, droppedBySize, droppedByZone, matched, kept }
}

/**
 * `minSubjectHeightPct` / `maxSubjectHeightPct` over a whole mask (the size
 * filter alone — see `dropMaskRegions`): every frame keeps only the regions
 * whose bounding-box height is within min % ≤ h ≤ max % of the frame height
 * (either 0 = that side off; both 0 = the frames as they are). In place,
 * yielding to the event loop.
 */
export async function dropMaskRegionsBySize(
  rle: string[],
  geometry: Pick<MaskGeometry, "width" | "height">,
  minSubjectHeightPct: number,
  maxSubjectHeightPct = 0,
): Promise<{ readonly rle: string[]; readonly droppedRegions: number; readonly matched: boolean; readonly kept: boolean }> {
  const r = await dropMaskRegions(rle, geometry, { minSubjectHeightPct, maxSubjectHeightPct })
  return { rle: r.rle, droppedRegions: r.droppedRegions, matched: r.matched, kept: r.kept }
}

/**
 * `zone` over a whole mask (the zone filter alone — see `dropMaskRegions`):
 * every frame keeps only the regions whose bounding-box centre lies inside
 * the inner rectangle the margins leave. A null or all-zero zone is a no-op
 * (the same array returned, untouched). In place, yielding to the event loop.
 */
export async function dropMaskRegionsOutsideZone(
  rle: string[],
  geometry: Pick<MaskGeometry, "width" | "height">,
  zone: MaskZone | null,
): Promise<{ readonly rle: string[]; readonly droppedRegions: number; readonly kept: boolean; readonly matched: boolean }> {
  const r = await dropMaskRegions(rle, geometry, { zone })
  return { rle: r.rle, droppedRegions: r.droppedRegions, kept: r.kept, matched: r.matched }
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
 * refunds rather than delivering an all-black mask) — unless `allowEmpty`:
 * the model did match, and a setting the person chose (`minSubjectHeightPct` / `maxSubjectHeightPct` / `zone`)
 * removed it all, so an all-black mask is the right answer.
 */
export async function renderMaskVideo(
  rle: readonly string[],
  geometry: MaskGeometry,
  outputPath: string,
  opts: { readonly allowEmpty?: boolean } = {},
): Promise<{ readonly coveredFraction: number }> {
  const pixels = geometry.width * geometry.height
  const frame = new Uint8Array(pixels)
  // Validate every frame BEFORE spawning: a geometry mismatch or an empty
  // result never costs an encode.
  let covered = 0
  for (const r of rle) covered += decodeMaskRle(r, frame)
  if (covered === 0 && !opts.allowEmpty) {
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
    peakMemoryMiB: maskGeometryPeakMemoryMiB(geometry),
  })
  return { coveredFraction: covered / (pixels * rle.length) }
}
