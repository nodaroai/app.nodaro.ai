// @reads-none reads only temp files: the frame it extracts from the trend's original and the crop it makes of it
/**
 * A picture cropped out of one frame of a trend's ORIGINAL clip (the saved
 * draft's `source.videoUrl`, never its display copy): what the trend builder's
 * "Take from the original" stores as a slot's default picture (Full depth).
 *
 * The admin picks a time and a box on the clip as shown (its display copy:
 * rotation applied, which is how ffmpeg decodes the original too). The box is
 * in pixels of that frame (`shownSourceSize`). The frame is extracted with
 * core's `extractFrame` (lossless PNG), cropped with ffmpeg, and stored like
 * any trend picture (`storeLocalTrendMedia`: sniffed, measured, uploaded under
 * `trends/<trendId>/`). The box is checked against the size asked for first
 * (`frameCropProblem`), then against the decoded frame's real size (the
 * display copy's sides are rounded down to even, so the original's frame can
 * be a pixel larger, never smaller in a valid clip).
 */
import { dirname, join } from "node:path"
import { z } from "zod"
import { extractFrame } from "../../../providers/video/extract-frame.js"
import { cleanupWorkDir, runFfmpeg } from "../../../providers/video/ffmpeg-utils.js"
import { imageDimensionsOf } from "../../../lib/image-dimensions.js"
import { shownSourceSize } from "./crop.js"
import { TrendMediaError, isTransientMediaFailure, storeLocalTrendMedia } from "./media.js"
import type { TrendVersionData } from "./types.js"

/** The smallest side a cropped picture may have, in source pixels: a stray click is not a picture. */
export const FRAME_CROP_MIN_SIDE = 16

const px = z.int().min(0).max(100_000)

/** `POST /v1/admin/trends/:id/frame-crop`: the time (s) and the box, in pixels of the frame as shown. */
export const frameCropBody = z.strictObject({
  timeSec: z.number().min(0).max(3600),
  box: z.strictObject({
    x: px,
    y: px,
    w: px.min(FRAME_CROP_MIN_SIDE),
    h: px.min(FRAME_CROP_MIN_SIDE),
  }),
})

export type FrameCropRequest = z.infer<typeof frameCropBody>
export type FrameCropBox = FrameCropRequest["box"]

export interface FrameCropProblem {
  status: 400 | 409
  code: "source_missing" | "source_size_unknown" | "time_out_of_range" | "box_out_of_frame"
  message: string
}

/**
 * Why `body` cannot be cropped out of `source` (the saved draft's), or null:
 * no source, a source whose size is not known, a time outside the clip
 * (`0 ≤ t < duration`), or a box that leaves the frame.
 */
export function frameCropProblem(source: TrendVersionData["source"], body: FrameCropRequest): FrameCropProblem | null {
  if (!source) return { status: 409, code: "source_missing", message: "Add a source clip and save the draft first." }
  const size = shownSourceSize(source)
  if (!size) return { status: 409, code: "source_size_unknown", message: "The source clip's size is not known. Upload it again." }
  if (!(body.timeSec < source.durationSec)) {
    return { status: 400, code: "time_out_of_range", message: `The time must be inside the clip (0–${source.durationSec} s).` }
  }
  return boxOutside(body.box, size)
}

function boxOutside(box: FrameCropBox, size: { width: number; height: number }): FrameCropProblem | null {
  if (box.x + box.w > size.width || box.y + box.h > size.height) {
    return {
      status: 400,
      code: "box_out_of_frame",
      message: `The box (${box.w}×${box.h} at ${box.x},${box.y}) leaves the ${size.width}×${size.height} frame.`,
    }
  }
  return null
}

/** The ffmpeg arguments that crop `box` out of the still `input` into the PNG `out`. */
export function frameCropArgs(input: string, box: FrameCropBox, out: string): string[] {
  return ["-y", "-i", input, "-vf", `crop=${box.w}:${box.h}:${box.x}:${box.y}`, "-frames:v", "1", out]
}

/** The ffmpeg launch budget for one still's crop: well under a minute. */
const CROP_TIMEOUT_MS = 60_000

/**
 * Extract the frame at `timeSec` of `sourceUrl`, crop `box` out of it and
 * store the picture in the trend's storage. Throws `TrendMediaError`
 * (`media_unreadable`: no frame there; `box_out_of_frame` is a
 * `FrameCropError`) before anything is stored; a launch the platform killed
 * (`isTransientMediaFailure`) and a storage failure are thrown as they are.
 */
export async function storeFrameCrop(
  trendId: string,
  sourceUrl: string,
  request: FrameCropRequest,
): Promise<{ url: string; width?: number; height?: number }> {
  let frame: string
  try {
    frame = (await extractFrame({ videoUrl: sourceUrl, mode: "timestamp", timestamp: request.timeSec })).imagePath
  } catch (e) {
    if (isTransientMediaFailure(e)) throw e
    throw new TrendMediaError("media_unreadable", "Could not read a frame of the original at that time.", { cause: e })
  }
  const workDir = dirname(frame)
  try {
    const decoded = await imageDimensionsOf(frame)
    if (!decoded) throw new TrendMediaError("media_unreadable", "Could not read the frame's size.")
    const outside = boxOutside(request.box, decoded)
    if (outside) throw new FrameCropError(outside)
    const out = join(workDir, "crop.png")
    try {
      await runFfmpeg(frameCropArgs(frame, request.box, out), CROP_TIMEOUT_MS)
    } catch (e) {
      if (isTransientMediaFailure(e)) throw e
      throw new TrendMediaError("media_unreadable", "Could not crop the frame.", { cause: e })
    }
    const stored = await storeLocalTrendMedia(trendId, out, "image")
    return { url: stored.url, ...(stored.width ? { width: stored.width } : {}), ...(stored.height ? { height: stored.height } : {}) }
  } finally {
    await cleanupWorkDir(workDir)
  }
}

/** The box leaves the decoded frame (its real size, which the shown size only approximates). */
export class FrameCropError extends Error {
  constructor(readonly problem: FrameCropProblem) {
    super(problem.message)
    this.name = "FrameCropError"
  }
}
