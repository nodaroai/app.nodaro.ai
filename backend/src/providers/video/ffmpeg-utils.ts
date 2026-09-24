import { execFile, spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"
import { config } from "../../lib/config.js"
import { safeFetch, isPrivateOrReservedIP } from "../../lib/safe-fetch.js"
import { csvFields } from "./ffprobe-csv.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS, FFPROBE_TIMEOUT_MS } from "./ffmpeg-timeouts.js"

// The ceilings live in a dependency-free leaf (see its header); re-exported so
// every existing `ffmpeg-utils.js` import keeps working.
export { DEFAULT_FFMPEG_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS, FFPROBE_TIMEOUT_MS }

export async function downloadFile(url: string, dest: string, opts: { maxBytes?: number } = {}): Promise<void> {
  // safeFetch: callers include media-process which streams user-supplied
  // sourceUrl into ffmpeg. Without DNS-aware SSRF protection, a hostname
  // resolving to an internal IP would have the response processed and the
  // result uploaded to R2 (read-oracle). See backend/src/lib/safe-fetch.ts.
  const response = await safeFetch(url, { timeoutMs: DOWNLOAD_TIMEOUT_MS })
  if (!response.ok) {
    // Cloudflare can negative-cache a 404 per-edge for 40-55min on freshly
    // finalized media (incidents 2026-06-10/12). When the URL is OUR public
    // bucket, bypass the edge and stream straight from the R2 origin —
    // r2KeyFromOurUrl returns null for foreign URLs, so provider links keep
    // the plain failure path.
    if (response.status === 404) {
      // Dynamic import keeps storage (and its module-level S3 client) out of
      // this module's graph — the fallback is a cold error path and several
      // test suites load ffmpeg-utils with a minimal config mock.
      const { r2KeyFromOurUrl, downloadR2ObjectToFile } = await import("../../lib/storage.js")
      const key = r2KeyFromOurUrl(url)
      if (key) {
        await downloadR2ObjectToFile(key, dest)
        return
      }
    }
    throw new Error(`Failed to download: ${url} (${response.status})`)
  }
  const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
  const { maxBytes } = opts
  if (maxBytes !== undefined && maxBytes > 0) {
    // Byte cap for callers that fetch attacker-choosable URLs: the stream is
    // aborted as soon as the cap is crossed, so a hostile host cannot fill the
    // worker's tmpdir at line rate (each write is the caller's own work dir).
    let total = 0
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        total += chunk.length
        if (total > maxBytes) cb(new Error(`Download exceeds ${Math.round(maxBytes / (1024 * 1024))} MB: ${url}`))
        else cb(null, chunk)
      },
    })
    await pipeline(nodeStream, counter, createWriteStream(dest))
    return
  }
  await pipeline(nodeStream, createWriteStream(dest))
}

// FIFO semaphore serializes ffmpeg spawns so fan-out doesn't launch N ffmpeg
// processes on a 2-vCPU box. The worker runs at high concurrency for I/O work;
// ffmpeg needs its own much lower cap.
let ffmpegActive = 0
const ffmpegQueue: Array<() => void> = []
function acquireFfmpegSlot(signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = ffmpegQueue.indexOf(grant)
      if (index >= 0) ffmpegQueue.splice(index, 1)
      reject(signal?.reason ?? new Error("FFmpeg wait cancelled"))
    }
    const grant = () => {
      signal?.removeEventListener("abort", abort)
      if (signal?.aborted) { abort(); ffmpegQueue.shift()?.(); return }
      ffmpegActive++
      let released = false
      resolve(() => {
        if (released) return
        released = true
        ffmpegActive--
        ffmpegQueue.shift()?.()
      })
    }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener("abort", abort, { once: true })
    if (ffmpegActive < config.FFMPEG_CONCURRENCY) grant()
    else ffmpegQueue.push(grant)
  })
}

/**
 * Run `fn` while holding one FIFO ffmpeg slot, releasing it afterwards.
 *
 * WHY exported: a few CPU/memory-bound steps are NOT ffmpeg spawns (so they
 * can't go through `runFfmpeg`) yet must share the same low concurrency cap —
 * e.g. the collage badge overlay is a sharp 4K re-encode running on a worker at
 * concurrency 50. Gating it on the same semaphore keeps fan-out from launching
 * dozens of heavy raster jobs at once. `acquireFfmpegSlot` stays private; this
 * is the only sanctioned way for a non-`runFfmpeg` caller to borrow a slot.
 */
export async function withFfmpegSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const release = await acquireFfmpegSlot(signal)
  try {
    return await fn()
  } finally {
    release()
  }
}

/**
 * How much of ffmpeg's output a failure message carries.
 *
 * WHY A TAIL, AND WHY THIS SMALL. ffmpeg opens EVERY run with a ~2-4 KB banner
 * (`ffmpeg version …`, `built with …`, `configuration: --prefix=… (60 flags)`,
 * a `lib*` line per library) and writes the actual error LAST. `markJobFailed`
 * stores `error_message.slice(0, 500)` (lib/job-failure.ts), so a message built
 * head-first stores the banner and drops the cause — every ffmpeg failure in
 * `/admin/app-reports` reads "ffmpeg version n8.1.2 … configuration: --prefix"
 * and nothing else (prod report 2026-09-06, a voice-changer-pro remux: the
 * stderr that would have named the broken step never left the worker).
 * `runFfmpegWithProgress` already keeps only a tail for the same reason.
 *
 * The budget is deliberately under that 500-char cut so the cause SURVIVES it.
 */
const FFMPEG_ERROR_TAIL_CHARS = 420

