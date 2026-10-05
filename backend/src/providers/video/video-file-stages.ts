/**
 * The two ffmpeg stages after a download: probe the streams, re-encode to
 * h264. A fetch held to one deadline (the hardened social-post lane) passes
 * what is left of it and its abort; other callers keep the fixed watchdogs.
 */
import { spawn } from "node:child_process"
import { COMBINE_DELIVERY_CRF, withFfmpegSlot } from "./ffmpeg-utils.js"
import { spawnFfmpeg } from "./ffmpeg-process.js"
import { canvasPeakMemoryMiB, UHD_CANVAS } from "./ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"
import { YtDlpHaltError, type FetchDeadline } from "./ytdlp-process.js"

/**
 * What ffprobe found in the downloaded file. `null` on either field means the
 * probe itself failed, NOT that the stream is absent — callers must not treat
 * "unknown" as "missing" (that would fire a bogus silent-video warning on every
 * corrupt file).
 */
export interface ProbedStreams {
  videoCodec: string | null
  hasAudio: boolean | null
  /** The video stream's picture size — the re-encode's memory prediction reads
   *  it. `null` / absent: unknown (the probe failed, or no video stream). */
  width?: number | null
  height?: number | null
}

const positiveInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null

/**
 * Probe the file's streams with ffprobe. Never rejects.
 *
 * This reports the AUDIO stream too, not just the video codec. It used to only
 * answer "is this h264?", which meant a download that arrived with no audio
 * track at all was indistinguishable from a healthy one — so a silent video was
 * uploaded, marked "completed", and only blew up steps later inside ffmpeg. The
 * download path is the last place that can still name that failure.
 */
export function probeStreams(
  filePath: string,
  /** A fetch held to one deadline passes what is left of it, and its abort. */
  limits?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<ProbedStreams> {
  return new Promise((resolve) => {
    const unknown: ProbedStreams = { videoCodec: null, hasAudio: null, width: null, height: null }
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name,width,height",
      "-of", "json",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] })

    // Watchdog: a corrupt download can wedge ffprobe; local probes finish in
    // well under a second, so 30s is purely a leak guard.
    const stop = () => proc.kill("SIGKILL")
    const watchdog = setTimeout(stop, Math.min(30_000, limits?.timeoutMs ?? 30_000))
    limits?.signal?.addEventListener("abort", stop, { once: true })
    let stdout = ""
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.on("close", (code) => {
      clearTimeout(watchdog)
      limits?.signal?.removeEventListener("abort", stop)
      if (code !== 0) return resolve(unknown)
      try {
        // JSON, not CSV: ffprobe emits fields in its own fixed order, not the
        // order `-show_entries` lists them, so positional parsing is a trap.
        const { streams } = JSON.parse(stdout) as {
          streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>
        }
        if (!Array.isArray(streams)) return resolve(unknown)
        const video = streams.find((s) => s.codec_type === "video")
        resolve({
          videoCodec: video?.codec_name ?? null,
          hasAudio: streams.some((s) => s.codec_type === "audio"),
          width: positiveInt(video?.width),
          height: positiveInt(video?.height),
        })
      } catch {
        resolve(unknown)
      }
    })
    proc.on("error", () => {
      clearTimeout(watchdog)
      limits?.signal?.removeEventListener("abort", stop)
      resolve(unknown)
    })
  })
}

/** The picture size a re-encode is predicted for when the probe could not read
 *  one: 4K. A bigger source is predicted at its own size. */
export const REENCODE_ASSUMED_CANVAS = UHD_CANVAS

/** What the re-encode's ffmpeg predicts it needs at its peak, in MiB: the
 *  canvas model for ONE segment at the threads it will run with. */
export function reencodePeakMemoryMiB(canvas: { width: number; height: number } | undefined): number {
  return canvasPeakMemoryMiB(canvas ?? REENCODE_ASSUMED_CANVAS, 1, ffmpegEffectiveThreads())
}

/** The longest an ffmpeg holds its slot here — the watchdog's own default. */
const REENCODE_HOLD_MS = 10 * 60 * 1000

/**
 * Re-encode to h264 mp4 for downstream compatibility. Rejects on failure.
 * Exported for testability.
 *
 * `hasAudio === false` (a DEFINITE no-audio stream) re-encodes video-only with
 * `-an`: adding `-c:a aac` to an input that has no audio makes ffmpeg abort with
 * "Error opening output files: Invalid argument" (exit 234) — the crash that
 * turned a silent YouTube download into a failed import. `null` (probe failed →
 * unknown) and `true` keep `-c:a aac`, the safe default.
 */
