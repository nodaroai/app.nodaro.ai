/**
 * Reference videos a provider refuses for their pixel size.
 *
 * Kling 4.0 (`kling-4.0/reference-to-video`) accepts a task whose reference
 * video is too large and then fails it ~40 s later with a bare
 * `[400] Generation failed. Please try again later.` — no hint of the cause,
 * and KIE's docs list only the 2-30 s length rule. Measured 2026-10-26 on the
 * identical body (production job 4064e12e, a trend test run), only the video
 * changed: 2568×1080 failed (with and without its empty chapter track),
 * 1920×1080 and 2048×862 both rendered. The size, not the 2.38:1 shape, broke
 * it — so the clip is shrunk with its shape kept, never cropped.
 *
 * Those runs do not tell a long-side limit from a pixel-count one (2568×1080
 * is over both), so a clip is kept inside BOTH sizes that rendered: a long
 * side of 2048 px (also the cap the runner puts on every image) and no more
 * pixels than 1920×1080. A 4K 16:9 clip therefore comes out 1920×1080, not an
 * untested 2048×1152.
 */
import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir, probeVideoSource } from "../video/ffmpeg-utils.js"
import { uploadJobScratchFile } from "../../lib/job-scratch.js"
import { createSanitizedError } from "./client.js"
import { atInputStep, urlForLog } from "./input-label.js"

export interface VideoSizeLimit {
  /** Neither side over this many pixels. */
  maxDimension: number
  /** No more than this many pixels in a frame. */
  maxPixels: number
}

export const KLING_4_REF_VIDEO_LIMIT: VideoSizeLimit = { maxDimension: 2048, maxPixels: 1920 * 1080 }

/** The largest even number not over `x`. */
const evenFloor = (x: number): number => 2 * Math.floor(x / 2)

/**
 * The long and short side a `width`×`height` video is shrunk to so it fits
 * `limit` (aspect kept, even sides), or null when it already fits. Sides, not
 * width/height: the probe reports the stored frame, while ffmpeg scales the
 * frame as displayed (a phone clip's rotation tag turns it), so the caller
 * applies the long side to whichever way the displayed frame is longer.
 */
export function fitVideoSize(width: number, height: number, limit: VideoSizeLimit): { long: number; short: number } | null {
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const scale = Math.min(limit.maxDimension / long, Math.sqrt(limit.maxPixels / (long * short)))
  if (scale >= 1) return null
  return { long: evenFloor(long * scale), short: evenFloor(short * scale) }
}

/**
 * ffmpeg arguments that shrink `inputPath` to `size` into an mp4 at
 * `outputPath`.
 *
 * - The long side goes to whichever way the DISPLAYED frame is longer
 *   (ffmpeg rotates before it scales).
 * - Only the first picture and (if any) the first sound track are kept:
 *   chapter, data and subtitle tracks never reach the provider.
 * - The sound is re-encoded to AAC (the source may carry a codec mp4 cannot
 *   hold); `keep_original_sound` runs send it on as the output's sound.
 */
export function shrinkVideoArgs(inputPath: string, outputPath: string, size: { long: number; short: number }): string[] {
  const { long, short } = size
  return [
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-map_metadata", "-1",
    "-map_chapters", "-1",
    "-vf", `scale='if(gte(iw,ih),${long},${short})':'if(gte(iw,ih),${short},${long})':flags=lanczos,setsar=1`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    outputPath,
  ]
}

/**
 * The URL a provider should fetch for `videoUrl`: the URL itself when it fits
 * `limit`, otherwise a shrunk copy in the running job's scratch folder. A
 * video ffprobe cannot read is passed on unchanged — the provider gives its
 * own answer, exactly as before this check existed.
 */
export async function ensureVideoFitsSize(
  videoUrl: string,
  limit: VideoSizeLimit,
  context: string,
  logLabel: string,
  /** Which input this is ("reference video #1"), for the log lines. */
  inputLabel = "reference video",
): Promise<string> {
  let width: number
  let height: number
  try {
    ;({ width, height } = await probeVideoSource(videoUrl))
  } catch (err) {
    console.warn(
      `[KIE.ai] ${logLabel}: could not probe ${inputLabel} (${urlForLog(videoUrl)}), sending it as is: ${err instanceof Error ? err.message : String(err)}`,
    )
    return videoUrl
  }
  const size = fitVideoSize(width, height, limit)
  if (!size) return videoUrl

  console.log(`[KIE.ai] ${logLabel}: reference video ${width}×${height} → ${size.long}×${size.short} (long × short side)`)
  let workDir: string | undefined
  try {
    workDir = await createWorkDir("ref-video-shrink")
    const inputPath = join(workDir, "input")
    const outputPath = join(workDir, "shrunk.mp4")
    // Each step under the input's name: a failure logs which input and step (input-label.ts).
    const label = `${logLabel} ${inputLabel}`
    await atInputStep(label, videoUrl, "download", () => downloadFile(videoUrl, inputPath))
    await atInputStep(label, videoUrl, "shrink", () => runFfmpeg(shrinkVideoArgs(inputPath, outputPath, size)))
    // A provider input: the running job's scratch folder, emptied when the job ends.
    return await atInputStep(label, videoUrl, "upload", () =>
      uploadJobScratchFile(outputPath, "provider-shrunk", "mp4", "video/mp4"))
  } catch (err) {
    console.error(`[KIE.ai] ${logLabel}: ${inputLabel} shrink failed: ${err instanceof Error ? err.message : String(err)}`)
    throw createSanitizedError(
      `Could not prepare the reference video (${width}×${height}) for this model`,
      context,
    )
  } finally {
    if (workDir) await cleanupWorkDir(workDir)
  }
}