/** Last non-empty lines of ffmpeg output, newest-last, within the budget. */
function ffmpegOutputTail(text: string, maxChars = FFMPEG_ERROR_TAIL_CHARS): string {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0)
  const kept: string[] = []
  let budget = maxChars
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    // Always keep something: a single over-long line is tail-cut rather than
    // dropped (an ffmpeg filter-graph error is often one very long line).
    if (kept.length === 0) {
      kept.unshift(line.length > maxChars ? `…${line.slice(-maxChars)}` : line)
      budget -= Math.min(line.length, maxChars) + 1
      continue
    }
    if (line.length + 1 > budget) break
    kept.unshift(line)
    budget -= line.length + 1
  }
  return kept.join("\n")
}

/**
 * The message every ffmpeg failure throws: the "ffmpeg failed:" prefix other
 * layers key off (`lib/mcp/tools/_job-error.ts` uses it to keep keyword
 * classification away from raw ffmpeg diagnostics) plus the TAIL of whatever
 * ffmpeg said. `fallback` is the spawn error's own message, used when ffmpeg
 * wrote no stderr at all — it too is tailed, because Node's execFile message is
 * `Command failed: ffmpeg -y -i … <every argument>` and would otherwise eat the
 * whole budget with the command line.
 */
export function ffmpegFailureMessage(stderr: string | undefined, fallback: string): string {
  const tail = ffmpegOutputTail(stderr ?? "") || ffmpegOutputTail(fallback) || "no output"
  return `ffmpeg failed: ${tail}`
}

export async function runFfmpeg(args: readonly string[], timeoutMs?: number): Promise<string> {
  const release = await acquireFfmpegSlot()
  try {
    return await new Promise<string>((resolve, reject) => {
      execFile("ffmpeg", args as string[], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(ffmpegFailureMessage(stderr, error.message)))
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
          // stderr; let the caller decide whether to parse anyway — so the FULL
          // stderr stays on the error object even though the message carries
          // only its tail.
          reject(
            Object.assign(new Error(ffmpegFailureMessage(stderr, error.message)), {
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

/**
 * Same contract (FIFO semaphore + hard timeout) as `runFfmpeg`, but streams
 * per-frame progress while encoding: spawns ffmpeg with `-progress pipe:1`
 * and calls `onFrame(n)` for every `frame=N` line it emits on stdout.
 *
 * Used by renders whose total frame count is known up front (still-to-video
 * computes `frames = ceil(audioDuration * fps)` for zoompan anyway), so the
 * caller can surface REAL percent progress instead of coarse milestones.
 *
 * Unlike `runFfmpeg`, this uses `spawn` — execFile's built-in `timeout`
 * option doesn't exist there, so the watchdog kill is explicit (mirrors
 * youtube-video.ts): a hung ffmpeg must not hold its semaphore slot past
 * the ceiling and starve the FIFO queue.
 */
export async function runFfmpegWithProgress(
  args: readonly string[],
  onFrame?: (frame: number) => void,
  timeoutMs?: number,
): Promise<void> {
  const release = await acquireFfmpegSlot()
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ["-progress", "pipe:1", "-nostats", ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      })

      let timedOut = false
      const watchdog = setTimeout(() => {
        timedOut = true
        proc.kill("SIGKILL")
      }, timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS)

      // Keep only the stderr tail — that's where ffmpeg writes its real error.
      // (8 KB here, then `ffmpegFailureMessage` narrows it to the last lines.)
      let stderrTail = ""
      proc.stderr.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-8192)
      })

      let lineBuf = ""
      proc.stdout.on("data", (chunk: Buffer) => {
        lineBuf += chunk.toString()
        const lines = lineBuf.split("\n")
        lineBuf = lines.pop() ?? ""
        for (const line of lines) {
          const m = /^frame=(\d+)/.exec(line.trim())
          if (m && onFrame) onFrame(parseInt(m[1]!, 10))
        }
      })

      proc.on("error", (err) => {
        clearTimeout(watchdog)
        reject(new Error(`ffmpeg failed to spawn: ${err.message}`))
      })
      proc.on("close", (code) => {
        clearTimeout(watchdog)
        if (timedOut) {
          reject(new Error(`ffmpeg timed out after ${timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS}ms`))
        } else if (code === 0) {
          resolve()
        } else {
          reject(new Error(ffmpegFailureMessage(stderrTail, `exit code ${code}`)))
        }
      })
    })
  } finally {
    release()
  }
}

/**
 * Log the installed ffmpeg version — one line, called once per process at
 * boot (API server + video worker). Rendered output is ffmpeg-version-
 * dependent (see the FFMPEG_VERSION pin in the Dockerfile), so when
 * production output changes, the logs must be able to answer "which
 * ffmpeg?". Non-fatal: a missing binary logs a loud error line here and
 * fails the first render anyway — boot must not die over logging.
 */
/**
 * Whether an ffmpeg run actually WROTE its output file (exists + non-empty).
 * ffmpeg exits 0 even when a seek lands past the last frame and ZERO frames
 * reach the encoder ("Output file is empty, nothing was encoded" is a warning,
 * not an error) — so a "successful" run must be verified before the output is
 * consumed, or the caller ENOENTs later on a file that was never written.
 */
export async function wroteOutputFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).size > 0
  } catch {
    return false
  }
}

let ffmpegVersionPromise: Promise<string> | undefined
/** The installed ffmpeg's first `-version` line (e.g. `ffmpeg version n8.1.2-…`),
 *  resolved once per process. Rendered output is ffmpeg-build-dependent, so
 *  render caches key on it. A failed probe is NOT memoized and resolves to
 *  "unknown" — a cache then misses (safe), it never matches wrongly. */
