import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import {
  YtDlpHaltError,
  remainingLimits,
  runYtDlpCaptureWith,
  spawnYtDlpDownloadWith,
  type YtDlpRunLimits,
} from "./ytdlp-process.js"
import { promises as fs, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import {
  YOUTUBE_HOSTS,
  hostnameMatchesAllowlist,
  isAllowedSocialVideoUrl,
  isAllowedVideoImportUrl,
} from "../../lib/url-validator.js"
import { videoFormatSelector, sectionHdVideoSelector, SECTION_HD_AUDIO_SELECTOR } from "./video-format.js"
import { ytProxyArgs, resolveAttemptChain } from "./yt-proxy.js"
import { startProxyAuthShim } from "./proxy-auth-shim.js"
import { ytDataApiProbe } from "./youtube-data-api.js"
import { probeStreams, reencodeToH264 } from "./video-file-stages.js"

/**
 * Shared yt-dlp video provider — the single source of the referer/UA spoof for
 * the VIDEO download path.
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
 * referer/UA spoof — the ONLY copy for the video path. Shared verbatim between
 * the download and metadata-probe calls so the spoof identity can't drift.
 *
 * NO `player_client` pin lives in these base args, on purpose. A hard
 * `youtube:player_client=android` pin here once capped every YouTube download at
 * **360p** — the android client does not expose the higher-resolution DASH
 * streams, so the format selector had nothing better to pick. The base args stay
 * pin-free so attempt 1 uses yt-dlp's default (web) client and returns 1080p
 * when YouTube lets it through.
 *
 * The android client is NOT gone, though — it is the LAST rung of the client
 * ladder (see `youtubeClientLadder`). YouTube's watch page 429s the web client
 * from datacenter IPs (Railway), so the download and probe retry web → tv →
 * android; the android rung never touches the watch page and always succeeds
 * (worst case: the pre-ladder 360p behaviour — i.e. a working download). Pins
 * therefore belong ONLY in the fallback rungs, never in these base args. If
 * YouTube quality regresses to 360p, suspect a pin leaking into the base args
 * before believing the platform is throttling us.
 */
export const YT_SPOOF_ARGS = [
  "--add-header", "referer:youtube.com",
  "--add-header", "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
] as const

/** Thrown when a URL's host is not on the relevant yt-dlp allowlist (SSRF gate). */
export class YtUrlNotAllowedError extends Error {}

export { YtDlpHaltError }

/**
 * Replace the output path's extension with yt-dlp's `%(ext)s` template so the
 * downloaded video AND its sidecar thumbnail land on the same basename (the
 * download-video route finds the thumbnail by that basename).
 */
function deriveOutputTemplate(outPath: string): string {
  return outPath.replace(/\.[^./\\]+$/, "") + ".%(ext)s"
}

/** Seconds of slack added on each side of a requested section (keyframe pad). */
export const SECTION_PAD_SEC = 3

/**
 * A requested part of a video, in seconds. By default the fetch is padded
 * ±SECTION_PAD_SEC for a client that trims the small result itself (Studio,
 * Recast, the voice changer). `exact` asks for the range itself, cut at both
 * ends by `--force-keyframes-at-cuts`: for a client that never trims — the
 * editor's Video URL node, whose consumers measure the file. Video Analysis
 * prices by that length, so a padded 1:00 part (1:06) billed the 3-minute
 * bucket, and a padded 10:00 part (10:06) ran past the length it reads.
 */
export interface VideoSection {
  readonly startSec: number
  readonly endSec: number
  readonly exact?: boolean
}

/** The `--download-sections` value for a section: padded, or exact. Exported for tests. */
export function sectionDownloadRange(section: VideoSection): string {
  const pad = section.exact ? 0 : SECTION_PAD_SEC
  return `*${Math.max(0, section.startSec - pad)}-${section.endSec + pad}`
}

/**
 * The `--format` selector for a SECTION (trim) download: a SINGLE combined
 * (progressive) stream, NOT the HD two-stream DASH selector.
 *
 * WHY (measured): a section download fetches the media with a separate ffmpeg
 * process, and ffmpeg fetching the TWO separate DASH streams (video + audio) of
 * an HD format concurrently THROUGH AN HTTP PROXY stalls indefinitely — the exact
 * "trim hangs forever" bug. A SINGLE progressive stream (YouTube format 22=720p
 * or 18=360p, both muxed h264/aac mp4) fetches fine through the same proxy.
 * Progressive tops out at 720p — there is no 1080p muxed stream — which is the
 * accepted quality trade for an EFFICIENT trim (only the range's bytes, no
 * whole-video download). `b`/`best` already means "best PRE-MUXED format", so
 * these branches never select a video-only stream.
 */
export function sectionFormatSelector(maxHeight?: number): string {
  const h = maxHeight ? `[height<=${maxHeight}]` : ""
  return [`b[ext=mp4]${h}`, `b${h}`, "b[ext=mp4]", "b"].join("/")
}

/**
 * yt-dlp args for ONE half of an HD section download (video-only or
 * audio-only — see `sectionHdVideoSelector`). Same spine as
 * `buildYtDlpVideoArgs` minus `--merge-output-format` (single stream, nothing
 * to merge); the caller muxes the two halves locally. Exported for tests.
 */
export function buildYtDlpSectionStreamArgs(opts: {
  url: string
  outTemplate: string
  format: string
  section: VideoSection
  proxyArgs: string[]
  writeThumbnail?: boolean
}): string[] {
  return [
    opts.url,
    "--format", opts.format,
    "--output", opts.outTemplate,
    "--no-playlist",
    "--no-check-certificates",
    "--force-overwrites",
    ...(opts.writeThumbnail ? ["--write-thumbnail", "--convert-thumbnails", "jpg"] : []),
    ...YT_SPOOF_ARGS,
    ...opts.proxyArgs,
    "--newline",
    "--progress-template", "download:%(progress._percent_str)s",
    "--download-sections", sectionDownloadRange(opts.section),
    "--force-keyframes-at-cuts",
  ]
}

/**
 * yt-dlp video download args. Exported for testability. Adds
 * `--max-filesize <N>M` only when `maxFilesizeBytes` is provided (the
 * video-analysis path caps download size; the download-video route does not).
 *
 * `maxHeight` (optional) caps the `--format` selection to `<=maxHeight` px tall —
 * ABSENT leaves the whole-video selector byte-identical to the uncapped default.
 *
 * `section` (optional) fetches ONLY that time range via `--download-sections`
 * (±SECTION_PAD_SEC keyframe pad, or none for an `exact` section — see
 * VideoSection) with `--force-keyframes-at-cuts` for accuracy.
 * A section forces `sectionFormatSelector` (single progressive stream) instead of
 * the HD two-stream selector, because the two-stream fetch stalls through a proxy
 * (see sectionFormatSelector). Efficient: only the range's bytes are downloaded.
 */
export function buildYtDlpVideoArgs(opts: {
  url: string
  outPath: string
  maxFilesizeBytes?: number
  maxHeight?: number
  section?: VideoSection
  /**
   * The `--proxy` args for this attempt — one `["--proxy", url]` from the
   * download's proxy chain, or `[]` for no proxy. For a SECTION download this is
   * the auth-injecting shim's localhost url (ffmpeg's fetch needs it); the loop
   * passes each chain proxy in turn. Defaults to `ytProxyArgs(url)`.
   */
  proxyArgs?: string[]
  /** Appended as they are (the hardened social-post lane's extractor and length limits). */
  extraArgs?: readonly string[]
  /**
   * Verify TLS certificates (the hardened lane): through a proxy pool, an exit
   * node could otherwise hand ffmpeg and the model media of its own.
   */
  checkCertificates?: boolean
}): string[] {
  const args = [
    opts.url,
    "--format", opts.section ? sectionFormatSelector(opts.maxHeight) : videoFormatSelector(opts.maxHeight),
    "--output", deriveOutputTemplate(opts.outPath),
    "--no-playlist",
    ...(opts.checkCertificates ? [] : ["--no-check-certificates"]),
    "--merge-output-format", "mp4",
    // Overwrite (implies --no-continue): proxy failover re-attempts the download
    // from a DIFFERENT IP, and the media URLs are IP-locked — resuming a `.part`
    // fetched through the previous proxy would corrupt the file. Force a clean
    // fetch each attempt. Harmless for the common single-attempt case (the output
    // path is a fresh per-job temp that never pre-exists).
    "--force-overwrites",
    "--write-thumbnail",
    "--convert-thumbnails", "jpg",
    ...YT_SPOOF_ARGS,
    // Route YouTube through the residential/ISP proxy when configured — the
    // datacenter IP is bot-blocked (see `yt-proxy`). `proxyArgs` carries the
    // chosen proxy for this attempt; `[]` (non-YouTube / unconfigured) leaves the
    // download proxy-free, byte-for-byte unchanged.
    ...(opts.proxyArgs ?? ytProxyArgs(opts.url)),
    "--newline",
    "--progress-template", "download:%(progress._percent_str)s",
  ]
  if (opts.maxFilesizeBytes && opts.maxFilesizeBytes > 0) {
    const mb = Math.round(opts.maxFilesizeBytes / (1024 * 1024))
    args.push("--max-filesize", `${mb}M`)
  }
  if (opts.extraArgs) args.push(...opts.extraArgs)
  if (opts.section) {
    // `--force-keyframes-at-cuts` re-encodes only around the cut points for an
    // accurate range (the section is small, so this is fast).
    args.push("--download-sections", sectionDownloadRange(opts.section), "--force-keyframes-at-cuts")
  }
  return args
}

/** One rung of the yt-dlp client ladder: a label for telemetry plus the extra
 *  `--extractor-args` to append to the base args (empty for the default client). */
export interface YtClientRung {
  label: string
  extractorArgs: string[]
}

/**
 * The ordered yt-dlp client rungs to try for `url`. Exported for testability.
 *
 * YouTube's watch page returns HTTP 429 to yt-dlp's default (web) client from
 * datacenter IPs (Railway) — intermittent from residential IPs, effectively 100%
 * from production — so a single web attempt is what took video imports down
 * ("Couldn't fetch this video"). The ladder retries with progressively more
 * watch-page-avoidant clients:
 *   1. `default` — the pin-free base args (web client → best quality, 1080p60
 *      avc1 when YouTube lets it through).
 *   2. `tv`      — the TV client.
 *   3. `android` — never fetches the watch page; has succeeded on the audio
 *      paths for months. Worst case equals the pre-#77 behaviour: works, 360p.
 *
 * This ladder is YouTube-ONLY. TikTok/Instagram/X/Facebook are unaffected by the
 * watch-page 429 and get exactly ONE default-client attempt — byte-for-byte the
 * pre-ladder args, so their behaviour is unchanged.
 */
export function youtubeClientLadder(url: string): YtClientRung[] {
  // YOUTUBE_HOSTS covers youtube.com / youtu.be and, via exact-suffix match, the
  // subdomains (www., m., music.youtube.com). Everything else → single attempt.
  if (!isAllowedSocialVideoUrl(url, YOUTUBE_HOSTS)) {
    return [{ label: "default", extractorArgs: [] }]
  }
  return [
    { label: "default", extractorArgs: [] },
    { label: "tv", extractorArgs: ["--extractor-args", "youtube:player_client=tv"] },
    { label: "android", extractorArgs: ["--extractor-args", "youtube:player_client=android"] },
  ]
}

/**
 * Run `attempt` through the client ladder for `url`. Exported for testability.
 *
 * Calls `attempt(rung)` for each rung in order and returns the first success. On
 * a rung failure it logs the blocked client and advances to the next rung; the
 * LAST rung's rejection propagates UNCHANGED — so when every rung fails, the
 * error the caller sees (and the download-video route surfaces over SSE via
 * `err.message`, and VCP's `mapYtdlpError` classifies) is exactly the last
 * rung's error, stderr-last-line message intact.
 *
 * The per-rung "succeeded"/"failed" lines are the production telemetry for how
 * often YouTube blocks the web client — grep `[download-video] youtube client`.
 * Only YouTube runs a real (>1 rung) ladder, so only YouTube emits these lines.
 */
export async function runThroughClientLadder<T>(
  url: string,
  attempt: (rung: YtClientRung) => Promise<T>,
): Promise<T> {
  const rungs = youtubeClientLadder(url)
  for (let i = 0; i < rungs.length; i++) {
    const rung = rungs[i]
    try {
      const result = await attempt(rung)
      if (rungs.length > 1) {
        console.log(`[download-video] youtube client "${rung.label}" succeeded`)
      }
      return result
    } catch (err) {
      // A halt (aborted, out of time, refused by the filter) is the same on every client.
      if (i === rungs.length - 1 || err instanceof YtDlpHaltError) throw err
      const firstLine = (err instanceof Error ? err.message : String(err)).split("\n")[0]
      console.log(`[download-video] youtube client "${rung.label}" failed (${firstLine}), trying next`)
    }
  }
  // Unreachable: youtubeClientLadder always returns ≥1 rung, and the final rung
  // either returns or throws above. Present only to satisfy the type checker.
  throw new Error("youtube client ladder exhausted with no attempt")
}

/**
 * Run yt-dlp and resolve its stdout. Unlike the streaming download path this
 * captures full stdout and enforces an explicit `timeoutMs` (kill + reject on
 * expiry) — the metadata probe must never hang the caller. `env` replaces the
 * child's environment (the hardened social-post lane passes a minimal one);
 * `totalTimeoutMs` and `signal` halt it (`YtDlpHaltError`, see ytdlp-process).
 */
export function runYtDlpCapture(
  args: string[],
  opts: YtDlpRunLimits & { timeoutMs: number; maxBytes?: number },
): Promise<string> {
  return runYtDlpCaptureWith(YT_DLP_BIN, args, opts)
}

const runYtDlp = runYtDlpCapture

/**
 * YouTube-ONLY metadata probe. Validates the host against the NARROW
 * `YOUTUBE_HOSTS` list BEFORE spawning (throws `YtUrlNotAllowedError`).
 *
 * Prefers the official YouTube Data API (`ytDataApiProbe`) when `YOUTUBE_API_KEY`
 * is set — no proxy, no bot-block, no client ladder — and only falls back to the
 * yt-dlp `--dump-json --skip-download --no-playlist` probe (shared spoof, 15s
 * hard timeout) on an API miss. Returns null fields when the source omits them.
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
  // Official Data API first (keyed, proxy-free, bot-block-immune). Null on any
  // miss (no key / unextractable id / API error / not found) → fall through to
  // the yt-dlp ladder below, so behaviour is unchanged until the key is set.
  const apiResult = await ytDataApiProbe(url)
  if (apiResult) return apiResult
  // Same watch-page 429 exposure as the download, so run the probe through the
  // client ladder too (it's YouTube-only, so all three rungs apply). Metadata
  // (duration/title/isLive) is client-independent, so the android fallback is
  // fully sufficient — this only needs the fetch to succeed, not best quality.
  const raw = await runThroughClientLadder(url, (rung) =>
    runYtDlp(
      // Same residential-proxy routing as the download (the probe hits the identical bot-block).
      ["--dump-json", "--skip-download", "--no-playlist", ...YT_SPOOF_ARGS, ...ytProxyArgs(url), ...rung.extractorArgs, url],
      { timeoutMs: 15_000 },
    ),
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

export { probeStreams, reencodeToH264, type ProbedStreams } from "./video-file-stages.js"
/**
 * One yt-dlp download attempt: spawn, parse `download:NN%` progress lines to
 * `onProgress`, capture stderr, resolve on exit 0, reject otherwise.
 *
 * The error shape here is load-bearing and MUST NOT drift: on non-zero exit it
 * rejects with an Error whose message is the LAST non-empty stderr line — the
 * download-video route reports that string over SSE (`state.error = err.message`)
 * and VCP's `mapYtdlpError` classifies it. This is the exact spawn/parse/error
 * logic that used to live inline in `downloadYouTubeVideo`; it was extracted only
 * so the client ladder can call it once per rung.
 */
/**
 * Idle (no-output) watchdog for a download: a healthy yt-dlp/ffmpeg emits progress
 * (`download:NN%` or ffmpeg `frame=…`) sub-second, so this only fires on a genuine
 * STALL — most importantly the section-download-through-a-proxy hang, which goes
 * silent right after "Destination". Idle-based (reset on any output), NOT a total
 * cap, so a legitimately long whole-video download never trips it.
 */
const DOWNLOAD_STALL_TIMEOUT_MS = 90_000

/**
 * Exported for the AUDIO extractor (`providers/audio/youtube-extractor.ts`),
 * which rides this exact spawn so the two lanes can never disagree about
 * binary, error shape, or stall handling. `idleTimeoutMs` exists for that
 * caller: `--extract-audio` has a SILENT ffmpeg conversion phase after the
 * download finishes, so the 90s download-stall default would SIGKILL a healthy
 * long extraction mid-convert — audio passes the 10-min ffmpeg convention.
 */
export function spawnYtDlpDownload(
  args: string[],
  onProgress?: (pct: number) => void,
  opts?: YtDlpRunLimits & { idleTimeoutMs?: number },
): Promise<void> {
  return spawnYtDlpDownloadWith(YT_DLP_BIN, args, onProgress, { ...opts, idleTimeoutMs: opts?.idleTimeoutMs ?? DOWNLOAD_STALL_TIMEOUT_MS })
}

/**
 * Mux an HD section's two stream halves into `outPath`. The video stream is
 * COPIED (no quality loss — the whole point of the HD path); audio re-encodes
 * to aac (cheap, and normalizes an opus/webm fallback half). `-shortest`
 * squares off the halves' slightly different section boundaries. Same
 * promise/watchdog pattern as `reencodeToH264`.
 */
function muxSectionStreams(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-i", audioPath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-shortest",
      outPath,
    ], { stdio: ["ignore", "ignore", "pipe"] })
    const watchdog = setTimeout(() => proc.kill("SIGKILL"), 10 * 60 * 1000)
    let stderrBuf = ""
    proc.stderr.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString() })
    proc.on("error", (err) => { clearTimeout(watchdog); reject(err) })
    proc.on("close", (code) => {
      clearTimeout(watchdog)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg section mux exited with code ${code}: ${stderrBuf.trim().split("\n").pop()}`))
    })
  })
}

/**
 * HD SECTION DOWNLOAD (2026-08-02 import-quality fix): fetch the section's
 * DASH halves SEQUENTIALLY — one yt-dlp run for the video-only stream, one
 * for the audio-only stream — then mux locally into `outPath`.
 *
 * WHY sequential: the measured "trim hangs forever" stall was ONE ffmpeg
 * fetching TWO DASH streams CONCURRENTLY through the auth proxy (see
 * `sectionFormatSelector`). One stream per run keeps the proxy-safe property
 * while restoring full DASH quality — the progressive-only fallback tops out
 * at 720p, and in practice YouTube retired most progressive streams, so trims
 * landed at 360p (the "YouTube import quality is very low" report).
 *
 * The thumbnail sidecar rides the VIDEO pass and is renamed onto `outPath`'s
 * basename (where the download-video route looks for it). Stream temps are
 * cleaned best-effort; the caller's temp workdir owns anything left behind.
 * Throws on any failure — the caller falls back to the progressive path.
 */
async function downloadSectionHd(opts: {
  url: string
  outPath: string
  maxHeight?: number
  section: VideoSection
  proxyArgs: string[]
  extractorArgs: string[]
  onProgress?: (pct: number) => void
}): Promise<void> {
  const base = opts.outPath.replace(/\.[^./\\]+$/, "")
  const vidArgs = buildYtDlpSectionStreamArgs({
    url: opts.url, outTemplate: `${base}.vid.%(ext)s`, format: sectionHdVideoSelector(opts.maxHeight),
    section: opts.section, proxyArgs: opts.proxyArgs, writeThumbnail: true,
  })
  await spawnYtDlpDownload([...vidArgs, ...opts.extractorArgs], opts.onProgress)
  const audArgs = buildYtDlpSectionStreamArgs({
    url: opts.url, outTemplate: `${base}.aud.%(ext)s`, format: SECTION_HD_AUDIO_SELECTOR,
    section: opts.section, proxyArgs: opts.proxyArgs,
  })
  await spawnYtDlpDownload([...audArgs, ...opts.extractorArgs])
  const videoPath = await findDownloadedFile(`${base}.vid.mp4`)
  const audioPath = await findDownloadedFile(`${base}.aud.m4a`)
  await muxSectionStreams(videoPath, audioPath, opts.outPath)
  await fs.rename(`${base}.vid.jpg`, `${base}.jpg`).catch(() => {})
  await fs.unlink(videoPath).catch(() => {})
  await fs.unlink(audioPath).catch(() => {})
}

/**
 * Enforce "this import needs audio". Exported for testability. Throws a
 * user-facing error only when `requireAudio` is set AND the download has a
 * DEFINITE no-audio stream (`hasAudio === false`). `null` (probe failed →
 * unknown) is NOT treated as missing — we never fail an import on a probe glitch.
 *
 * WHY import callers set requireAudio: a voice changer can't do anything with a
 * silent clip, and in practice a no-audio YouTube result means a degraded
 * session (bot-block → android fallback → SABR stripping the audio formats), so
 * failing honestly with "try again" beats importing a useless silent video.
 */
export function assertAudioPresent(hasAudio: boolean | null, requireAudio: boolean | undefined): void {
  if (requireAudio && hasAudio === false) {
    throw new Error(
      "This video has no audio track — Voice Changer needs audio to work. " +
        "YouTube may be limiting downloads right now; try again, or use a different video.",
    )
  }
}

/**
 * Download a social video (YouTube/TikTok/Instagram/X/Facebook) to `outPath`
 * as an h264 mp4 (h264/aac when audio is present). Validates the host against
 * the BROAD social allowlist BEFORE spawning (SSRF gate — the worker calls this
 * directly), applies the referer/UA spoof, optionally caps size, then re-encodes
 * to h264 when the download isn't already h264. Throws on any failure.
 *
 * `requireAudio` (optional) — when true, a download with NO audio stream fails
 * (see assertAudioPresent). The import route sets it (a voice changer needs
 * audio); the general video path leaves it unset (a silent video is valid there).
 *
 * Progress reporting (both optional, used by the SSE download-video route):
 *   - `onProgress(pct)` — download percent (0–100) as yt-dlp reports it.
 *   - `onProcessingStart()` — fired once, right before the h264 re-encode
 *     begins, so callers can surface a distinct "processing" phase.
 *
 * `section` (optional) fetches only that time range (± the keyframe pad) via
 * `--download-sections` — see buildYtDlpVideoArgs. yt-dlp's progress output is
 * jumpy for section downloads; callers should expect non-monotonic percents.
 */
export async function downloadYouTubeVideo(opts: {
  url: string
  outPath: string
  maxFilesizeBytes?: number
  maxHeight?: number
  section?: VideoSection
  requireAudio?: boolean
  onProgress?: (pct: number) => void
  onProcessingStart?: () => void
  /**
   * The hardened social-post lane (`social-post-video.ts`): extra yt-dlp
   * arguments (one platform's extractors, the length filter), a minimal child
   * environment, one wall-clock limit across every attempt, and an abort.
   * Whole-video downloads only.
   */
  hardening?: {
    extraArgs: readonly string[]
    env: NodeJS.ProcessEnv
    totalTimeoutMs: number
    signal?: AbortSignal
  }
}): Promise<void> {
  const { url, outPath, maxFilesizeBytes, maxHeight, section, requireAudio, onProgress, onProcessingStart, hardening } = opts
  if (hardening && section) throw new Error("a hardened download fetches the whole video")
  const deadline = hardening ? Date.now() + hardening.totalTimeoutMs : undefined
  // What is left of a hardened fetch's one deadline, for the next step — a halt
  // (YtDlpHaltError) when the caller aborted or nothing is left, so no client,
  // proxy or stage starts late.
  const spawnLimits = () =>
    hardening && deadline !== undefined ? remainingLimits(deadline, { env: hardening.env, signal: hardening.signal }) : undefined
  const stageLimits = () => {
    const left = spawnLimits()
    return left ? { timeoutMs: left.totalTimeoutMs, signal: left.signal } : undefined
  }

  // SSRF gate — the same social-or-direct-file admission the download-video
  // route enforces. Defense-in-depth only: for a direct-file (arbitrary) host
  // the ROUTE additionally pre-resolves DNS and rejects private answers, which
  // a sync guard here cannot do.
  if (!isAllowedVideoImportUrl(url)) {
    throw new YtUrlNotAllowedError(`host not allowed: ${url}`)
  }

  // The ordered download attempts (proxy url or null = direct) — YouTube runs
  // pool-first, Instagram direct-first with the pool as failover, everything
  // else a single direct attempt (see yt-proxy's resolveAttemptChain).
  const attempts = resolveAttemptChain(url)

  // Try each attempt in turn: exhaust the (cheap, main) tier before escalating
  // to the fallback. First USABLE result wins; a failed SPAWN advances to the
  // next attempt. When ALL fail, the LAST attempt's error propagates verbatim —
  // the route's SSE and VCP's mapYtdlpError depend on that message shape.
  //
  // "Usable" includes the audio check: with `requireAudio`, a download that
  // arrives definitely-silent (Instagram serves some datacenter IPs a degraded,
  // audio-less format set per-post) counts as a FAILED attempt — the file is
  // discarded and the next attempt (the proxy, which sees the full format set)
  // tries again. On the LAST attempt a silent file is kept and fails below in
  // assertAudioPresent with the canonical error. Post-download FS oddities (no
  // output file, zero-byte file) stay TERMINAL, exactly as before — they aren't
  // the degraded-source signature, and burning more paid-proxy attempts on them
  // buys nothing.
  let lastError: unknown = new Error("download not attempted")
  let result: { actualPath: string; videoCodec: string | null; hasAudio: boolean | null } | undefined
  for (let i = 0; i < attempts.length && !result; i++) {
    const proxy = attempts[i]
    const isLastAttempt = i === attempts.length - 1
    // A section (trim) download fetches the media with a SEPARATE ffmpeg process
    // (yt-dlp's FFmpegFD), which can't authenticate to the proxy: its no-creds
    // first CONNECT dies ("ffmpeg exited with code 187") where the native
    // whole-video downloader (proactive auth) succeeds. Route the section path
    // through a localhost shim that injects THIS proxy's credentials for ffmpeg
    // (see proxy-auth-shim). Non-section uses the proxy directly; no proxy → none.
    const shim = section && proxy ? await startProxyAuthShim(proxy) : undefined
    let spawned = false
    try {
      const proxyArgs = proxy ? ["--proxy", shim ? shim.url : proxy] : []
      if (section) {
        // HD section first (sequential two-stream — full DASH quality), with
        // the proven progressive single-stream path as the in-attempt
        // fallback. See downloadSectionHd / sectionFormatSelector.
        try {
          await runThroughClientLadder(url, (rung) =>
            downloadSectionHd({ url, outPath, maxHeight, section, proxyArgs, extractorArgs: [...rung.extractorArgs], onProgress }),
          )
        } catch (hdErr) {
          const firstLine = (hdErr instanceof Error ? hdErr.message : String(hdErr)).split("\n")[0]
          console.log(`[download-video] HD section download failed (${firstLine}); progressive section fallback`)
          const args = buildYtDlpVideoArgs({ url, outPath, maxFilesizeBytes, maxHeight, section, proxyArgs })
          await runThroughClientLadder(url, (rung) =>
            spawnYtDlpDownload([...args, ...rung.extractorArgs], onProgress),
          )
        }
      } else {
        const args = buildYtDlpVideoArgs({
          url, outPath, maxFilesizeBytes, maxHeight, section, proxyArgs,
          extraArgs: hardening?.extraArgs,
          checkCertificates: hardening !== undefined,
        })
        // YouTube 429s the default (web) client on the watch page from datacenter
        // IPs, so within each proxy we still retry web → tv → android.
        await runThroughClientLadder(url, (rung) =>
          spawnYtDlpDownload([...args, ...rung.extractorArgs], onProgress, spawnLimits()),
        )
      }
      spawned = true
    } catch (err) {
      // A halt is the same through every proxy: stop here, never spawn again.
      if (err instanceof YtDlpHaltError) throw err
      lastError = err
      if (!isLastAttempt) {
        const firstLine = (err instanceof Error ? err.message : String(err)).split("\n")[0]
        console.log(
          `[download-video] attempt ${i + 1}/${attempts.length} (${proxy ? "proxy" : "direct"}) failed (${firstLine}); trying next`,
        )
      }
    } finally {
      // Tear the shim down whether the attempt succeeded or threw — it holds a
      // listening socket and any live tunnels open otherwise.
      await shim?.close()
    }
    if (!spawned) continue

    // Outside the catch above ON PURPOSE: a throw from these checks is terminal.
    const actualPath = await findDownloadedFile(outPath)
    const stat = await fs.stat(actualPath)
    if (stat.size === 0) throw new Error("Downloaded video file is empty")
    const probed = await probeStreams(actualPath, stageLimits())
    if (requireAudio && probed.hasAudio === false && !isLastAttempt) {
      // Discard the silent file so the next attempt starts clean (yt-dlp's
      // --force-overwrites would clobber it anyway; this keeps failure paths
      // from leaking it). lastError only surfaces if every later attempt also
      // fails at spawn level.
      await fs.unlink(actualPath).catch(() => {})
      lastError = new Error("downloaded file has no audio track (degraded source response)")
      console.log(
        `[download-video] attempt ${i + 1}/${attempts.length} (${proxy ? "proxy" : "direct"}) downloaded SILENT; retrying via next attempt`,
      )
      continue
    }
    result = { actualPath, ...probed }
  }
  if (!result) throw lastError
  const { actualPath, videoCodec, hasAudio } = result

  // Import callers (requireAudio) fail on a silent download — a voice changer
  // can't use it, and it's the signal of a degraded session (bot-block → android
  // → SABR strips audio). Throws before the re-encode, so no silent file is ever
  // imported. Only reachable when the LAST attempt was silent — earlier silent
  // attempts already failed over above. General callers (no requireAudio) just
  // warn: a silent clip is a legitimate download for them, but every audio
  // consumer downstream would otherwise die naming ffmpeg instead of the cause.
  assertAudioPresent(hasAudio, requireAudio)
  if (hasAudio === false) {
    console.warn(`[download-video] ${url} produced a video with NO audio stream`)
  }

  // Re-encode to h264 if needed for downstream compatibility. A null codec means
  // the probe failed — re-encode anyway; normalizing is the safe fallback. Pass
  // hasAudio so a legit silent video re-encodes video-only (`-an`) instead of
  // aborting on `-c:a aac` (exit 234).
  if (videoCodec !== "h264") {
    onProcessingStart?.()
    const tmpPath = join(dirname(outPath), `.reencode-${randomUUID()}.mp4`)
    await reencodeToH264(actualPath, tmpPath, hasAudio, stageLimits())
    await fs.unlink(actualPath).catch(() => {})
    await fs.rename(tmpPath, outPath)
  } else if (actualPath !== outPath) {
    await fs.rename(actualPath, outPath)
  }
}
