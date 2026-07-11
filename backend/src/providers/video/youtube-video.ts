import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { promises as fs, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import {
  YOUTUBE_HOSTS,
  hostnameMatchesAllowlist,
  isAllowedSocialVideoUrl,
} from "../../lib/url-validator.js"

/**
 * Shared yt-dlp video provider — the single source of the android
 * player_client + UA spoof for the VIDEO download path.
 *
 * Extracted from `routes/download-video.ts` so the download-video route AND
 * the video-analysis worker call ONE spoofed/allowlisted implementation. Two
 * entry points:
 *   - `downloadYouTubeVideo` — download + h264 normalize (accepts the BROAD
 *     social allowlist, matching the download-video route's pre-existing
 *     TikTok/Instagram/X/Facebook support).
 *   - `ytMetadataProbe` — YouTube-ONLY `--dump-json` probe with a hard
 *     subprocess timeout (used to bucket duration before enqueuing analysis).
 *
 * Both validate the host BEFORE spawning yt-dlp: yt-dlp does its own DNS+HTTP
 * (bypassing `safeFetch`), so the exact-suffix allowlist IS the SSRF gate.
 */

const isWindows = process.platform === "win32"
const require = createRequire(import.meta.url)

/**
 * Resolve the yt-dlp binary — in the SAME order `youtube-dl-exec` itself does,
 * so the library-based callers (trim-audio, youtube-extractor, youtube-audio,
 * workers/shared) and this direct-spawn path can never disagree about which
 * binary runs.
 *
 * WHY this is not just `<pkg>/bin/yt-dlp`: the image sets
 * `YOUTUBE_DL_SKIP_DOWNLOAD=1` (deps AND prod-deps stages), which tells
 * `youtube-dl-exec`'s postinstall NOT to fetch that binary — deliberately, since
 * a system yt-dlp was apt-installed instead. But nothing ever pointed the code at
 * the system one, so every yt-dlp path in the platform spawned a file that does
 * not exist and died with `ENOENT`, silently (see the route's catch). The image
 * now installs the official pinned binary and sets `YOUTUBE_DL_DIR`; honour that
 * first, then the bundled copy (local dev, where the download is not skipped),
 * then a bare PATH lookup.
 */
export function resolveYtDlpBin(env: NodeJS.ProcessEnv = process.env): string {
  const name = `yt-dlp${isWindows ? ".exe" : ""}`
  if (env.YOUTUBE_DL_DIR) {
    const fromEnv = join(env.YOUTUBE_DL_DIR, env.YOUTUBE_DL_FILENAME ?? name)
    if (existsSync(fromEnv)) return fromEnv
  }
  const bundled = join(
    dirname(require.resolve("youtube-dl-exec/package.json")),
    "bin",
    name,
  )
  if (existsSync(bundled)) return bundled
  // Last resort: let the OS find it on PATH rather than spawning a path we
  // already know does not exist (which is what produced the silent ENOENT).
  return name
}

const YT_DLP_BIN = resolveYtDlpBin()

/**
 * android player_client + referer/UA spoof — the ONLY copy for the video
 * path. Shared verbatim between the download and metadata-probe calls so a
 * change to the spoof identity can't drift between the two.
 */
const YT_SPOOF_ARGS = [
  "--extractor-args", "youtube:player_client=android",
  "--add-header", "referer:youtube.com",
  "--add-header", "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
] as const

/** Thrown when a URL's host is not on the relevant yt-dlp allowlist (SSRF gate). */
export class YtUrlNotAllowedError extends Error {}

/**
 * Replace the output path's extension with yt-dlp's `%(ext)s` template so the
 * downloaded video AND its sidecar thumbnail land on the same basename (the
 * download-video route finds the thumbnail by that basename).
 */
function deriveOutputTemplate(outPath: string): string {
  return outPath.replace(/\.[^./\\]+$/, "") + ".%(ext)s"
}

/**
 * yt-dlp video download args. Exported for testability. Adds
 * `--max-filesize <N>M` only when `maxFilesizeBytes` is provided (the
 * video-analysis path caps download size; the download-video route does not).
 */
export function buildYtDlpVideoArgs(opts: {
  url: string
  outPath: string
  maxFilesizeBytes?: number
}): string[] {
  const args = [
    opts.url,
    "--format", "mp4/best",
    "--output", deriveOutputTemplate(opts.outPath),
    "--no-playlist",
    "--no-check-certificates",
    "--merge-output-format", "mp4",
    "--write-thumbnail",
    "--convert-thumbnails", "jpg",
    ...YT_SPOOF_ARGS,
    "--newline",
    "--progress-template", "download:%(progress._percent_str)s",
  ]
  if (opts.maxFilesizeBytes && opts.maxFilesizeBytes > 0) {
    const mb = Math.round(opts.maxFilesizeBytes / (1024 * 1024))
    args.push("--max-filesize", `${mb}M`)
  }
  return args
}

/**
 * Run yt-dlp and resolve its stdout. Unlike the streaming download path this
 * captures full stdout and enforces an explicit `timeoutMs` (kill + reject on
 * expiry) — the metadata probe must never hang the caller. NO other yt-dlp
 * call in the codebase has a timeout; do not inherit this into the download.
 */
function runYtDlp(args: string[], opts: { timeoutMs: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      proc.kill("SIGKILL")
      finish(() => reject(new Error(`yt-dlp timed out after ${opts.timeoutMs}ms`)))
    }, opts.timeoutMs)
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on("error", (err) => finish(() => reject(err)))
    proc.on("close", (code) => finish(() => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim().split("\n").pop() || `yt-dlp exited with code ${code}`))
    }))
  })
}