export function ffmpegVersionLine(): Promise<string> {
  ffmpegVersionPromise ??= runFfmpeg(["-version"]).then(
    (out) => out.split("\n", 1)[0].trim() || "unknown",
    () => {
      ffmpegVersionPromise = undefined
      return "unknown"
    },
  )
  return ffmpegVersionPromise
}

export function logFfmpegVersion(tag: string): void {
  execFile("ffmpeg", ["-version"], { timeout: 10_000 }, (error, stdout) => {
    if (error) {
      console.error(`[${tag}] ffmpeg -version failed (is ffmpeg installed?): ${error.message}`)
    } else {
      console.log(`[${tag}] ${stdout.split("\n", 1)[0]}`)
    }
  })
}

export function runFfprobe(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Watchdog: ffprobe accepts remote http(s) inputs (probeVideoSource) and
    // a stalled edge/socket would otherwise hang the worker indefinitely —
    // there is no BullMQ-side rescue for a live-but-stuck handler. 120s
    // matches the safeFetch download timeout.
    execFile("ffprobe", args as string[], { maxBuffer: 5 * 1024 * 1024, timeout: FFPROBE_TIMEOUT_MS }, (error, stdout, stderr) => {
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

/**
 * Probe the frame rate of a local video file. Falls back to 30fps if the
 * probe fails or returns something unparseable — a missing fps shouldn't
 * abort a frame-count-based trim.
 */
export async function getVideoFps(filePath: string): Promise<number> {
  try {
    const out = await runFfprobe([
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", filePath,
    ])
    const [n, d] = (csvFields(out)[0] ?? "").split("/").map(Number)
    const fps = d ? n / d : n
    return fps && Number.isFinite(fps) && fps > 0 ? fps : 30
  } catch {
    return 30
  }
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
 * Duration of the VIDEO STREAM (seconds) — NOT the container. AI-generated
 * clips routinely carry an audio track 40-90ms longer than the video, so the
 * container/format duration (getVideoDuration) overshoots the last video
 * frame. Anything computing FRAME positions (frame trims, concat boundaries,
 * xfade offsets) must use this instead: cutting at `formatDuration - N/fps`
 * lands past the video's end and silently under-trims by the overhang
 * (~1-2 frames). Falls back to the format duration when the stream doesn't
 * report one (rare containers).
 */
export async function getVideoStreamDuration(filePath: string): Promise<number> {
  const output = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=duration",
    "-of", "csv=p=0",
    filePath,
  ])
  const duration = parseFloat(output.trim())
  if (Number.isNaN(duration) || duration <= 0) {
    return getVideoDuration(filePath)
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
export async function assertSafeProbeSource(src: string): Promise<void> {
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
 * ffprobe reports a frame rate as the rational string "num/den" ("30000/1001").
 * A stream with no usable rate reports "0/0" — and a still-image or malformed
 * stream can report anything at all — so every unusable form answers `undefined`
 * rather than a made-up number: the caller decides the fallback.
 */
function parseFrameRate(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const [num, den] = value.trim().split("/")
  const n = Number(num)
  const d = den === undefined ? 1 : Number(den)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n <= 0) return undefined
  const fps = n / d
  return Number.isFinite(fps) && fps > 0 ? fps : undefined
}

/**
 * How far the clip's AVERAGE rate may sit from its nominal base rate before the
 * source counts as variable-frame-rate, as a fraction of the larger of the two.
 */
const VFR_RATE_TOLERANCE = 0.1

/**
 * The clip's CONSTANT frame rate, or `undefined` when it has none.
 *
 * `avg_frame_rate` is what the clip actually played at, `r_frame_rate` the
 * container's nominal base rate. When only one parses, that is the best answer
 * available. When both do and they DISAGREE by more than VFR_RATE_TOLERANCE, the
 * source is variable-frame-rate: neither number describes a constant rate (a
 * sparse screen recording reports an average of ~6 against a base of 60), so
 * re-encoding at either one is wrong — a bursty source rendered at its low
 * average decimates the real motion. Report no rate and let the caller fall back.
 */
function constantFrameRate(avg: number | undefined, nominal: number | undefined): number | undefined {
  if (avg === undefined) return nominal
  if (nominal === undefined) return avg
  const spread = Math.abs(avg - nominal) / Math.max(avg, nominal)
  return spread > VFR_RATE_TOLERANCE ? undefined : avg
}

/**
 * Probe a video URL for dimensions + duration (+ frame rate) in a single
 * ffprobe call. Accepts a local path OR a remote http(s) URL — ffprobe reads
 * both. Remote URLs go through assertSafeProbeSource first (SSRF guard); see
 * that helper.
 *
 * `fps` is OPTIONAL on purpose: dimensions and duration are the contract (a
 * missing one throws), but a container that reports no usable frame rate — or a
 * VARIABLE one, which is no single rate at all (see `constantFrameRate`) — is
 * still a perfectly probeable video, and the caller falls back rather than fails.
 */
export async function probeVideoSource(srcUrlOrPath: string): Promise<{
  width: number
  height: number
  durationSeconds: number
  fps?: number
}> {
  await assertSafeProbeSource(srcUrlOrPath)
  const output = await runFfprobe([
    "-v", "error",
    // Confine ffprobe to file + http(s) transport so a malicious manifest
    // can't pivot to other protocols. Keep `file` so local-path probes work.
    "-protocol_whitelist", "file,http,https,tcp,tls",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate:format=duration",
    "-of", "json",
    srcUrlOrPath,
  ])
  // CSV inserts extra fields for stream side data (including an empty field
  // on Remotion MP4s). Read named fields so metadata cannot shift dimensions.
  let metadata: {
    streams?: Array<{ width?: unknown; height?: unknown; avg_frame_rate?: unknown; r_frame_rate?: unknown }>
    format?: { duration?: unknown }
  }
  try {
    metadata = JSON.parse(output)
  } catch {
    throw new Error(`probeVideoSource failed to parse: "${output.trim()}"`)
  }
  const width = Number(metadata?.streams?.[0]?.width)
  const height = Number(metadata?.streams?.[0]?.height)
  const durationSeconds = Number(metadata?.format?.duration)
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0
    || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`probeVideoSource failed to parse: "${output.trim()}"`)
  }
  const fps = constantFrameRate(
    parseFrameRate(metadata?.streams?.[0]?.avg_frame_rate),
    parseFrameRate(metadata?.streams?.[0]?.r_frame_rate),
  )
  return { width, height, durationSeconds, ...(fps !== undefined ? { fps } : {}) }
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

/** One track of a source file, as the window check sees it. */
export type TrackEnd =
  /** The file carries no such track (cover art is not a picture track). */
  | { readonly state: "absent" }
  /** The track's real end, in seconds on the RENDER's clock. */
  | { readonly state: "measured"; readonly endSec: number }
  /** The track is there but its end could not be read (no timestamps, or the scan failed).
   *  `declaredEndSec` is set ONLY for a re-anchoring container (MPEG-TS/PS) whose
   *  timestamps run continuously (never back, never forward past the CLI's
   *  fold threshold — see `dtsContinuity`): its `format.duration` is then the span of
   *  every stream, which on the render's clock can only OVER-state a track's end
   *  — a coarse upper bound the window check may refuse against without ever
   *  refusing a correct edit. A TS/PS file whose timestamps jump BACK (two
   *  recordings joined, a stream reconnect, a restarted encoder) gets none:
   *  ffprobe's duration is then last-minus-first timestamp and UNDER-states the
   *  content the render plays straight through (a 20 s joined file declares
   *  10 s). A plain scan failure gets none either: there the declaration can
   *  UNDER-report too (a Xing-less VBR mp3 of 600 s declares 554 s). */
  | { readonly state: "unmeasured"; readonly reason: string; readonly declaredEndSec?: number }

/** The picture and sound tracks of one source file. */
export interface StreamEnds {
  readonly video: TrackEnd
  readonly audio: TrackEnd
}

/**
 * The REAL end of a local media file's picture and sound tracks, on the clock
 * the render's `trim` / `atrim` run on — measured from each track's own
 * packets (demux only, no decode), never from anything the container declares
 * and never as a single number for the whole file.
 *
 * Why not `format=duration` (`probeMediaDuration`): it is a declaration the
 * container can get wrong or leave out. An mp3 without a Xing/Info header (or
 * with a stale one — a re-cut or ad-stitched podcast file) is bitrate-
 * extrapolated and under-reports by seconds that GROW with the file (a 30 s
 * VBR encode declares 27.85 s; 600 s declares 554 s); a live-muxed WebM /
 * Matroska (a browser MediaRecorder recording) declares nothing (`N/A`).
 *
 * Why not one `-c copy -f null` pass: its `out_time` is the muxer's clock —
 * the last packet's DTS plus its duration, blended across streams. With
 * B-frames that trails the true (PTS) end by the reorder delay in frame
 * spacing — seconds on a 1 fps still-image encode; cover art mapped as video
 * made it N/A on ffmpeg 8.1; and one number cannot describe a file whose
 * picture and sound differ in length.
 *
 * How each track is read:
 *  - The stream is chosen by `parseStreamListing`: the first REAL video stream
 *    (never `attached_pic` cover art) and the first audio stream — the same
 *    streams the render binds (`[i:V]`, `[i:a]`).
 *  - Its end is max(pts + duration) over its packets, skipping packets the
 *    demuxer flags D (discard) — frames past a tail-trimming mp4/mov edit list
 *    the decoder drops, which `trim` can never reach. A stream with no pts on
 *    ANY packet (AVI) falls back to max(dts + duration).
 *  - The file's `format.start_time` is subtracted: without `-copyts` the
 *    ffmpeg CLI shifts every input by it before any filter sees a frame, so an
 *    offset MKV/MP4 or an mp4 with an initial empty edit would otherwise
 *    over-report by exactly that offset. A negative start (encoder priming) is
 *    handled the same way. EXCEPTION: MPEG-TS / program-stream containers
 *    re-anchor to the earliest MAPPED stream (which chunking changes), so
 *    `format.start_time` is not the render's zero for them — both tracks come
 *    back `unmeasured`. Their declared duration is attached as a coarse upper
 *    bound only when a packet scan of every mapped track shows its DTS running
 *    continuously; otherwise the window check is skipped for the source
 *    rather than made wrong.
 *
 * Cost is I/O only and scales with file size. Packet lines are STREAMED (a
 * two-hour track is several MB of csv — past `runFfprobe`'s buffer). Local
 * paths only (no network, no SSRF surface). Throws only when the stream
 * listing itself cannot be read; a track whose scan fails, or that carries no
 * timestamps, comes back `unmeasured` with the reason, and the other track is
 * still measured.
 */
export async function probeStreamEnds(filePath: string): Promise<StreamEnds> {
  const listing = await runFfprobe([
    "-v", "error",
    "-show_entries", "format=start_time,duration,format_name:stream=index,codec_type:stream_disposition=attached_pic",
    "-of", "json",
    filePath,
  ])
  const { video, audio, startSec, reAnchors, declaredSec } = parseStreamListing(listing)
  if (reAnchors) {
    // The container's timestamps do not share the render's clock (see the
    // docstring) — measuring per track against them would refuse correct edits
    // or pass bad ones. Its declared duration (the span of every stream) is a
    // safe UPPER bound instead — but only while the timestamps run forward: a
    // backward jump makes it UNDER-state the content (see `TrackEnd`), and a
    // bound that refuses correct paid edits is worse than none. When it holds,
    // the window check refuses past it + a wider tolerance, so an overrun
    // cannot deliver minutes of frozen picture.
    const mapped = [video, audio].filter((i): i is number => i !== undefined)
    const continuity = declaredSec !== undefined ? await dtsContinuity(filePath, mapped) : undefined
    const base = "MPEG-TS/PS container re-anchors timestamps; not on the render's clock"
    const unmeasured: TrackEnd = {
      state: "unmeasured",
      reason: continuity === undefined || continuity === "monotonic"
        ? base
        : `${base}; ${continuity}, so its declared length is no bound`,
      ...(declaredSec !== undefined && continuity === "monotonic" ? { declaredEndSec: declaredSec } : {}),
    }
    return {
      video: video === undefined ? { state: "absent" } : unmeasured,
      audio: audio === undefined ? { state: "absent" } : unmeasured,
    }
  }
  const measure = async (index: number | undefined): Promise<TrackEnd> => {
    if (index === undefined) return { state: "absent" }
    try {
      const { maxPtsEnd, maxDtsEnd } = await scanPacketEnds(filePath, index)
      const end = maxPtsEnd ?? maxDtsEnd
      return end === undefined
        ? { state: "unmeasured", reason: `stream ${index} carries no packet timestamps` }
        : { state: "measured", endSec: end - startSec }
    } catch (err) {
      return { state: "unmeasured", reason: err instanceof Error ? err.message : String(err) }
    }
  }
  return { video: await measure(video), audio: await measure(audio) }
}

/** From an ffprobe `-show_entries format=start_time,duration,format_name:
 *  stream=index,codec_type:stream_disposition=attached_pic -of json` listing:
 *  the first REAL video stream (not cover art) and the first audio stream, by
 *  index, the file's start time in seconds (0 when the container reports none),
 *  `reAnchors` — whether the container re-anchors timestamps to the earliest
 *  mapped stream (MPEG-TS / program stream), so `format.start_time` is not the
 *  render's zero — and `declaredSec`, the container's declared duration when it
 *  reports a positive one. Exported for its unit test. */
export function parseStreamListing(listingJson: string): { video?: number; audio?: number; startSec: number; reAnchors: boolean; declaredSec?: number } {
  let parsed: {
    streams?: Array<{ index?: number; codec_type?: string; disposition?: { attached_pic?: number } }>
    format?: { start_time?: string; duration?: string; format_name?: string }
  }
  try {
    parsed = JSON.parse(listingJson) as typeof parsed
  } catch {
    throw new Error(`probeStreamEnds: ffprobe stream listing is not JSON: "${listingJson.slice(0, 80)}"`)
  }
  const streams = parsed.streams ?? []
  const video = streams.find((s) => s.codec_type === "video" && !(s.disposition?.attached_pic ?? 0))?.index
  const audio = streams.find((s) => s.codec_type === "audio")?.index
  const start = Number(parsed.format?.start_time)
  // ffprobe joins comma-separated demuxer names, e.g. "mpegts" or "mpeg".
  const names = (parsed.format?.format_name ?? "").split(",").map((n) => n.trim())
  const reAnchors = names.includes("mpegts") || names.includes("mpegtsraw") || names.includes("mpeg")
  const declared = Number(parsed.format?.duration)
  return {
    ...(typeof video === "number" ? { video } : {}),
    ...(typeof audio === "number" ? { audio } : {}),
    startSec: Number.isFinite(start) ? start : 0,
    reAnchors,
    ...(Number.isFinite(declared) && declared > 0 ? { declaredSec: declared } : {}),
  }
}

/** Do these tracks' packet DTS run continuously? "monotonic" when every track
 *  has DTS and none jumps; otherwise a short reason. A jump is either a step
 *  BACK — within one stream DTS is non-decreasing even with B-frames (PTS is
 *  what reorders) — or a step FORWARD past where the previous packet ENDS
 *  (dts + duration, the CLI's own `next_dts` prediction) by more than
 *  `DTS_JUMP_THRESHOLD_SEC`, the CLI's `-dts_delta_threshold` (so a still-image
 *  stream whose frames each last 12 s is continuous, as the CLI sees it): both are discontinuities the
 *  CLI folds away at render time, so the content plays straight through while
 *  `format.duration` (last minus first timestamp) says something else. The
 *  forward case matters: libavformat treats a timestamp more than 60 s below
 *  the first one as a 33-bit wrap and adds 2^33 ticks, so a recording that
 *  restarted its clock reads as one ~26.5 h forward step (a genuine wrap, which
 *  libavformat unwraps into continuous timestamps, stays monotonic). A scan
 *  that fails is reported, never treated as continuous. */
export const DTS_JUMP_THRESHOLD_SEC = 10

async function dtsContinuity(filePath: string, streamIndices: readonly number[]): Promise<string> {
  if (streamIndices.length === 0) return "no mapped track to scan"
  for (const index of streamIndices) {
    try {
      const { dtsSteps } = await scanPacketEnds(filePath, index)
      if (dtsSteps === "none") return `stream ${index} carries no DTS`
      if (dtsSteps === "discontinuous") return `stream ${index}'s timestamps jump (back, or forward by more than ${DTS_JUMP_THRESHOLD_SEC} s — a joined or reconnected recording)`
    } catch (err) {
      return `stream ${index} could not be scanned (${err instanceof Error ? err.message : String(err)})`
    }
  }
  return "monotonic"
}

/** One packet csv line — ffprobe always writes the fields in its own order,
 *  `pts_time,dts_time,duration_time,flags`, whatever order they are requested
 *  in. Exported for its unit test. */
export function parsePacketLine(line: string): { pts?: number; dts?: number; dur: number; discard: boolean } | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  const [pts, dts, dur, flags] = trimmed.split(",")
  const num = (v: string | undefined): number | undefined => {
    if (v === undefined || v === "" || v === "N/A") return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const p = num(pts)
  const d = num(dts)
  return {
    ...(p !== undefined ? { pts: p } : {}),
    ...(d !== undefined ? { dts: d } : {}),
    dur: num(dur) ?? 0,
    discard: (flags ?? "").includes("D"),
  }
}

/** Stream one track's packet list through ffprobe; keep the max PTS end and,
 *  for a stream with no pts at all, the max DTS end, and whether its DTS ever
 *  JUMPS — back, or forward past `DTS_JUMP_THRESHOLD_SEC` (`dtsSteps`, read by
 *  `dtsContinuity`). Discarded packets never count. */
function scanPacketEnds(filePath: string, streamIndex: number): Promise<{ maxPtsEnd?: number; maxDtsEnd?: number; dtsSteps: "monotonic" | "discontinuous" | "none" }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", String(streamIndex),
      "-show_entries", "packet=pts_time,dts_time,duration_time,flags",
      "-of", "csv=p=0",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] })

    let timedOut = false
    const watchdog = setTimeout(() => {
      timedOut = true
      proc.kill("SIGKILL")
    }, DEFAULT_FFMPEG_TIMEOUT_MS)

    let maxPtsEnd: number | undefined
    let maxDtsEnd: number | undefined
    let lastDts: number | undefined
    let lastDur = 0
    let dtsJumps = false
    let lineBuf = ""
    const take = (line: string) => {
      const pkt = parsePacketLine(line)
      if (!pkt || pkt.discard) return
      if (pkt.pts !== undefined && (maxPtsEnd === undefined || pkt.pts + pkt.dur > maxPtsEnd)) maxPtsEnd = pkt.pts + pkt.dur
      if (pkt.dts !== undefined && (maxDtsEnd === undefined || pkt.dts + pkt.dur > maxDtsEnd)) maxDtsEnd = pkt.dts + pkt.dur
      if (pkt.dts !== undefined) {
        if (lastDts !== undefined && (pkt.dts < lastDts || pkt.dts - (lastDts + lastDur) > DTS_JUMP_THRESHOLD_SEC)) dtsJumps = true
        lastDts = pkt.dts
        lastDur = pkt.dur
      }
    }
    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuf += chunk.toString()
      const lines = lineBuf.split("\n")
      lineBuf = lines.pop() ?? ""
      for (const line of lines) take(line)
    })
    let stderrTail = ""
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2048)
    })
    proc.on("error", (err) => {
      clearTimeout(watchdog)
      reject(new Error(`ffprobe failed to spawn: ${err.message}`))
    })
    proc.on("close", (code) => {
      clearTimeout(watchdog)
      if (lineBuf) take(lineBuf)
      if (timedOut) reject(new Error(`probeStreamEnds: ffprobe timed out after ${DEFAULT_FFMPEG_TIMEOUT_MS}ms on stream ${streamIndex}`))
      else if (code !== 0) reject(new Error(`probeStreamEnds: ffprobe exit ${code} on stream ${streamIndex}: ${stderrTail.trim() || "no output"}`))
      else resolve({
        ...(maxPtsEnd !== undefined ? { maxPtsEnd } : {}),
        ...(maxDtsEnd !== undefined ? { maxDtsEnd } : {}),
        dtsSteps: lastDts === undefined ? "none" : dtsJumps ? "discontinuous" : "monotonic",
      })
    })
  })
}