export async function reencodeToH264(
  inputPath: string,
  outputPath: string,
  hasAudio: boolean | null,
  /** A fetch held to one deadline passes it and its abort: either halts the re-encode. */
  limits?: { deadline: FetchDeadline; signal?: AbortSignal },
  /** The source's picture size, when probed — the memory prediction's canvas. */
  launch?: { canvas?: { width: number; height: number } },
): Promise<void> {
  if (limits?.signal?.aborted) throw new YtDlpHaltError("the re-encode was aborted", "aborted")
  if (limits && limits.deadline.remainingMs() <= 0) throw new YtDlpHaltError("the re-encode ran out of time", "out_of_time")
  // A full x264 encode: admitted like every ffmpeg, against the memory it is
  // predicted to need. The fetch's deadline does NOT run while it waits for
  // admission (`FetchDeadline`, excused by `withFfmpegSlot`): what is left of it
  // is read once the launch is admitted, and from then on the re-encode is held to it.
  // The fetch's abort also ends the wait.
  try {
    return await withFfmpegSlot(
      () => {
        const left = limits?.deadline.remainingMs()
        if (left !== undefined && left <= 0) {
          return Promise.reject(new YtDlpHaltError("the re-encode ran out of time", "out_of_time"))
        }
        return runReencode(inputPath, outputPath, hasAudio, limits ? { timeoutMs: left!, signal: limits.signal } : undefined)
      },
      {
        timeoutMs: REENCODE_HOLD_MS, signal: limits?.signal, label: "re-encode", peakMemoryMiB: reencodePeakMemoryMiB(launch?.canvas),
        deadline: limits?.deadline,
      },
    )
  } catch (error) {
    // The abort that ended the wait for memory is the halt the re-encode itself raises.
    if (limits?.signal?.aborted && !(error instanceof YtDlpHaltError)) {
      throw new YtDlpHaltError("the re-encode was aborted", "aborted")
    }
    throw error
  }
}

function runReencode(
  inputPath: string,
  outputPath: string,
  hasAudio: boolean | null,
  limits: { timeoutMs: number; signal?: AbortSignal } | undefined,
): Promise<void> {
  if (limits?.signal?.aborted) return Promise.reject(new YtDlpHaltError("the re-encode was aborted", "aborted"))
  return new Promise((resolve, reject) => {
    let halted: YtDlpHaltError | undefined
    const audioArgs = hasAudio === false ? ["-an"] : ["-c:a", "aac"]
    const proc = spawnFfmpeg([
      "-i", inputPath,
      "-c:v", "libx264",
      "-preset", "fast",
      // Delivery-floor CRF (was 23 — a visible generation loss on every
      // VP9/AV1 download this normalizes; 2026-08-02 import-quality fix).
      "-crf", COMBINE_DELIVERY_CRF,
      ...audioArgs,
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ], { stdio: ["ignore", "ignore", "pipe"] })

    // Watchdog: an ffmpeg wedged on corrupt input would leak the process and
    // strand the download in "processing" forever. 10min matches the worker
    // wrappers' DEFAULT_FFMPEG_TIMEOUT_MS — far above any legit re-encode.
    const halt = (err: YtDlpHaltError) => {
      halted = err
      proc.kill("SIGKILL")
    }
    const watchdog = limits && limits.timeoutMs < 10 * 60 * 1000
      ? setTimeout(() => halt(new YtDlpHaltError("the re-encode ran out of time", "out_of_time")), limits.timeoutMs)
      : setTimeout(() => proc.kill("SIGKILL"), 10 * 60 * 1000)
    const onAbort = () => halt(new YtDlpHaltError("the re-encode was aborted", "aborted"))
    limits?.signal?.addEventListener("abort", onAbort, { once: true })
    let stderrBuf = ""
    proc.stderr.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString() })
    proc.on("close", (code) => {
      clearTimeout(watchdog)
      limits?.signal?.removeEventListener("abort", onAbort)
      if (halted) reject(halted)
      else if (code === 0) resolve()
      else reject(new Error(`ffmpeg re-encode exited with code ${code}: ${stderrBuf.trim().split("\n").pop()}`))
    })
    proc.on("error", (err) => {
      clearTimeout(watchdog)
      limits?.signal?.removeEventListener("abort", onAbort)
      reject(err)
    })
  })
}
