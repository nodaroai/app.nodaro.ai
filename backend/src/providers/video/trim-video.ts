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
  /** Seconds-mirror of trim*Frames — trim N seconds from start and/or end.
   *  When set, overrides startTime/endTime. Worker probes duration for the
   *  end-trim calculation. */
  readonly trimStartSeconds?: number
  readonly trimEndSeconds?: number
  /** Keep only the first/last N seconds of the source (overrides
   *  startTime/endTime). Worker probes duration. */
  readonly keepFirstSeconds?: number
  readonly keepLastSeconds?: number
}

export async function trimVideo(options: TrimVideoOptions): Promise<{ videoPath: string }> {
  const {
    videoUrl, outputSilentVideo = false,
    trimStartFrames, trimEndFrames,
    trimStartSeconds, trimEndSeconds, keepFirstSeconds, keepLastSeconds,
  } = options
  let { startTime, endTime } = options
  const workDir = await createWorkDir("trim-video")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[trimVideo] Downloading video from ${videoUrl}`)
    await downloadFile(videoUrl, inputPath)

    // Frame-based trim overrides time-based when set. Worker probes
    // source fps and converts. A probe failure is a hard error rather
    // than a silent fallback to seconds (wrong unit, silent miscut).
    if (trimStartFrames !== undefined || trimEndFrames !== undefined) {
      const { fps, durationSec } = await probeTrimMetadata(inputPath)
      if (trimStartFrames !== undefined && trimStartFrames > 0) {
        startTime = trimStartFrames / fps
      }
      if (trimEndFrames !== undefined && trimEndFrames > 0) {
        endTime = Math.max(startTime, durationSec - trimEndFrames / fps)
      }
    }

    // Seconds-mirror modes — same precedence as frames-based, overrides
    // explicit startTime/endTime. Probe duration once (cheap).
    if (
      trimStartSeconds !== undefined ||
      trimEndSeconds !== undefined ||
      keepFirstSeconds !== undefined ||
      keepLastSeconds !== undefined
    ) {
      const { durationSec } = await probeTrimMetadata(inputPath)
      if (keepLastSeconds !== undefined && keepLastSeconds > 0) {
        startTime = Math.max(0, durationSec - keepLastSeconds)
        endTime = durationSec
      } else if (keepFirstSeconds !== undefined && keepFirstSeconds > 0) {
        startTime = 0
        endTime = Math.min(durationSec, keepFirstSeconds)
      } else {
        if (trimStartSeconds !== undefined && trimStartSeconds > 0) {
          startTime = trimStartSeconds
        }
        if (trimEndSeconds !== undefined && trimEndSeconds > 0) {
          endTime = Math.max(startTime, durationSec - trimEndSeconds)
        }
      }
    }

    // Input seeking (-ss before -i) for fast seek; -t is duration from
    // the start point, not absolute time.
    const args = ["-y", "-ss", String(startTime), "-i", inputPath]
    if (endTime !== undefined) {
      args.push("-t", String(endTime - startTime))
    }
    args.push("-c:v", "libx264", "-preset", "fast", "-crf", "23")
    if (outputSilentVideo) {
      args.push("-an")
    } else {
      args.push("-c:a", "aac", "-b:a", "128k")
    }
    args.push(outputPath)

    console.log(`[trimVideo] Running FFmpeg: ffmpeg ${args.join(" ")}`)
    await runFfmpeg(args)

    console.log(`[trimVideo] Output: ${outputPath}${outputSilentVideo ? " (silent)" : ""}`)
    return { videoPath: outputPath }
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
