import { execFile } from "node:child_process"
import { createWriteStream } from "node:fs"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"
import { config } from "../../lib/config.js"
import { safeFetch, isPrivateOrReservedIP } from "../../lib/safe-fetch.js"

export async function downloadFile(url: string, dest: string): Promise<void> {
  // safeFetch: callers include media-process which streams user-supplied
  // sourceUrl into ffmpeg. Without DNS-aware SSRF protection, a hostname
  // resolving to an internal IP would have the response processed and the
  // result uploaded to R2 (read-oracle). See backend/src/lib/safe-fetch.ts.
  const response = await safeFetch(url, { timeoutMs: 120_000 })
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
      let released = false
      resolve(() => {
        if (released) return
        released = true
        ffmpegActive--
        ffmpegQueue.shift()?.()
      })
    }
    if (ffmpegActive < config.FFMPEG_CONCURRENCY) grant()
    else ffmpegQueue.push(grant)
  })
}

// Hard ceiling so a hung ffmpeg can't hold its slot forever and starve the
// FIFO queue. Must stay below the BullMQ lockDuration (15 min) to avoid
// re-dispatches piling on the same slot.
const DEFAULT_FFMPEG_TIMEOUT_MS = 10 * 60 * 1000

export async function runFfmpeg(args: readonly string[], timeoutMs?: number): Promise<string> {
  const release = await acquireFfmpegSlot()
  try {
    return await new Promise<string>((resolve, reject) => {
      execFile("ffmpeg", args as string[], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS,
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

/**
 * Same as runFfmpeg, but returns BOTH stdout and stderr — needed for filters
 * like `silencedetect` that write their markers to stderr (FFmpeg filter info
 * messages always land on stderr; stdout stays empty unless `-progress -` is
 * set). The FIFO semaphore + timeout are shared with `runFfmpeg`.
 */
export async function runFfmpegCapture(
  args: readonly string[],
  timeoutMs?: number,
): Promise<{ stdout: string; stderr: string }> {
  const release = await acquireFfmpegSlot()
  try {
    return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile("ffmpeg", args as string[], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS,
      }, (error, stdout, stderr) => {
        if (error) {
          // Some filters (e.g. `-f null -`) exit non-zero after writing useful
          // stderr; let the caller decide whether to parse anyway.
          reject(
            Object.assign(new Error(`ffmpeg failed: ${stderr || error.message}`), {
              stdout,
              stderr,
            }),
          )
        } else {
          resolve({ stdout, stderr })
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

/**
 * Returns true if the media file has at least one audio stream. Used by the
 * voice-changer video path to fail early (with a friendly message) when the
 * source clip is silent — most i2v/t2v models output video with no audio
 * track, and ElevenLabs speech-to-speech has nothing to transform. Probes a
 * LOCAL file only (no network), so no SSRF guard is needed.
 */
export async function hasAudioStream(filePath: string): Promise<boolean> {
  const output = await runFfprobe([
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=codec_type",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ])
  return output.trim().length > 0
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
 * SSRF guard for probeVideoSource when handed a remote URL. ffprobe performs
 * its OWN DNS resolution + network I/O, so it bypasses safeFetch — a
 * user-supplied URL that resolves to an internal IP would let ffprobe connect
 * to internal services (a blind SSRF / port-scan / cloud-metadata oracle).
 * Validate before invoking ffprobe: reject non-http(s), reject literal
 * private/reserved IPs, and reject hostnames that resolve to any
 * private/reserved IP. Local filesystem paths (no "://") bypass this — they
 * never touch the network. The `-protocol_whitelist` on the ffprobe call
 * additionally blocks protocol pivots (e.g. an HLS/concat manifest that
 * references file://). Residual: a DNS-rebind between this resolve and
 * ffprobe's own resolve — narrow, and the probe is a blind duration oracle.
 */
async function assertSafeProbeSource(src: string): Promise<void> {
  if (!src.includes("://")) return // local filesystem path — no network I/O
  let parsed: URL
  try {
    parsed = new URL(src)
  } catch {
    throw new Error(`probeVideoSource: blocked — invalid URL "${src}"`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`probeVideoSource: blocked non-http(s) protocol ${parsed.protocol}`)
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "")
  if (isIP(host)) {
    if (isPrivateOrReservedIP(host)) {
      throw new Error(`probeVideoSource: blocked private/reserved IP ${host}`)
    }
    return
  }
  let addrs: Array<{ address: string }>
  try {
    addrs = await dnsLookup(host, { all: true })
  } catch {
    throw new Error(`probeVideoSource: blocked — DNS resolution failed for ${host}`)
  }
  if (addrs.length === 0) {
    throw new Error(`probeVideoSource: blocked — no DNS resolution for ${host}`)
  }
  for (const a of addrs) {
    if (isPrivateOrReservedIP(a.address)) {
      throw new Error(
        `probeVideoSource: blocked — ${host} resolves to private/reserved IP ${a.address}`,
      )
    }
  }
}

/**
 * Probe a video URL for dimensions + duration in a single ffprobe call.
 * Accepts a local path OR a remote http(s) URL — ffprobe reads both. Remote
 * URLs go through assertSafeProbeSource first (SSRF guard); see that helper.
 */
export async function probeVideoSource(srcUrlOrPath: string): Promise<{
  width: number
  height: number
  durationSeconds: number
}> {
  await assertSafeProbeSource(srcUrlOrPath)
  const output = await runFfprobe([
    "-v", "error",
    // Confine ffprobe to file + http(s) transport so a malicious manifest
    // can't pivot to other protocols. Keep `file` so local-path probes work.
    "-protocol_whitelist", "file,http,https,tcp,tls",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration",
    "-of", "csv=p=0",
    srcUrlOrPath,
  ])
  const lines = output.trim().split(/\r?\n/)
  // ffprobe outputs lines: stream first ("W,H"), format second (duration).
  // Order can vary by ffprobe version; parse both.
  let width = 0, height = 0, durationSeconds = 0
  for (const line of lines) {
    const parts = line.split(",").map((p) => p.trim())
    if (parts.length === 2) {
      // stream line: "W,H"
      const w = parseInt(parts[0]!, 10)
      const h = parseInt(parts[1]!, 10)
      if (!Number.isNaN(w) && !Number.isNaN(h)) {
        width = w
        height = h
      }
    } else if (parts.length === 1) {
      // format line: "duration"
      const d = parseFloat(parts[0]!)
      if (!Number.isNaN(d) && d > 0) {
        durationSeconds = d
      }
    }
  }
  if (width === 0 || height === 0 || durationSeconds === 0) {
    throw new Error(`probeVideoSource failed to parse: "${output.trim()}"`)
  }
  return { width, height, durationSeconds }
}

/**
 * Probe ONLY the container duration (seconds) of any media URL or path —
 * audio OR video. Unlike probeVideoSource, this does not require a video
 * stream, so it works on audio-only files (mp3/wav/m4a). Accepts a local path
 * OR a remote http(s) URL; remote URLs go through the same SSRF guard
 * (assertSafeProbeSource) before ffprobe touches the network.
 *
 * Used by the ai-avatar AUDIO-mode reserve preHandler to bucket the credit
 * hold by the ACTUAL clip length instead of a coarse worst-case ceiling.
 */
export async function probeMediaDuration(srcUrlOrPath: string): Promise<number> {
  await assertSafeProbeSource(srcUrlOrPath)
  const output = await runFfprobe([
    "-v", "error",
    "-protocol_whitelist", "file,http,https,tcp,tls",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    srcUrlOrPath,
  ])
  const duration = parseFloat(output.trim())
  if (Number.isNaN(duration) || duration <= 0) {
    throw new Error(`probeMediaDuration failed to parse: "${output.trim()}"`)
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

/**
 * Trim the last N frames off a video. Used to remove the tail dissolve
 * VEO3.1 adds when rendering first+last-frame loops — the final ~333ms
 * (8 frames @ 24fps) is a soft cross-fade that breaks the loop seam.
 *
 * Uses `-t` with a computed target duration (totalDuration - frames/fps),
 * which trims BOTH video and audio streams to the same length and keeps
 * existing codecs intact when stream-copy is safe. We force re-encode
 * to land on an exact frame boundary because `-t` + stream-copy cuts at
 * the next keyframe, which can land before our target and shave too much.
 */
export async function trimLastFrames(
  inputPath: string,
  outputPath: string,
  framesToTrim: number,
  fps: number,
): Promise<string> {
  const sourceDuration = await getVideoDuration(inputPath)
  const trimSeconds = framesToTrim / fps
  const targetDuration = sourceDuration - trimSeconds
  if (targetDuration <= 0) {
    throw new Error(
      `Source video too short to trim ${framesToTrim} frames at ${fps}fps ` +
      `(duration=${sourceDuration.toFixed(3)}s, trim=${trimSeconds.toFixed(3)}s)`,
    )
  }
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-t", targetDuration.toFixed(3),
    // Re-encode video so the cut lands on exact frame N-8, not the
    // previous keyframe. Audio can stream-copy safely since we only
    // shorten the duration.
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "fast",
    "-crf", "20",
    "-c:a", "copy",
    "-movflags", "+faststart",
    outputPath,
  ])
  return outputPath
}

/**
 * Strip the audio track from a video, leaving the video stream untouched.
 * Stream-copies the video (`-c:v copy -an`) so this is essentially free —
 * no re-encode. Used to honour `sound: false` for providers that don't
 * expose a native audio toggle (e.g. VEO3 / VEO3.1, which always ship with
 * background audio per KIE's docs).
 */
export async function stripAudio(inputPath: string, outputPath: string): Promise<string> {
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-c:v", "copy",
    "-an",
    outputPath,
  ])
  return outputPath
}

/**
 * Re-encode a clip to a uniform format for combining: fps=24, h264/yuv420p,
 * AAC audio, and — crucially — scaled and letterboxed to exactly
 * `targetWidth`×`targetHeight`. xfade/acrossfade and the concat filter all
 * require every input to share the same resolution, so a single odd-sized
 * clip would otherwise abort the whole combine.
 */
export async function normalizeVideoForCombine(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number,
): Promise<string> {
  // Output dimensions must be even for yuv420p.
  const w = targetWidth - (targetWidth % 2)
  const h = targetHeight - (targetHeight % 2)
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-vf", `fps=24,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ])
  return outputPath
}
