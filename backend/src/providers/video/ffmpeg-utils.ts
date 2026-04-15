import { execFile } from "node:child_process"
import { createWriteStream } from "node:fs"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { config } from "../../lib/config.js"

export async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) {
    throw new Error(`Failed to download: ${url} (${response.status})`)
  }
  const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
  await pipeline(nodeStream, createWriteStream(dest))
}

// FIFO semaphore serializes ffmpeg spawns so fan-out doesn't launch N ffmpeg
// processes on a 2-vCPU box. The worker runs at high concurrency for I/O work;
// ffmpeg needs its own much lower cap.
let ffmpegActive = 0
const ffmpegQueue: Array<() => void> = []
function acquireFfmpegSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = () => {
      ffmpegActive++
      resolve(() => {
        ffmpegActive--
        ffmpegQueue.shift()?.()
      })
    }
    if (ffmpegActive < config.FFMPEG_CONCURRENCY) grant()
    else ffmpegQueue.push(grant)
  })
}

export async function runFfmpeg(args: readonly string[], timeoutMs?: number): Promise<string> {
  const release = await acquireFfmpegSlot()
  try {
    return await new Promise<string>((resolve, reject) => {
      execFile("ffmpeg", args as string[], {
        maxBuffer: 10 * 1024 * 1024,
        ...(timeoutMs != null ? { timeout: timeoutMs } : {}),
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`ffmpeg failed: ${stderr || error.message}`))
        } else {
          resolve(stdout)
        }
      })
    })
  } finally {
    release()
  }
}

export function runFfprobe(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ffprobe", args as string[], { maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`ffprobe failed: ${stderr || error.message}`))
      } else {
        resolve(stdout)
      }
    })
  })
}

export async function getVideoDuration(filePath: string): Promise<number> {
  const output = await runFfprobe([
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath,
  ])
  const duration = parseFloat(output.trim())
  if (Number.isNaN(duration) || duration <= 0) {
    throw new Error(`Could not determine duration for: ${filePath}`)
  }
  return duration
}

/**
 * Probe the video codec and pixel format in a single ffprobe call.
 * Returns e.g. { codec: "h264", pixFmt: "yuv420p" }.
 */
export async function probeVideoStream(filePath: string): Promise<{ codec: string; pixFmt: string }> {
  const output = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,pix_fmt",
    "-of", "csv=p=0",
    filePath,
  ])
  // ffprobe CSV output: "h264,yuv420p"
  const parts = output.trim().toLowerCase().split(",")
  return {
    codec: parts[0] ?? "",
    pixFmt: parts[1] ?? "",
  }
}

/**
 * Check whether a video file needs transcoding for browser playback.
 * Browsers universally support H.264 baseline/main/high with yuv420p.
 * When codec or pixel format cannot be determined, defaults to transcoding.
 */
export async function needsTranscode(filePath: string): Promise<boolean> {
  const { codec, pixFmt } = await probeVideoStream(filePath)
  if (codec !== "h264") return true
  if (pixFmt !== "yuv420p") return true
  return false
}

/** Standard browser-safe H.264 encoding args (no input/output). */
export const BROWSER_SAFE_VIDEO_ARGS = [
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23",
  "-movflags", "+faststart",
] as const

/**
 * Browser-safe args optimized for Remotion's OffthreadVideo compositor.
 * Forces a keyframe every frame (`-g 1`) so the compositor can seek to any
 * timestamp without decoding from a distant keyframe.  File size is ~20-40%
 * larger but frame extraction goes from ~33s to <1s per frame.
 */
export const REMOTION_INPUT_VIDEO_ARGS = [
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "18",
  "-g", "1",
  "-movflags", "+faststart",
] as const

/**
 * Transcode a video file to browser-safe H.264/yuv420p if needed.
 * Returns the output path (same as outputPath) if transcoding occurred,
 * or the original inputPath if the file was already compatible.
 */
export async function transcodeToBrowserSafe(inputPath: string, outputPath: string): Promise<string> {
  if (!await needsTranscode(inputPath)) return inputPath
  await runFfmpeg([
    "-y", "-i", inputPath,
    ...BROWSER_SAFE_VIDEO_ARGS,
    "-c:a", "aac", "-b:a", "128k",
    outputPath,
  ])
  return outputPath
}

export async function createWorkDir(prefix: string): Promise<string> {
  const workDir = join(tmpdir(), `${prefix}-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })
  return workDir
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export async function normalizeVideoForCombine(inputPath: string, outputPath: string): Promise<string> {
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-vf", "fps=24,scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ])
  return outputPath
}
