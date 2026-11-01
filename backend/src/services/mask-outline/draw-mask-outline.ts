/**
 * DRAW ROLE OUTLINES ON A CLIP — the core of `POST /v1/mask-outline`.
 *
 * A clip (already filled and drawn on: a trend's stored face mask) and the
 * mask it was filled from (white = covered), plus outlines (a colour and
 * boxes over mask frames each): frame by frame, each outline's masked regions
 * get a ring just outside them in its colour (mask-outline-draw.ts). The mask
 * is read frame for frame when it has the clip's frame count, else by TIME
 * (`face-mesh-timing.ts`: Video Mask re-encodes a variable-rate clip to a
 * constant rate, so its mask can have another count); its boxes' ranges are
 * read on the MASK's frames, as Mask Erase reads them.
 *
 * The output has EXACTLY the clip's frame count, size and frame rate, its
 * colour tags and its audio stream copied untouched (the face mesh's decode
 * and encode: `streamFrames`, `buildFaceMeshEncodeArgs`). No region for any
 * outline is not a failure: the clip comes back re-encoded with nothing drawn.
 *
 * Both decoders and the encoder run inside ONE admission hold
 * (`withFfmpegSlot`, `maskOutlinePeakMemoryMiB`), started through the one
 * launcher (`spawnFfmpeg`), in lockstep with `-fps_mode passthrough`.
 */
import { once } from "node:events"
import { join } from "node:path"
import type { Writable } from "node:stream"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { ffmpegFailureMessage, probeVideoOverlayBase, runFfprobe, withFfmpegSlot, type VideoOverlayBaseProbe } from "../../providers/video/ffmpeg-utils.js"
import { spawnFfmpeg } from "../../providers/video/ffmpeg-process.js"
import { ffmpegEffectiveThreads } from "../../providers/video/ffmpeg-threads.js"
import { countVideoFrames } from "../../providers/video/video-mask.js"
import { maskEraseRects, type MaskEraseBoxInput } from "../../providers/video/mask-erase.js"
import { buildFaceMeshEncodeArgs, frameRateOf, probeColour, streamFrames } from "../face-mesh/draw-face-mesh.js"
import { frameTimesOf, maskFramesForClip, sameSpan } from "../face-mesh/face-mesh-timing.js"
import { createOutlineScratch, drawOutlinesOnFrame, rgbOf, type OutlinePlanEntry } from "./mask-outline-draw.js"
import { maskOutlinePeakMemoryMiB, maskOutlineTimeoutMs } from "./mask-outline-budget.js"

/** The drawing's recipe, recorded on every result: bumped when the rings change. */
export const MASK_OUTLINE_RECIPE = "mask-outline-v1"

/** The ring as a share of the clip's short side, its floor, and each black edge (px). */
export const MASK_OUTLINE_STROKE = { shortSidePct: 0.6, minPx: 3, edgePx: 1 } as const

/** The ring's colour band in px for a `width × height` clip: 0.6 % of the short side, rounded, at least 3. Pure. */
export function maskOutlineStrokePx(width: number, height: number): number {
  return Math.max(MASK_OUTLINE_STROKE.minPx, Math.round((Math.min(width, height) * MASK_OUTLINE_STROKE.shortSidePct) / 100))
}

export interface MaskOutlineSpec {
  /** `#RRGGBB`. */
  readonly colour: string
  readonly boxes: readonly MaskEraseBoxInput[]
}

export interface DrawMaskOutlineInput {
  /** Local path of the clip the rings go on. */
  readonly videoPath: string
  /** Local path of the mask the clip was filled from. */
  readonly maskPath: string
  readonly outlines: readonly MaskOutlineSpec[]
  readonly outputPath: string
}

