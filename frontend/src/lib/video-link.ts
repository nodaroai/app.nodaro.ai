/**
 * The Video URL node's pure half — link parsing, the download's error classes,
 * timecodes, and the ONE function that turns node data into what the card and
 * the panel show. Both surfaces used to carry their own copy of the platform
 * regexes and the state logic, and drifted; they now read this and drive the
 * node through `video-link-ingest.ts`.
 *
 * Host decisions come from `@nodaro/shared` — the same list the server's
 * download route admits, by exact host. The old checks were substring regexes:
 * `x\.com` matched `netflix.com`, so a Netflix link showed a Download button
 * the server could only refuse.
 */
import {
  AUTO_DOWNLOAD_MAX_SEC,
  YOUTUBE_MAX_HEIGHT,
  detectVideoLinkPlatform,
  isSocialVideoUrl,
  videoLinkDownloadedFile,
  type VideoLinkPlatform,
} from "@nodaro/shared"
import type { MessageKey } from "@/lib/i18n/en"

export type { VideoLinkPlatform }
export { detectVideoLinkPlatform }

/** Brand names — never translated. `unknown` is rendered by the caller. */
export const VIDEO_PLATFORM_LABELS: Readonly<Record<Exclude<VideoLinkPlatform, "unknown">, string>> = {
  youtube: "YouTube",
  facebook: "Facebook",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitter: "Twitter/X",
}

// The 4-minute auto-download ceiling and the 1080-row YouTube cap are `@nodaro/shared`'s:
// the app runner's card, the editor and the server's pre-run fetch read ONE number.
export { AUTO_DOWNLOAD_MAX_SEC, YOUTUBE_MAX_HEIGHT }

const YOUTUBE_ID = /^[a-zA-Z0-9_-]{11}$/

function youtubeId(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "")
  const segments = parsed.pathname.split("/").filter(Boolean)
  let candidate: string | null | undefined
  if (host === "youtu.be" || host.endsWith(".youtu.be")) {
    candidate = segments[0]
  } else if (segments[0] === "watch") {
    candidate = parsed.searchParams.get("v")
  } else if (segments[0] === "embed" || segments[0] === "shorts" || segments[0] === "live") {
    candidate = segments[1]
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null
}

/**
 * A stable id for the linked video, or null when the link is not one this node
 * can use. For a supported host whose URL shape carries no id (a TikTok short
 * link, `fb.watch`) the link itself is the id — yt-dlp resolves it server-side.
 */
export function extractVideoLinkId(url: string): string | null {
  const platform = detectVideoLinkPlatform(url)
  if (platform === "unknown") return null
  const parsed = new URL(url) // detectVideoLinkPlatform already proved it parses
  if (platform === "youtube") return youtubeId(parsed)
  const path = parsed.pathname
  const known =
    platform === "tiktok"
      ? path.match(/^\/@[\w.-]+\/video\/(\d+)/)
      : platform === "instagram"
        ? path.match(/^\/(?:[\w.-]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)
        : platform === "twitter"
          ? path.match(/^\/\w+\/status\/(\d+)/)
          : (path.match(/\/videos\/(\d+)/) ?? path.match(/^\/share\/(?:v|r)\/([A-Za-z0-9_-]+)/) ?? path.match(/^\/reel\/([A-Za-z0-9_-]+)/))
  return known ? known[1] : url
}

// ---------------------------------------------------------------------------
// Download errors
// ---------------------------------------------------------------------------

export type DownloadErrorCode =
  | "no_audio"
  | "age_restricted"
  | "private"
  | "region"
  | "live"
  | "connection"
  | "busy"
  | "generic"

/**
 * Sort a yt-dlp / download-worker failure into the handful of classes people
 * actually hit. The raw text varies across yt-dlp versions and sites, so this
 * matches loosely; the node stores the raw text too, shown as a tooltip.
 */
export function classifyDownloadError(raw: string | undefined): DownloadErrorCode {
  if (!raw) return "generic"
  const message = raw.toLowerCase()
  // Most specific first: the server's own "no audio track" failure. The link is
  // fine and public — Instagram serves some datacenter addresses a sound-less
  // format set — so the generic "check the link" copy would actively mislead.
  if (message.includes("no audio")) return "no_audio"
  if (message.includes("confirm your age") || message.includes("age-restricted") || message.includes("age restricted")) {
    return "age_restricted"
  }
  if (message.includes("private")) return "private"
  if (message.includes("your country") || message.includes("geo") || message.includes("not available in your")) return "region"
  if (message.includes("live event") || message.includes("live stream") || message.includes("is live")) return "live"
  if (message.includes("connection lost") || message.includes("download expired")) return "connection"
  // The server's per-account cap on running downloads (429 too_many_downloads).
  if (message.includes("too many downloads")) return "busy"
  return "generic"
}

const DOWNLOAD_ERROR_CODES: ReadonlySet<string> = new Set<DownloadErrorCode>([
  "no_audio", "age_restricted", "private", "region", "live", "connection", "busy", "generic",
])

export const DOWNLOAD_ERROR_KEYS = {
  no_audio: "videolink.errorNoAudio",
  age_restricted: "videolink.errorAgeRestricted",
  private: "videolink.errorPrivate",
  region: "videolink.errorRegion",
  live: "videolink.errorLive",
  connection: "videolink.errorConnection",
  busy: "videolink.errorBusy",
  generic: "videolink.errorGeneric",
} as const satisfies Record<DownloadErrorCode, MessageKey>

// ---------------------------------------------------------------------------
// Timecodes
// ---------------------------------------------------------------------------

/** `90`, `1:30`, `1:02:03` → seconds. Null for anything a player would not show. */
export function parseTimecode(text: string): number | null {
  const parts = text.trim().split(":")
  if (parts.length === 0 || parts.length > 3) return null
  let total = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const isLast = i === parts.length - 1
    // Only the seconds field may carry a fraction; every field must be digits.
    if (!(isLast ? /^\d+(\.\d+)?$/ : /^\d+$/).test(part)) return null
    const value = Number(part)
    // In h:mm:ss every field after the first is base-60.
    if (i > 0 && value >= 60) return null
    total = total * 60 + value
  }
  return total
}