/**
 * YouTube-ONLY metadata probe. Validates the host against the NARROW
 * `YOUTUBE_HOSTS` list BEFORE spawning (throws `YtUrlNotAllowedError`), then
 * `--dump-json --skip-download --no-playlist` with the shared spoof and a
 * 15s hard timeout. Returns null fields when yt-dlp omits them.
 */
export async function ytMetadataProbe(
  url: string,
): Promise<{ durationSec: number | null; title: string | null; isLive: boolean }> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new YtUrlNotAllowedError(`invalid url: ${url}`)
  }
  if (!hostnameMatchesAllowlist(host, YOUTUBE_HOSTS)) {
    throw new YtUrlNotAllowedError(`host not allowed: ${host}`)
  }
  const raw = await runYtDlp(
    ["--dump-json", "--skip-download", "--no-playlist", ...YT_SPOOF_ARGS, url],
    { timeoutMs: 15_000 },
  )
  const meta = JSON.parse(raw) as { duration?: number | null; title?: string | null; is_live?: boolean }
  return {
    durationSec: typeof meta.duration === "number" ? meta.duration : null,
    title: meta.title ?? null,
    isLive: meta.is_live === true,
  }
}

/**
 * yt-dlp can emit `.mkv/.webm/...` despite `--merge-output-format mp4` when a
 * remux is impossible. Resolve the file it actually produced: the expected
 * `outPath` first, then the same basename with a known video extension.
 */
async function findDownloadedFile(outPath: string): Promise<string> {
  try {
    await fs.access(outPath)
    return outPath
  } catch {
    const base = outPath.replace(/\.[^./\\]+$/, "")
    for (const ext of [".mkv", ".webm", ".mov", ".avi", ".flv"]) {
      const alt = base + ext
      try {
        await fs.access(alt)
        return alt
      } catch {
        continue
      }
    }
    throw new Error("yt-dlp did not produce an output file")
  }
}

