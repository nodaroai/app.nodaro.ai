import { join } from "node:path"
import { downloadFile, runFfmpeg, runFfprobe, getVideoDuration, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface ExtractFrameOptions {
  readonly videoUrl: string
  readonly mode: "first" | "last" | "timestamp" | "frame-index" | "frame-from-end" | "keyframe"
  /** Seconds — used for mode === "timestamp" or "keyframe". */
  readonly timestamp?: number
  /** Frame index from start (0 = first). Used when mode === "frame-index". */
  readonly frameIndex?: number
  /** Frame index from end (0 = last, 1 = second-to-last).
   *  Used when mode === "frame-from-end". */
  readonly framesFromEnd?: number
}

/** Probe fps for frame-index conversion. Hard-fail on a missing/invalid
 *  reading so we don't silently mis-extract. */
async function probeFps(filePath: string): Promise<number> {
  const out = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=r_frame_rate",
    "-of", "csv=p=0",
    filePath,
  ])
  const expr = out.trim()
  if (expr.includes("/")) {
    const [num, den] = expr.split("/").map((s) => parseFloat(s))
    if (den && Number.isFinite(num / den) && num / den > 0) return num / den
  } else {
    const n = parseFloat(expr)
    if (Number.isFinite(n) && n > 0) return n
  }
  throw new Error(`extract-frame: could not probe fps from "${expr}"`)
}

export async function extractFrame(options: ExtractFrameOptions): Promise<{ imagePath: string }> {
  const { videoUrl, mode, timestamp = 0, frameIndex, framesFromEnd } = options
  const workDir = await createWorkDir("extract-frame")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "frame.jpg")

    console.log(`[extractFrame] Downloading video from ${videoUrl}`)
    await downloadFile(videoUrl, inputPath)

    const args: string[] = ["-y"]

    if (mode === "last") {
      args.push("-sseof", "-1", "-i", inputPath)
      args.push("-vframes", "1", "-q:v", "2", outputPath)
    } else if (mode === "timestamp") {
      args.push("-ss", String(timestamp), "-i", inputPath)
      args.push("-vframes", "1", "-q:v", "2", outputPath)
    } else if (mode === "keyframe") {
      // Snap to the nearest keyframe at/after `timestamp`. -skip_frame nokey
      // before -i drops non-keyframes during decoding so the next frame
      // emitted IS a keyframe. Default timestamp = 0 → first keyframe.
      args.push("-ss", String(timestamp), "-skip_frame", "nokey", "-i", inputPath)
      args.push("-vframes", "1", "-q:v", "2", outputPath)
    } else if (mode === "frame-index") {
      // Convert frame index to a time seek so this stays a single ffmpeg
      // call (no full re-decode via select filter). Fps probe is cheap and
      // exact for constant-fps sources; VFR sources fall back to the closest
      // matching frame at (index / nominal_fps).
      const idx = Math.max(0, frameIndex ?? 0)
      const fps = await probeFps(inputPath)
      const seekSec = idx / fps
      args.push("-ss", String(seekSec), "-i", inputPath)
      args.push("-vframes", "1", "-q:v", "2", outputPath)
    } else if (mode === "frame-from-end") {
      // Probe duration so we can seek backwards. -sseof would work for the
      // last few seconds but loses precision for large offsets, so compute
      // the absolute timestamp via fps and seek with -ss.
      const offset = Math.max(0, framesFromEnd ?? 0)
      const fps = await probeFps(inputPath)
      const durationSec = await getVideoDuration(inputPath)
      // Subtract a half-frame so an offset of 0 lands ON the final frame,
      // not just past the end (which would yield 0 frames).
      const seekSec = Math.max(0, durationSec - (offset + 0.5) / fps)
      args.push("-ss", String(seekSec), "-i", inputPath)
      args.push("-vframes", "1", "-q:v", "2", outputPath)
    } else {
      // mode === "first"
      args.push("-i", inputPath)
      args.push("-vframes", "1", "-q:v", "2", outputPath)
    }

    console.log(`[extractFrame] Running FFmpeg: ffmpeg ${args.join(" ")}`)
    await runFfmpeg(args)

    console.log(`[extractFrame] Output: ${outputPath}`)
    return { imagePath: outputPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