/** Seconds → `m:ss` or `h:mm:ss`, floored — the way a player reads. */
export function formatTimecode(sec: number): string {
  const whole = Math.max(0, Math.floor(sec))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

export type RangeValidation =
  | { readonly ok: true; readonly startSec: number; readonly endSec: number }
  | { readonly ok: false; readonly reason: "format" | "order" | "beyond" | "tooLong" }

/**
 * The "from / to" fields of a long video. `durationSec` null = length unknown.
 * `maxPartSec` is the longest part the nodes after it read (see
 * lib/video-link-length-limits); a longer part is refused here, before it is
 * downloaded, rather than by the node that cannot read it, mid-run.
 */
export function validateRange(
  fromText: string,
  toText: string,
  durationSec: number | null,
  maxPartSec?: number,
): RangeValidation {
  const startSec = parseTimecode(fromText)
  const endSec = parseTimecode(toText)
  if (startSec === null || endSec === null) return { ok: false, reason: "format" }
  if (startSec >= endSec) return { ok: false, reason: "order" }
  if (durationSec !== null && endSec > durationSec) return { ok: false, reason: "beyond" }
  if (maxPartSec !== undefined && endSec - startSec > maxPartSec) return { ok: false, reason: "tooLong" }
  return { ok: true, startSec, endSec }
}

// ---------------------------------------------------------------------------
// What the node shows
// ---------------------------------------------------------------------------

export type DownloadPhase = "downloading" | "processing" | "uploading"

export type VideoLinkView =
  | { readonly kind: "empty" }
  /** A direct file link (or a host we do not download) — emitted as it is. */
  | { readonly kind: "passthrough" }
  /** A supported link with no file and nothing running. */
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "choose"; readonly durationSec: number | null }
  | { readonly kind: "downloading"; readonly percent: number; readonly phase: DownloadPhase }
  | { readonly kind: "failed"; readonly code: DownloadErrorCode; readonly canRetrySilent: boolean }
  | { readonly kind: "ready" }

export interface VideoLinkViewFields {
  readonly youtubeUrl?: unknown
  readonly downloadedVideoUrl?: unknown
  readonly downloadedFromUrl?: unknown
  readonly downloadStatus?: unknown
  readonly downloadPercent?: unknown
  readonly downloadPhase?: unknown
  readonly downloadError?: unknown
  readonly downloadErrorCode?: unknown
  readonly needsRangeChoice?: unknown
  readonly videoDurationSec?: unknown
  readonly [key: string]: unknown
}

function asPhase(value: unknown): DownloadPhase {
  return value === "processing" || value === "uploading" ? value : "downloading"
}

/**
 * Node data → the one state the card and the panel render. A matching file
 * wins over every status flag: a node that holds its video IS ready, even if a
 * stale "failed" survived next to it.
 */
export function deriveVideoLinkView(data: VideoLinkViewFields): VideoLinkView {
  const url = typeof data.youtubeUrl === "string" ? data.youtubeUrl.trim() : ""
  if (!url) return { kind: "empty" }
  if (!isSocialVideoUrl(url)) return { kind: "passthrough" }
  if (videoLinkDownloadedFile(data)) return { kind: "ready" }

  if (data.downloadStatus === "checking") return { kind: "checking" }
  if (data.downloadStatus === "downloading") {
    const percent = typeof data.downloadPercent === "number" && Number.isFinite(data.downloadPercent) ? data.downloadPercent : 0
    return { kind: "downloading", percent, phase: asPhase(data.downloadPhase) }
  }
  if (data.downloadStatus === "failed") {
    const stored = typeof data.downloadErrorCode === "string" && DOWNLOAD_ERROR_CODES.has(data.downloadErrorCode)
      ? (data.downloadErrorCode as DownloadErrorCode)
      // A failure saved before codes existed carries only the raw text.
      : classifyDownloadError(typeof data.downloadError === "string" ? data.downloadError : undefined)
    return { kind: "failed", code: stored, canRetrySilent: stored === "no_audio" }
  }
  if (data.needsRangeChoice === true) {
    const durationSec = typeof data.videoDurationSec === "number" && Number.isFinite(data.videoDurationSec) ? data.videoDurationSec : null
    return { kind: "choose", durationSec }
  }
  return { kind: "idle" }
}
