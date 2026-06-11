import { join } from "node:path"
import { downloadFile, runFfmpeg, runFfprobe, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

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

/** Probe the video stream's frame count. Prefers the container's `nb_frames`
 *  (cheap, no decode); falls back to round(video-stream duration × fps).
 *  Hard-fails when neither yields a usable count so we don't mis-extract. */
async function probeFrameCount(filePath: string, fps: number): Promise<number> {
  const out = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=nb_frames",
    "-of", "csv=p=0",
    filePath,
  ])
  const n = parseInt(out.trim(), 10)
  if (Number.isFinite(n) && n > 0) return n
  const sd = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=duration",
    "-of", "csv=p=0",
    filePath,
  ])
  const dur = parseFloat(sd.trim())
  if (Number.isFinite(dur) && dur > 0) return Math.max(1, Math.round(dur * fps))
  throw new Error(
    `extract-frame: could not determine frame count (nb_frames="${out.trim()}", stream duration="${sd.trim()}")`,
  )
}

/** Seek that lands exactly ON frame `wantedIdx`: half a frame before its PTS,
 *  so the first decoded frame at/after the target IS the wanted frame, and
 *  container duration rounding can never push the seek past the final frame. */
function seekForFrameIndex(wantedIdx: number, fps: number): number {
  return Math.max(0, (wantedIdx - 0.5) / fps)
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

    if (mode === "last" || mode === "frame-from-end") {
      // Frame-exact end seek via fps + frame count. The previous approach
      // seeked relative to container duration (`-sseof -1` for "last";
      // duration-(k+0.5)/fps for from-end), which returned a frame ~1s
      // early for "last", was off by one for from-end, and decoded ZERO
      // frames for k=0 whenever duration = N/fps exactly — the final
      // frame's PTS is duration - 1/fps, BEFORE the old seek target.
      const k = mode === "last" ? 0 : Math.max(0, framesFromEnd ?? 0)
      const fps = await probeFps(inputPath)
      const frameCount = await probeFrameCount(inputPath, fps)
      const wantedIdx = Math.max(0, frameCount - 1 - k)
      args.push("-ss", String(seekForFrameIndex(wantedIdx, fps)), "-i", inputPath)
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
      // call (no full re-decode via select filter). Half-frame-early seek
      // avoids float-equality fragility at exact PTS boundaries. Fps probe
      // is cheap and exact for constant-fps sources; VFR sources land on
      // the closest matching frame.
      const idx = Math.max(0, frameIndex ?? 0)
      const fps = await probeFps(inputPath)
      args.push("-ss", String(seekForFrameIndex(idx, fps)), "-i", inputPath)
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
