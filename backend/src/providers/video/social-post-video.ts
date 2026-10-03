/**
 * A social post's video, fetched for analysis — the hardened lane for a link
 * that arrives from outside (a share into a Telegram inbox, a field pip)
 * rather than from a person pasting it into the import dialog.
 *
 * - Only a single post on a platform we read is fetched (`socialPostOf`): a
 *   profile, a channel, a playlist, a story or a share short link is refused
 *   before anything spawns. A YouTube link is rebuilt as its plain watch link.
 * - yt-dlp is held to that platform's own extractors (`--use-extractors`), so
 *   its generic extractor — which follows any page and any embed — never runs;
 *   it reads one video per post (`--playlist-items 1`).
 * - A live stream, or a video longer than the caller's cap, stops yt-dlp before
 *   the download (`--break-match-filters`, a halt no other client or proxy
 *   retries); the file size is capped and TLS certificates are checked.
 * - The whole fetch has one wall-clock limit and honours the caller's abort;
 *   a kill reaches the processes yt-dlp starts (ytdlp-process.ts).
 * - The child process gets a minimal environment: it never sees the server's
 *   secrets. Logs name the platform, never the link.
 */
import { homedir } from "node:os"
import { hostnameMatchesAllowlist } from "../../lib/url-validator.js"
import { YT_SPOOF_ARGS, YtUrlNotAllowedError, downloadYouTubeVideo, runThroughClientLadder, runYtDlpCapture } from "./youtube-video.js"
import { ytDataApiProbe, youtubeVideoId } from "./youtube-data-api.js"
import { resolveAttemptChain } from "./yt-proxy.js"
import { YtDlpHaltError, remainingLimits } from "./ytdlp-process.js"

export type SocialPostPlatform = "youtube" | "tiktok" | "instagram" | "x" | "facebook"

interface PlatformRule {
  /** Registrable domains (a subdomain matches too). */
  readonly hosts: readonly string[]
  /** yt-dlp extractor names, matched exactly by `--use-extractors`. */
  readonly extractors: readonly string[]
  /** The URL is one post (not a profile, a channel, a story, a short link we cannot follow). */
  readonly isPost: (url: URL) => boolean
}

const trimSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, "") : path)

export const SOCIAL_POST_PLATFORMS: Readonly<Record<SocialPostPlatform, PlatformRule>> = {
  youtube: {
    hosts: ["youtube.com", "youtu.be"],
    extractors: ["youtube"],
    isPost: (url) => {
      const path = trimSlash(url.pathname)
      if (hostnameMatchesAllowlist(url.hostname, ["youtu.be"])) return /^\/[\w-]{6,}$/.test(path)
      return (path === "/watch" && /^[\w-]{6,}$/.test(url.searchParams.get("v") ?? "")) || /^\/(shorts|live)\/[\w-]{6,}$/.test(path)
    },
  },
  tiktok: {
    hosts: ["tiktok.com"],
    extractors: ["TikTok", "vm.tiktok"],
    isPost: (url) => {
      const path = trimSlash(url.pathname)
      if (/^(vm|vt)\.tiktok\.com$/i.test(url.hostname)) return /^\/[\w-]+$/.test(path)
      return /^\/@[^/]+\/video\/\d+$/.test(path) || /^\/t\/[\w-]+$/.test(path)
    },
  },
  instagram: {
    hosts: ["instagram.com"],
    extractors: ["Instagram"],
    isPost: (url) => /^\/(p|reel|reels|tv)\/[\w-]+$/.test(trimSlash(url.pathname)),
  },
  x: {
    hosts: ["x.com", "twitter.com"],
    extractors: ["twitter"],
    isPost: (url) => /^\/(?:[^/]+|i)\/status\/\d+$/.test(trimSlash(url.pathname)),
  },
  facebook: {
    hosts: ["facebook.com"],
    extractors: ["facebook", "facebook:reel"],
    isPost: (url) => {
      const path = trimSlash(url.pathname)
      return (path === "/watch" && /^\d+$/.test(url.searchParams.get("v") ?? "")) || /^\/reel\/\d+$/.test(path) || /^\/[^/]+\/videos\/(?:[^/]+\/)?\d+$/.test(path)
    },
  },
}

/**
 * Social hosts no post is fetched from directly: their links are short links
 * only yt-dlp's generic extractor follows (`fb.watch/…`, `fb.com/…`). A post
 * shared that way is read by its words instead of its video.
 */
export const SOCIAL_HOSTS_NOT_FETCHED: readonly string[] = ["fb.watch", "fb.com"]

/**
 * The post a link points at, when it is one this lane fetches; null for
 * anything else. A YouTube post comes back as its plain watch link: the
 * `youtube` extractor alone refuses a link that also names a playlist.
 */
export function socialPostOf(link: string): { platform: SocialPostPlatform; url: string } | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (url.username || url.password || url.port) return null
  for (const [platform, rule] of Object.entries(SOCIAL_POST_PLATFORMS) as Array<[SocialPostPlatform, PlatformRule]>) {
    if (!hostnameMatchesAllowlist(url.hostname, rule.hosts) || !rule.isPost(url)) continue
    if (platform !== "youtube") return { platform, url: url.toString() }
    const id = youtubeVideoId(url.toString())
    return id ? { platform, url: `https://www.youtube.com/watch?v=${id}` } : null
  }
  return null
}

/** The yt-dlp arguments that hold a fetch to one platform's post, within a length cap. */
export function socialPostArgs(platform: SocialPostPlatform, maxDurationSec: number): string[] {
  return [
    "--ignore-config",
    "--use-extractors",
    SOCIAL_POST_PLATFORMS[platform].extractors.join(","),
    "--no-playlist",
    "--playlist-items",
    "1",
    "--break-match-filters",
    `!is_live & duration <=? ${Math.max(1, Math.floor(maxDurationSec))}`,
  ]
}