export interface DrawMaskOutlineResult {
  readonly outputPath: string
  readonly width: number
  readonly height: number
  readonly frames: number
  /** Per outline (in the request's order): the frames it was drawn on and the regions it ringed, summed over the frames. */
  readonly perOutline: Array<{ framesDrawn: number; regionsDrawn: number }>
  /** The regions two or more outlines claimed (left undrawn), summed over the frames. */
  readonly ambiguous: number
  readonly strokePx: number
}

/** The inputs cannot be used as given (unreadable, frame counts that differ, an odd size). */
export class MaskOutlineInputError extends DeterministicJobError {
  constructor(message: string) {
    super(`mask outline: ${message}`)
    this.name = "MaskOutlineInputError"
  }
}

async function clipInfo(path: string, what: string): Promise<{ probe: VideoOverlayBaseProbe; frames: number }> {
  let probe: VideoOverlayBaseProbe
  try {
    probe = await probeVideoOverlayBase(path)
  } catch (err) {
    if ((err as { timedOut?: unknown }).timedOut === true) throw err
    throw new MaskOutlineInputError(`the ${what} could not be read`)
  }
  if (!(probe.width > 0 && probe.height > 0)) throw new MaskOutlineInputError(`the ${what} has no picture`)
  const frames = (await countVideoFrames(path)) ?? probe.frameCount
  if (!frames) throw new MaskOutlineInputError(`the ${what}'s frames could not be counted`)
  return { probe, frames }
}