/** True iff the first video stream is h264 (ffprobe). Never rejects. */
function isH264(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name",
      "-of", "csv=p=0",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] })

    // Watchdog: a corrupt download can wedge ffprobe; local probes finish in
    // well under a second, so 30s is purely a leak guard.
    const watchdog = setTimeout(() => proc.kill("SIGKILL"), 30_000)
    let stdout = ""
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.on("close", (code) => {
      clearTimeout(watchdog)
      resolve(code === 0 && stdout.trim() === "h264")
    })
    proc.on("error", () => { clearTimeout(watchdog); resolve(false) })
  })
}

/** Re-encode to h264/aac mp4 for downstream compatibility. Rejects on failure. */
function reencodeToH264(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", inputPath,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ], { stdio: ["ignore", "ignore", "pipe"] })

    // Watchdog: an ffmpeg wedged on corrupt input would leak the process and
    // strand the download in "processing" forever. 10min matches the worker
    // wrappers' DEFAULT_FFMPEG_TIMEOUT_MS — far above any legit re-encode.
    const watchdog = setTimeout(() => proc.kill("SIGKILL"), 10 * 60 * 1000)
    let stderrBuf = ""
    proc.stderr.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString() })
    proc.on("close", (code) => {
      clearTimeout(watchdog)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg re-encode exited with code ${code}: ${stderrBuf.trim().split("\n").pop()}`))
    })
    proc.on("error", (err) => { clearTimeout(watchdog); reject(err) })
  })
}

/**
 * Download a social video (YouTube/TikTok/Instagram/X/Facebook) to `outPath`
 * as an h264/aac mp4. Validates the host against the BROAD social allowlist
 * BEFORE spawning (SSRF gate — the worker calls this directly), applies the
 * android player_client + UA spoof, optionally caps size, then re-encodes to
 * h264 when the download isn't already h264. Throws on any failure.
 *
 * Progress reporting (both optional, used by the SSE download-video route):
 *   - `onProgress(pct)` — download percent (0–100) as yt-dlp reports it.
 *   - `onProcessingStart()` — fired once, right before the h264 re-encode
 *     begins, so callers can surface a distinct "processing" phase.
 */
export async function downloadYouTubeVideo(opts: {
  url: string
  outPath: string
  maxFilesizeBytes?: number
  onProgress?: (pct: number) => void
  onProcessingStart?: () => void
}): Promise<void> {
  const { url, outPath, maxFilesizeBytes, onProgress, onProcessingStart } = opts

  // SSRF gate — same broad allowlist the download-video route accepted before
  // extraction, so TikTok/Instagram/X/Facebook support is preserved.
  if (!isAllowedSocialVideoUrl(url)) {
    throw new YtUrlNotAllowedError(`host not allowed: ${url}`)
  }

  const args = buildYtDlpVideoArgs({ url, outPath, maxFilesizeBytes })

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(YT_DLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stderrBuf = ""

    proc.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        // Progress lines look like "download: 45.2%" or "download:  45.2%"
        const match = trimmed.match(/^download:\s*([\d.]+)%/)
        if (match) {
          const pct = parseFloat(match[1])
          if (!Number.isNaN(pct)) onProgress?.(pct)
        }
      }
    })

    proc.stderr.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString() })
    proc.on("error", (err) => reject(err))
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderrBuf.trim().split("\n").pop() || `yt-dlp exited with code ${code}`))
    })
  })

  const actualPath = await findDownloadedFile(outPath)
  const stat = await fs.stat(actualPath)
  if (stat.size === 0) throw new Error("Downloaded video file is empty")

  // Re-encode to h264/aac if needed for downstream compatibility.
  const alreadyH264 = await isH264(actualPath)
  if (!alreadyH264) {
    onProcessingStart?.()
    const tmpPath = join(dirname(outPath), `.reencode-${randomUUID()}.mp4`)
    await reencodeToH264(actualPath, tmpPath)
    await fs.unlink(actualPath).catch(() => {})
    await fs.rename(tmpPath, outPath)
  } else if (actualPath !== outPath) {
    await fs.rename(actualPath, outPath)
  }
}
