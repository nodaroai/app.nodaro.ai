import { join } from "node:path"
import { downloadFile, runFfmpeg, runFfprobe, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface TrimVideoOptions {
  readonly videoUrl: string
  readonly startTime: number
  readonly endTime?: number
  readonly outputSilentVideo?: boolean
  /** Frame-based trim from start. When set, overrides `startTime`.
   *  Converted to seconds at run time using the source's reported fps. */
  readonly trimStartFrames?: number
  /** Frame-based trim from end. When set, the output ends at
   *  (sourceFrames - trimEndFrames). Overrides `endTime`. */
  readonly trimEndFrames?: number
}

export async function trimVideo(options: TrimVideoOptions): Promise<{ videoPath: string; silentVideoPath?: string }> {
  const { videoUrl, outputSilentVideo = false, trimStartFrames, trimEndFrames } = options
  let { startTime, endTime } = options
  const workDir = await createWorkDir("trim-video")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[trimVideo] Downloading video from ${videoUrl}`)
    await downloadFile(videoUrl, inputPath)

    // Frame-based trimming overrides time-based when set. Convert frames
    // to seconds using the source's reported fps. Failing this probe is
    // a hard error — the user explicitly asked for frame-based trim and
    // we shouldn't silently fall back to seconds with a wrong unit.
    if (trimStartFrames !== undefined || trimEndFrames !== undefined) {
      const { fps, durationSec } = await probeTrimMetadata(inputPath)
      if (trimStartFrames !== undefined && trimStartFrames > 0) {
        startTime = trimStartFrames / fps
      }
      if (trimEndFrames !== undefined && trimEndFrames > 0) {
        endTime = Math.max(startTime, durationSec - trimEndFrames / fps)
      }
    }

    // Use input seeking (-ss before -i) for faster seeking, then re-encode
    // to ensure both video and audio streams are properly included.
    // Note: When using input seeking, -t is duration from start point, not absolute time.
    const args = ["-y", "-ss", String(startTime), "-i", inputPath]

    if (endTime !== undefined) {
      // Calculate duration from startTime to endTime
      const duration = endTime - startTime
      args.push("-t", String(duration))
    }

    // Re-encode video and audio to ensure both streams are included
    // Using fast preset for reasonable speed, CRF 23 for good quality
    args.push(
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      outputPath
    )

    console.log(`[trimVideo] Running FFmpeg: ffmpeg ${args.join(" ")}`)
    await runFfmpeg(args)

    console.log(`[trimVideo] Output: ${outputPath}`)

    let silentVideoPath: string | undefined
    if (outputSilentVideo) {
      try {
        silentVideoPath = join(workDir, "silent.mp4")
        await runFfmpeg([
          "-y",
          "-i", outputPath,
          "-an",
          "-c:v", "copy",
          silentVideoPath,
        ])
        console.log(`[trimVideo] Silent video output: ${silentVideoPath}`)
      } catch {
        console.log("[trimVideo] Failed to generate silent video, skipping")
        silentVideoPath = undefined
      }
    }

    return { videoPath: outputPath, silentVideoPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}

async function probeTrimMetadata(filePath: string): Promise<{ fps: number; durationSec: number }> {
  const out = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=r_frame_rate:format=duration",
    "-of", "csv=p=0",
    filePath,
  ])
  const lines = out.trim().split(/\r?\n/).filter(Boolean)
  // ffprobe's `-show_entries stream=...:format=...` emits stream first,
  // then format, on separate lines. We accept either order defensively.
  let fpsExpr: string | undefined
  let durationStr: string | undefined
  for (const line of lines) {
    if (line.includes("/")) fpsExpr ??= line
    else durationStr ??= line
  }
  const fps = parseFractionalFps(fpsExpr)
  const durationSec = parseFloat(durationStr ?? "0")
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(
      `trim-video: could not probe fps/duration for frame-based trim: fpsExpr="${fpsExpr}" duration="${durationStr}"`,
    )
  }
  return { fps, durationSec }
}

function parseFractionalFps(expr: string | undefined): number {
  if (!expr) return NaN
  if (expr.includes("/")) {
    const [num, den] = expr.split("/").map((s) => parseFloat(s))
    return den ? num / den : NaN
  }
  return parseFloat(expr)
}
