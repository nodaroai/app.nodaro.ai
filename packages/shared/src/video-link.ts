/**
 * The Video URL node (`youtube-video`) and the social-video import path —
 * structural vocabulary shared by the canvas, the orchestrator and the
 * download routes. Host names and a node-output rule only; no prompt content.
 *
 * ONE list, three readers:
 *   - the backend's yt-dlp routes (`lib/url-validator.ts` re-exports these),
 *     where the list IS the SSRF gate — yt-dlp does its own DNS + HTTP, so
 *     nothing but this exact-suffix match stands between a pasted link and an
 *     internal address;
 *   - the editor, which decides from the same list whether a pasted link is
 *     one it should download (it must never offer a host the server refuses,
 *     nor sit on one the server accepts);
 *   - both workflow engines, which read a node's output through
 *     `resolveVideoLinkOutput`.
 *
 * ⚠️ Adding a host here ADMITS it to a server-side fetch. It is a security
 * decision, not a UI one — only fixed, reputable domains whose DNS an attacker
 * cannot control.
 */
export const SOCIAL_VIDEO_HOSTS = [
  "youtube.com", "youtu.be",
  "tiktok.com",
  "instagram.com",
  "twitter.com", "x.com",
  "facebook.com", "fb.watch", "fb.com",
] as const

/** YouTube-only subset (the metadata probe and the client ladder are YouTube-only). */
export const YOUTUBE_HOSTS = ["youtube.com", "youtu.be"] as const

/** Instagram-only subset (the download path's proxy failover is Instagram-scoped). */
export const INSTAGRAM_HOSTS = ["instagram.com"] as const

const TIKTOK_HOSTS = ["tiktok.com"] as const
const TWITTER_HOSTS = ["twitter.com", "x.com"] as const
const FACEBOOK_HOSTS = ["facebook.com", "fb.watch", "fb.com"] as const

/**
 * Exact registrable-domain match against an allowlist: the domain itself or a
 * true subdomain (`www.youtube.com`, `m.youtu.be`). A host that merely
 * CONTAINS an allowlisted name (`evilyoutube.com`, `youtube.com.attacker.example`,
 * or `netflix.com` for `x.com`) does not match.
 */
export function hostnameMatchesAllowlist(hostname: string, domains: readonly string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "") // strip FQDN trailing dot
  return domains.some((d) => {
    const dom = d.toLowerCase()
    return h === dom || h.endsWith("." + dom)
  })
}

/**
 * True when the RAW link carries a character that URL parsers read differently:
 * a backslash or an ASCII control character.
 *
 * Every check in this file parses the WHATWG way (Node, the browser), where a
 * backslash in an http(s) URL is a slash — `https://tiktok.com\@10.0.0.1/x` has
 * host `tiktok.com`. A parser that ends the authority at `/` alone reads the
 * same string as a user name at host `10.0.0.1`. The download tools are handed
 * the raw string and do their own parsing, DNS and HTTP, so a link the two
 * readings can disagree on is refused outright rather than reasoned about. Tabs
 * and newlines are dropped silently by one parser and kept by another — same
 * answer. No real video link contains any of these.
 */
export function hasUrlParserHazard(url: string): boolean {
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i)
    if (code === 0x5c || code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** True for an http(s) URL whose host is on the allowlist. Never throws. */
export function isSocialVideoUrl(url: string, domains: readonly string[] = SOCIAL_VIDEO_HOSTS): boolean {
  if (hasUrlParserHazard(url)) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
    return hostnameMatchesAllowlist(parsed.hostname, domains)
  } catch {
    return false
  }
}

export type VideoLinkPlatform = "youtube" | "facebook" | "tiktok" | "instagram" | "twitter" | "unknown"

/** Which supported platform a link belongs to — by exact host, never by substring. */
export function detectVideoLinkPlatform(url: string): VideoLinkPlatform {
  if (isSocialVideoUrl(url, YOUTUBE_HOSTS)) return "youtube"
  if (isSocialVideoUrl(url, FACEBOOK_HOSTS)) return "facebook"
  if (isSocialVideoUrl(url, TIKTOK_HOSTS)) return "tiktok"
  if (isSocialVideoUrl(url, INSTAGRAM_HOSTS)) return "instagram"
  if (isSocialVideoUrl(url, TWITTER_HOSTS)) return "twitter"
  return "unknown"
}

/**
 * Node types that can use a Video URL node WITHOUT its downloaded file, because
 * they never read the video: `suno-cover` and `transcribe` take the node's
 * separately-fetched audio track (`downloadedAudioUrl`), `dubbing` hands the
 * page link to a provider that fetches it itself, and `content-recipe` cites the
 * post's page link on its `link` input (`videoLinkPageUrl`, both resolvers) —
 * a Video URL can reach it on no other input. A run whose only consumers of a
 * link are these must not be made to download — or to choose a part of — a
 * video nobody will look at. Structural vocabulary: it mirrors those
 * server-side readers; add a type here only together with its reader.
 */
export const VIDEO_LINK_TOLERANT_CONSUMER_TYPES: ReadonlySet<string> = new Set([
  "suno-cover",
  "transcribe",
  "dubbing",
  "content-recipe",
])

/**
 * The fields of a Video URL node's data that decide what it emits. Open-ended
 * on purpose: both engines hand over the node's whole `data` bag, and a closed
 * shape with only optional members would refuse it as having nothing in common.
 */
export interface VideoLinkNodeFields {
  readonly youtubeUrl?: unknown
  readonly downloadedVideoUrl?: unknown
  readonly downloadedFromUrl?: unknown
  readonly [key: string]: unknown
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const t = value.trim()
  return t === "" ? undefined : t
}

/**
 * The stored file that belongs to the node's CURRENT link, or undefined.
 *
 * `downloadedFromUrl` binds a file to the link it came from. The editor clears
 * the file whenever the link is edited, but a link can also change where no
 * editor is looking — an agent or an import rewriting the workflow JSON — and
 * without the binding the node would go on emitting the PREVIOUS video, which
 * is worse than emitting none. A node saved before the field existed has no
 * binding and is trusted as it always was.
 */
export function videoLinkDownloadedFile(data: VideoLinkNodeFields): string | undefined {
  const file = trimmed(data.downloadedVideoUrl)
  if (!file) return undefined
  const from = trimmed(data.downloadedFromUrl)
  if (from && from !== trimmed(data.youtubeUrl)) return undefined
  return file
}

/**
 * What a Video URL node emits on its `video` handle: the downloaded file when
 * one matches the link, else the link itself. The fallback is load-bearing — a
 * DIRECT file link (`https://cdn…/clip.mp4`) is a legitimate value of the URL
 * field and is never downloaded, so it must pass through.
 */
export function resolveVideoLinkOutput(data: VideoLinkNodeFields): string | undefined {
  return videoLinkDownloadedFile(data) ?? trimmed(data.youtubeUrl)
}

/**
 * The page link a Video URL node was given (the post's own address), never
 * the downloaded file. Read by consumers that CITE a post rather than watch
 * it — Content Recipe's "Source post" input stores it as the recipe's source.
 */
export function videoLinkPageUrl(data: VideoLinkNodeFields): string | undefined {
  return trimmed(data.youtubeUrl)
}

/**
 * True when the node holds a social link with no file for it yet — the state
 * in which its output is a web PAGE, which no video consumer can read.
 */
export function videoLinkNeedsDownload(data: VideoLinkNodeFields): boolean {
  const url = trimmed(data.youtubeUrl)
  if (!url || !isSocialVideoUrl(url)) return false
  return videoLinkDownloadedFile(data) === undefined
}
