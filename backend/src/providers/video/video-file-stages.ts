/**
 * The two ffmpeg stages after a download: probe the streams, re-encode to
 * h264. A fetch held to one deadline (the hardened social-post lane) passes
 * what is left of it and its abort; other callers keep the fixed watchdogs.
 */
import { spawn } from "node:child_process"
import { COMBINE_DELIVERY_CRF } from "./ffmpeg-utils.js"
import { YtDlpHaltError } from "./ytdlp-process.js"

/**
 * What ffprobe found in the downloaded file. `null` on either field means the
 * probe itself failed, NOT that the stream is absent — callers must not treat
 * "unknown" as "missing" (that would fire a bogus silent-video warning on every
 * corrupt file).
 */
export interface ProbedStreams {
  videoCodec: string | null
  hasAudio: boolean | null
}

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
    const unknown: ProbedStreams = { videoCodec: null, hasAudio: null }
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name",
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
          streams?: Array<{ codec_type?: string; codec_name?: string }>
        }
        if (!Array.isArray(streams)) return resolve(unknown)
        const video = streams.find((s) => s.codec_type === "video")
        resolve({
          videoCodec: video?.codec_name ?? null,
          hasAudio: streams.some((s) => s.codec_type === "audio"),
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
export function reencodeToH264(
  inputPath: string,
  outputPath: string,
  hasAudio: boolean | null,
  /** A fetch held to one deadline passes what is left of it, and its abort: either halts the re-encode. */
  limits?: { timeoutMs: number; signal?: AbortSignal },
): Promise<void> {
  if (limits?.signal?.aborted) return Promise.reject(new YtDlpHaltError("the re-encode was aborted", "aborted"))
  return new Promise((resolve, reject) => {
    let halted: YtDlpHaltError | undefined
    const audioArgs = hasAudio === false ? ["-an"] : ["-c:a", "aac"]
    const proc = spawn("ffmpeg", [
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