/** The environment yt-dlp runs with: enough to find its tools and a cache, none of the server's secrets. */
export function ytDlpChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "TMPDIR"] as const
  const child: NodeJS.ProcessEnv = { HOME: env.HOME ?? homedir(), LANG: "C.UTF-8" }
  for (const key of keep) if (env[key] !== undefined) child[key] = env[key]
  return child
}

/** A probe's answer: what the analysis is priced and refused by. */
export interface SocialPostMetadata {
  durationSec: number | null
  title: string | null
  isLive: boolean
}

/** One yt-dlp run of a probe; the whole probe (every client and proxy) has `PROBE_TOTAL_MS`. */
const PROBE_RUN_TIMEOUT_MS = 15_000
export const PROBE_TOTAL_MS = 30_000
/** The probe prints three fields; anything near this is not an answer. */
const PROBE_MAX_BYTES = 64 * 1024

/** The three fields a probe prints, as one JSON line. */
const PROBE_PRINT = "%(.{duration,is_live,title})j"

function parseProbe(raw: string): SocialPostMetadata {
  const line = raw.split("\n").map((l) => l.trim()).find((l) => l.startsWith("{"))
  if (!line) throw new Error("the probe printed no answer")
  const meta = JSON.parse(line) as { duration?: unknown; title?: unknown; is_live?: unknown }
  return {
    durationSec: typeof meta.duration === "number" && Number.isFinite(meta.duration) ? meta.duration : null,
    title: typeof meta.title === "string" ? meta.title : null,
    isLive: meta.is_live === true,
  }
}

/**
 * The post's length and whether it is live, before anything is paid for:
 * YouTube's Data API when a key is set, else yt-dlp held like the download —
 * its platform's extractors, one video, a minimal environment, the same proxy
 * chain the download would use, one deadline, the caller's abort.
 * Throws `YtUrlNotAllowedError` for a link that is not a fetchable post.
 */
export async function probeSocialPostVideo(link: string, opts: { signal?: AbortSignal } = {}): Promise<SocialPostMetadata> {
  const post = socialPostOf(link)
  if (!post) throw new YtUrlNotAllowedError("not a social post this lane reads")
  const deadline = Date.now() + PROBE_TOTAL_MS
  if (post.platform === "youtube") {
    const api = await ytDataApiProbe(post.url, { timeoutMs: 10_000 })
    if (api) return api
  }
  const args = [
    "--skip-download",
    "--ignore-config",
    "--use-extractors",
    SOCIAL_POST_PLATFORMS[post.platform].extractors.join(","),
    "--no-playlist",
    "--playlist-items",
    "1",
    // The length and liveness are read from the page; a client that is refused
    // the formats still answers them, instead of failing the rung.
    "--ignore-no-formats-error",
    "--print",
    PROBE_PRINT,
    ...YT_SPOOF_ARGS,
  ]
  let lastError: unknown = new Error("probe not attempted")
  for (const proxy of resolveAttemptChain(post.url)) {
    try {
      const raw = await runThroughClientLadder(post.url, (rung) =>
        runYtDlpCapture([...args, ...(proxy ? ["--proxy", proxy] : []), ...rung.extractorArgs, post.url], {
          timeoutMs: PROBE_RUN_TIMEOUT_MS,
          maxBytes: PROBE_MAX_BYTES,
          ...remainingLimits(deadline, { env: ytDlpChildEnv(), signal: opts.signal }),
        }),
      )
      return parseProbe(raw)
    } catch (err) {
      if (err instanceof YtDlpHaltError) throw err
      lastError = err
    }
  }
  throw lastError
}

/** One wall-clock limit for a whole fetch (download + the h264 pass). */
export const SOCIAL_POST_FETCH_TIMEOUT_MS = 10 * 60 * 1000

/** The size cap when a caller names none: far past any 10-minute post. */
export const SOCIAL_POST_MAX_BYTES = 512 * 1024 * 1024

/**
 * Download the post's video to `outPath`. Throws `YtUrlNotAllowedError` for a
 * link that is not a fetchable post; a live stream or a video past
 * `maxDurationSec` stops yt-dlp before the download (`YtDlpHaltError`).
 */
export async function downloadSocialPostVideo(opts: {
  url: string
  outPath: string
  maxDurationSec: number
  maxFilesizeBytes?: number
  maxHeight?: number
  signal?: AbortSignal
}): Promise<void> {
  const post = socialPostOf(opts.url)
  if (!post) throw new YtUrlNotAllowedError("not a social post this lane reads")
  const maxFilesizeBytes = opts.maxFilesizeBytes && opts.maxFilesizeBytes > 0 ? Math.min(opts.maxFilesizeBytes, SOCIAL_POST_MAX_BYTES) : SOCIAL_POST_MAX_BYTES
  await downloadYouTubeVideo({
    url: post.url,
    outPath: opts.outPath,
    maxFilesizeBytes,
    maxHeight: opts.maxHeight,
    hardening: {
      extraArgs: socialPostArgs(post.platform, opts.maxDurationSec),
      env: ytDlpChildEnv(),
      totalTimeoutMs: SOCIAL_POST_FETCH_TIMEOUT_MS,
      signal: opts.signal,
    },
  })
}

/** Every social host is either a platform this lane reads or a host it deliberately does not (see the guard test). */
export const SOCIAL_HOSTS_COVERED: readonly string[] = [
  ...Object.values(SOCIAL_POST_PLATFORMS).flatMap((rule) => rule.hosts),
  ...SOCIAL_HOSTS_NOT_FETCHED,
]