async function frameTimes(path: string): Promise<number[] | null> {
  try {
    return frameTimesOf(await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", path]))
  } catch {
    return null
  }
}

/** For each clip frame, the mask frame read with it: index to index when the counts agree, else by time. */
async function maskFrameMap(videoPath: string, maskPath: string, frames: number, maskFrames: number): Promise<Int32Array> {
  if (maskFrames === frames) return Int32Array.from({ length: frames }, (_, i) => i)
  const [clip, mask] = await Promise.all([frameTimes(videoPath), frameTimes(maskPath)])
  if (!clip || !mask || clip.length !== frames || mask.length !== maskFrames) {
    throw new MaskOutlineInputError(`the mask has ${maskFrames} frames, the video ${frames}, and their frame times could not be read`)
  }
  if (!sameSpan(clip, mask)) {
    throw new MaskOutlineInputError(`the mask spans ${mask.at(-1)!.toFixed(2)} s and the video ${clip.at(-1)!.toFixed(2)} s: it is not this video's mask`)
  }
  return maskFramesForClip(clip, mask)
}

async function writeFrame(stdin: Writable, frame: Buffer): Promise<void> {
  if (!stdin.write(frame)) await once(stdin, "drain")
}

export async function drawMaskOutlineVideo(input: DrawMaskOutlineInput): Promise<DrawMaskOutlineResult> {
  const clip = await clipInfo(input.videoPath, "video")
  const mask = await clipInfo(input.maskPath, "mask")
  const frames = clip.frames
  const maskOf = await maskFrameMap(input.videoPath, input.maskPath, frames, mask.frames)
  const draw = { width: clip.probe.width, height: clip.probe.height }
  if (draw.width % 2 !== 0 || draw.height % 2 !== 0) {
    throw new MaskOutlineInputError(`the video is ${draw.width}×${draw.height}: an H.264 copy needs an even width and height`)
  }
  const maskSize = { width: mask.probe.width, height: mask.probe.height }
  // The boxes in the MASK's pixels: the regions are labelled there, as Mask Erase labels them.
  const plan: OutlinePlanEntry[] = input.outlines.map((o) => ({ rgb: rgbOf(o.colour), rects: maskEraseRects(o.boxes, maskSize.width, maskSize.height) }))
  const stroke = { strokePx: maskOutlineStrokePx(draw.width, draw.height), edgePx: MASK_OUTLINE_STROKE.edgePx }
  const frameRate = frameRateOf(clip.probe)
  const colour = await probeColour(input.videoPath)
  const timeoutMs = maskOutlineTimeoutMs(frames)
  const peakMemoryMiB = maskOutlinePeakMemoryMiB({ draw, mask: maskSize }, ffmpegEffectiveThreads())

  const counted = await withFfmpegSlot(async () => {
    const enc = spawnFfmpeg(
      buildFaceMeshEncodeArgs({ ...draw, frameRate, audioFrom: input.videoPath, outputPath: input.outputPath, colour }),
      { stdio: ["pipe", "ignore", "pipe"] },
    )
    let encErr = ""
    enc.stderr.on("data", (c: Buffer) => { encErr = (encErr + c.toString()).slice(-8_000) })
    const encClosed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      enc.on("error", reject)
      enc.on("close", (code: number | null, signal: NodeJS.Signals | null) => resolve({ code, signal }))
    })
    encClosed.catch(() => undefined)
    enc.stdin.on("error", () => { /* surfaced by close */ })
    const watchdog = setTimeout(() => enc.kill("SIGKILL"), timeoutMs)

    const video = streamFrames(input.videoPath, { pixFmt: "rgb24", ...draw, timeoutMs, colour, what: "mask outline" })
    const maskStream = streamFrames(input.maskPath, { pixFmt: "gray", ...maskSize, timeoutMs, what: "mask outline" })
    let maskAt = -1
    let maskGray: Buffer | undefined
    const maskFor = async (frame: number): Promise<{ gray: Buffer; index: number }> => {
      const want = maskOf[frame]!
      while (maskAt < want) {
        const r = await maskStream.next()
        if (r.done) throw new MaskOutlineInputError(`the mask ran out of frames at mask frame ${maskAt + 1} (video frame ${frame})`)
        maskGray = r.value
        maskAt++
      }
      return { gray: maskGray!, index: maskAt }
    }
    const scratch = createOutlineScratch()
    const perOutline = input.outlines.map(() => ({ framesDrawn: 0, regionsDrawn: 0 }))
    let ambiguous = 0
    let n = 0
    try {
      for (;;) {
        const next = await video.next()
        if (next.done) break
        if (n >= frames) throw new MaskOutlineInputError(`the video holds more than the ${frames} frames counted`)
        const m = await maskFor(n)
        // A copy: the decoder reuses its buffer for the next frame while this one may still be queued.
        const rgb = Buffer.from(next.value)
        const r = drawOutlinesOnFrame(
          { rgb, ...draw, mask: m.gray, maskWidth: maskSize.width, maskHeight: maskSize.height, maskFrame: m.index },
          plan,
          stroke,
          scratch,
        )
        r.regionsDrawn.forEach((count, k) => {
          if (count > 0) {
            perOutline[k]!.framesDrawn++
            perOutline[k]!.regionsDrawn += count
          }
        })
        ambiguous += r.ambiguous
        await writeFrame(enc.stdin, rgb)
        n++
      }
      // A mask with frames past the clip's last moment: the rest is never read (its decode is stopped).
      await maskStream.return(undefined)
      enc.stdin.end()
      const { code, signal } = await encClosed
      if (code !== 0) throw new Error(`mask outline encode: ${ffmpegFailureMessage(encErr, signal ? `killed (${signal})` : `exit ${code}`)}`)
    } catch (err) {
      enc.kill("SIGKILL")
      await Promise.all([video, maskStream].map((s) => s.return(undefined).catch(() => undefined)))
      throw err
    } finally {
      clearTimeout(watchdog)
    }
    if (n !== frames) throw new MaskOutlineInputError(`the video gave ${n} of the ${frames} frames counted`)
    return { perOutline, ambiguous }
  }, { timeoutMs, peakMemoryMiB, label: "mask outline" })

  return { outputPath: input.outputPath, ...draw, frames, ...counted, strokePx: stroke.strokePx }
}

/** The output's local path in `workDir`. */
export const maskOutlineOutputPath = (workDir: string): string => join(workDir, "mask-outline.mp4")