export interface MediaStreams {
  /** At least one REAL video stream — embedded cover art (attached_pic) does not count. */
  readonly hasVideo: boolean
  /** At least one audio stream. */
  readonly hasAudio: boolean
}

/**
 * What streams does this media ACTUALLY carry? One ffprobe call, JSON out.
 *
 * The container, the extension, the client MIME and the input slot a file
 * arrived through can all lie: an audio-only M4A is happily served as
 * `video/mp4` from `uploads/videos/` (incident 2026-08-30, voice-changer-pro —
 * the paid speech-to-speech pass ran, then the remux died at `-map 0:v`). The
 * stream list is the only honest signal, so anything that must choose between
 * an audio path and a video path decides on THIS, never on the slot.
 *
 * `hasVideo` ignores `disposition.attached_pic` streams — a podcast MP3 with
 * cover art has an mjpeg/png "video" stream that is a still picture, and
 * mapping it as video would be the same class of lie in the other direction.
 *
 * Accepts a local path OR a remote http(s) URL; remote URLs go through the
 * SSRF guard (assertSafeProbeSource) before ffprobe touches the network.
 * Throws (never guesses) when ffprobe's output is not parseable — callers
 * that want a fail-open decision catch and fall back on the slot's word.
 */
export async function probeMediaStreams(srcUrlOrPath: string): Promise<MediaStreams> {
  await assertSafeProbeSource(srcUrlOrPath)
  const output = await runFfprobe([
    "-v", "error",
    "-protocol_whitelist", "file,http,https,tcp,tls",
    "-show_entries", "stream=codec_type:stream_disposition=attached_pic",
    "-of", "json",
    srcUrlOrPath,
  ])
  let parsed: { streams?: unknown }
  try {
    parsed = JSON.parse(output) as { streams?: unknown }
  } catch {
    throw new Error(`probeMediaStreams failed to parse: "${output.trim().slice(0, 200)}"`)
  }
  if (!Array.isArray(parsed.streams)) {
    throw new Error(`probeMediaStreams: no stream list in ffprobe output: "${output.trim().slice(0, 200)}"`)
  }
  const streams = parsed.streams as Array<{ codec_type?: unknown; disposition?: { attached_pic?: unknown } }>
  const hasVideo = streams.some(
    (s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1,
  )
  const hasAudio = streams.some((s) => s.codec_type === "audio")
  return { hasVideo, hasAudio }
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
  // ffprobe CSV output: "h264,yuv420p" (see csvFields for the shapes a plain split misreads)
  const parts = csvFields(output.toLowerCase())
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
 * CRF for every re-encode on the COMBINE/DELIVERY path — clip normalization,
 * smart-cut edge trims, and the xfade renders in combine-videos.ts. The
 * inputs are already-compressed AI segments, and this is the encode the user
 * actually receives: x264's default 23 (and the explicit 23 normalize used
 * to carry) halved the delivered bitrate at the very last step (job
 * 08f99f85: 2.2–2.5 Mbps segments → 1.19 Mbps final; the cut path even
 * stacks normalize + trim, two such generations before its stream-copy
 * concat). 18 is the visually-lossless norm; the size cost lands on one
 * deliverable file, not a library.
 */
export const COMBINE_DELIVERY_CRF = "18"

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
 * Trim N frames off the start and/or end of a clip (re-encode). Shared by
 * combine-videos.ts (clip-boundary seam trim between combined clips) and
 * assemble-narrated-video.ts (interior block-join seam trim) — both callers
 * are responsible for zeroing out the start/end frame count on edges that
 * must stay untouched (e.g. the very first clip's start, the very last
 * clip's end) BEFORE calling this, since this helper has no notion of clip
 * position.
 *
 * Probes fps + duration, converts frame counts to seconds, then:
 *   - returns `inputPath` unchanged when both `trimStartFrames` and
 *     `trimEndFrames` are <= 0 (nothing requested — skips the probe too)
 *   - returns `inputPath` unchanged when the combined trim would meet or
 *     exceed the clip's duration (would leave nothing to keep)
 *   - otherwise re-encodes to `outputPath` via `-ss`/`-to` and returns it
 */
export async function trimEdgeFrames(
  inputPath: string,
  outputPath: string,
  trimStartFrames: number,
  trimEndFrames: number,
  opts?: {
    /** End-trim the VIDEO only, keeping the audio through the clip's
     *  ORIGINAL end (fix 2a, field report 2026-07-25 "voice was cut"): at a
     *  matched smart-cut boundary the dropped tail frames are DUPLICATED
     *  video, but their audio is unique speech — continuation models
     *  re-render the video overlap yet generate fresh audio (measured:
     *  next-head audio holds no copy of prev's tail, xcorr |r|≈0.1). The
     *  caller MUST route such a clip through a filter graph that re-anchors
     *  audio (combine's L-cut amix); the concat demuxer joins streams
     *  independently and would drift on the longer audio track. */
    preserveAudioTail?: boolean
  },
): Promise<string> {
  if (trimStartFrames <= 0 && trimEndFrames <= 0) return inputPath

  const fps = await getVideoFps(inputPath)
  // VIDEO STREAM duration, not container: the container includes the audio
  // overhang AI clips ship (~1-2 frames' worth), so an end cut computed from
  // it lands past the last video frame and silently trims fewer frames than
  // requested (regression caught by smart cut, which needs exact indices).
  const duration = await getVideoStreamDuration(inputPath)
  const startSec = trimStartFrames / fps
  const endSec = trimEndFrames / fps

  if (startSec + endSec >= duration) return inputPath

  if (opts?.preserveAudioTail && trimEndFrames > 0) {
    await runFfmpeg([
      "-y", "-i", inputPath,
      "-filter_complex",
      `[0:v]trim=start=${startSec}:end=${duration - endSec},setpts=PTS-STARTPTS[v];` +
        `[0:a]atrim=start=${startSec},asetpts=PTS-STARTPTS[a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "fast", "-crf", COMBINE_DELIVERY_CRF, "-c:a", "aac", outputPath,
    ])
    return outputPath
  }

  const args = ["-y", "-i", inputPath]
  if (trimStartFrames > 0) args.push("-ss", String(startSec))
  // Also bounds the AUDIO to the video's cut point, killing the overhang on
  // trimmed clips — concat boundaries then match the video exactly.
  if (trimEndFrames > 0) args.push("-to", String(duration - endSec))
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", COMBINE_DELIVERY_CRF, "-c:a", "aac", outputPath)

  await runFfmpeg(args)
  return outputPath
}

/**
 * Cap a video to its first `maxFrames` video frames (frame-accurate via
 * `-frames:v` + re-encode, so the cut lands on the exact frame rather than the
 * next keyframe). Audio is trimmed to match via `-shortest`. Used by the SwitchX
 * worker to fit a source that's slightly over Beeble's 240-frame cap.
 */
export async function capVideoToFrames(
  inputPath: string,
  outputPath: string,
  maxFrames: number,
): Promise<string> {
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-frames:v", String(maxFrames),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "fast",
    "-crf", "20",
    "-c:a", "copy",
    "-shortest",
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
 * AAC audio at 44.1kHz stereo, and — crucially — scaled and letterboxed to
 * exactly `targetWidth`×`targetHeight`. xfade/acrossfade and the concat
 * filter all require every input to share the same resolution, so a single
 * odd-sized clip would otherwise abort the whole combine.
 *
 * The `-ar`/`-ac` pin matters as much as the resolution: providers emit
 * clips at 32/44.1/48kHz, and the combine cut path splices normalized clips
 * with `-f concat -c copy`, which stamps the whole output track with the
 * FIRST clip's decoder config. A later clip at another rate then plays at
 * the wrong speed/pitch and desyncs from its video (job 3dca9c76). Same
 * pin as runBlockFit's block encode in assemble-narrated-video.ts.
 */
export async function normalizeVideoForCombine(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number,
  // The ONE frame rate every clip in a set is conformed to — the frame-index
  // trims and the smart-cut matcher need it uniform. combine-videos tallies it
  // from the sources (pickTargetFps) so two 30 fps clips stay 30 fps; the
  // fixed 24 this used to be resampled them, dropping one frame in five
  // (job 597dcf72, 2026-09-08). 24 stays the default for callers that never
  // pass one, so their output is byte-for-byte what it was.
  targetFps: number = 24,
): Promise<string> {
  // Output dimensions must be even for yuv420p.
  const w = targetWidth - (targetWidth % 2)
  const h = targetHeight - (targetHeight % 2)
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-vf", `fps=${targetFps},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", COMBINE_DELIVERY_CRF,
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart",
    outputPath,
  ])
  return outputPath
}

// Containers the video-analysis consumer accepts directly — everything else is
// remuxed into .mp4 first. Extension-only decision (case-insensitive); the
// actual per-stream codec fix-up happens in buildRemuxArgs / remuxToMp4.
const REMUX_PASS_THROUGH_EXTS = new Set(["mp4", "webm", "mov"])

/**
 * True when a media file must be remuxed into an MP4 container before the
 * downstream consumer can read it. False for the already-safe containers
 * (.mp4/.webm/.mov), true for everything else (.mkv, .avi, …). Accepts a full
 * path OR a bare extension ("mkv", ".mkv") — case-insensitive on the extension.
 */
export function needsContainerRemux(pathOrExt: string): boolean {
  const lower = pathOrExt.toLowerCase()
  const dotIdx = lower.lastIndexOf(".")
  // No dot → treat the whole string as a bare extension (the "Ext" form).
  const ext = dotIdx >= 0 ? lower.slice(dotIdx + 1) : lower
  return !REMUX_PASS_THROUGH_EXTS.has(ext)
}

/**
 * Build the ffmpeg args to remux `input` into an MP4 at `output`. The video
 * stream is always stream-copied (`-c:v copy` — no re-encode, near-instant).
 * Audio recipe, keyed on the probed source audio codec:
 *   - aac / mp3        → `-c:a copy` (already MP4-muxer-safe)
 *   - any other codec  → `-c:a aac`  (the MP4 muxer rejects Opus/PCM — common
 *                          in yt-dlp .mkv/.webm payloads; an audio-only
 *                          re-encode is cheap next to a video re-encode)
 *   - null (no audio)  → no `-c:a` flags at all (audio-less source)
 */
export function buildRemuxArgs(input: string, output: string, audioCodec: string | null): string[] {
  const args = ["-y", "-i", input, "-c:v", "copy"]
  if (audioCodec !== null) {
    const muxerSafe = audioCodec === "aac" || audioCodec === "mp3"
    args.push("-c:a", muxerSafe ? "copy" : "aac")
  }
  args.push("-movflags", "+faststart", output)
  return args
}

/**
 * Probe the codec_name of the FIRST audio stream (a:0). Returns null when the
 * source has no audio stream at all (ffprobe prints nothing). LOCAL file only
 * (no network), so no SSRF guard is needed. Mirrors probeVideoStream's shape.
 */
async function probeFirstAudioCodec(filePath: string): Promise<string | null> {
  const output = await runFfprobe([
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=codec_name",
    "-of", "csv=p=0",
    filePath,
  ])
  const codec = (csvFields(output.toLowerCase())[0] ?? "")
  return codec.length > 0 ? codec : null
}

/**
 * Remux any container into MP4: video stream copied untouched, audio kept when
 * already MP4-muxer-safe (aac/mp3) else re-encoded to AAC. Probes the source
 * audio codec first (absent stream → audio-less remux), then runs a single
 * semaphore-gated ffmpeg spawn (remux is cheap but is still a real spawn).
 */
export async function remuxToMp4(inputPath: string, outputPath: string): Promise<void> {
  const audioCodec = await probeFirstAudioCodec(inputPath)
  await runFfmpeg(buildRemuxArgs(inputPath, outputPath, audioCodec))
}

/**
 * ffmpeg args to lay the audio of `audioSource` onto the video of `video`,
 * without re-encoding the picture. Used to restore sound onto a Remotion
 * render whose input video was transcoded audio-less (`-an`) for fast frame
 * seeking — the composition therefore has no audio, and its own (silent)
 * track is dropped in favour of the source's. `-shortest` guards a source
 * whose audio runs a hair longer than the render.
 */
export function buildAudioOntoVideoArgs(video: string, audioSource: string, output: string, audioCodec: string): string[] {
  const muxerSafe = audioCodec === "aac" || audioCodec === "mp3"
  return [
    "-y",
    "-i", video,
    "-i", audioSource,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", muxerSafe ? "copy" : "aac",
    "-shortest",
    "-movflags", "+faststart",
    output,
  ]
}

/**
 * Restore audio onto a captioned (or otherwise re-rendered) video by copying
 * the first audio stream of `audioSource` over it. No-op returning false when
 * the source has no audio stream, so a genuinely silent input stays silent
 * and the caller keeps the original file. Local files only.
 */
export async function restoreVideoAudioFromSource(video: string, audioSource: string, output: string): Promise<boolean> {
  const audioCodec = await probeFirstAudioCodec(audioSource)
  if (audioCodec === null) return false
  await runFfmpeg(buildAudioOntoVideoArgs(video, audioSource, output, audioCodec))
  return true
}
