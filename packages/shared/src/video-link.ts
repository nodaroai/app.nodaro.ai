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
 * The tolerant consumers that DO read something fetched from the link — the
 * separately-fetched audio track (`downloadedAudioUrl`): Transcribe and Suno
 * Cover. The rest of the tolerant set (Dubbing, Content Recipe) read only the
 * page link and need nothing fetched. A subset of the tolerant set by
 * construction (guard test).
 */
export const VIDEO_LINK_AUDIO_CONSUMER_TYPES: ReadonlySet<string> = new Set(["suno-cover", "transcribe"])

/**
 * What a run must FETCH for a Video URL node holding a post link:
 *  - `file`: some node in the run watches the video — download the video;
 *  - `audio`: every reader is tolerant and at least one takes the audio track —
 *    fetch the track only, never the video (and never ask for a part of it);
 *  - `none`: every reader takes the page link alone — fetch nothing.
 */
export type VideoLinkNeed = "file" | "audio" | "none"

/** The need of a node read by consumers of these types. No consumer reads nothing. */
export function videoLinkNeedOf(consumerTypes: Iterable<string>): VideoLinkNeed {
  let audio = false
  for (const type of consumerTypes) {
    if (!VIDEO_LINK_TOLERANT_CONSUMER_TYPES.has(type)) return "file"
    if (VIDEO_LINK_AUDIO_CONSUMER_TYPES.has(type)) audio = true
  }
  return audio ? "audio" : "none"
}

/** The node shape the graph readers need — open on purpose, both engines' nodes fit. */
export interface VideoLinkGraphNode {
  readonly id: string
  readonly type?: string
  readonly data?: unknown
}

export interface VideoLinkGraphEdge {
  readonly source: string
  readonly target: string
}

/**
 * The need of every Video URL node that feeds the run, by node id — ONE reading
 * of the graph for the editor's pre-run gate, the app runner's card and the
 * server's pre-run fetch, so the three cannot disagree on what a run needs.
 *
 * `scopeIds` are the nodes about to run (`null` = every node: an app runs its
 * whole graph). The run is those nodes plus everything they read from, at any
 * depth; a link that feeds nothing in it is absent (a long video parked on the
 * canvas must never block an unrelated run). Skipped nodes are not part of the
 * run and pull nothing in.
 */
export function videoLinkRunNeeds(
  scopeIds: readonly string[] | null,
  nodes: readonly VideoLinkGraphNode[],
  edges: readonly VideoLinkGraphEdge[],
): Map<string, VideoLinkNeed> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const isSkipped = (id: string) => (byId.get(id)?.data as { skipped?: unknown } | undefined)?.skipped === true

  const sourcesOf = new Map<string, string[]>()
  for (const edge of edges) {
    const list = sourcesOf.get(edge.target)
    if (list) list.push(edge.source)
    else sourcesOf.set(edge.target, [edge.source])
  }

  // Everything the run touches: the nodes about to run plus all they read from.
  const inRun = new Set<string>()
  const queue = (scopeIds ?? nodes.map((n) => n.id)).filter((id) => !isSkipped(id))
  for (const id of queue) inRun.add(id)
  while (queue.length > 0) {
    const current = queue.pop()!
    for (const source of sourcesOf.get(current) ?? []) {
      if (inRun.has(source)) continue
      inRun.add(source)
      queue.push(source)
    }
  }

  const consumers = new Map<string, string[]>()
  for (const edge of edges) {
    if (byId.get(edge.source)?.type !== "youtube-video" || !inRun.has(edge.target)) continue
    const list = consumers.get(edge.source)
    const type = byId.get(edge.target)?.type ?? ""
    if (list) list.push(type)
    else consumers.set(edge.source, [type])
  }
  const needs = new Map<string, VideoLinkNeed>()
  for (const [id, types] of consumers) needs.set(id, videoLinkNeedOf(types))
  return needs
}

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

// ---------------------------------------------------------------------------
// The link as an APP INPUT (a published app, MCP `run_app`, the SDK)
// ---------------------------------------------------------------------------

/**
 * File extensions accepted as DIRECT video-file links (pathname suffix match).
 * Mirrors save-to-storage's video auto-detect set.
 */
export const DIRECT_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi"] as const

/**
 * True for a DIRECT video-file link: http(s) whose PATHNAME ends in a video
 * extension — `https://cdn.nodaro.ai/uploads/videos/<id>.mp4` and any other
 * cdn-style link. Query and fragment are ignored (signed CDN links keep the
 * extension in the path); an extension that appears only in the query does
 * not qualify. Host-agnostic BY DESIGN, which is exactly why admission is not
 * sufficient on its own: the download route pre-resolves these hosts before it
 * fetches (`resolvesOnlyToPublicAddresses`), and every other reader goes
 * through the SSRF-guarded fetch.
 *
 * A link carrying a backslash or a control character is refused first
 * (`hasUrlParserHazard`): the route pre-resolves the WHATWG host, and the
 * download tool would fetch whatever host ITS parser reads.
 */
export function isDirectVideoFileUrl(url: string): boolean {
  if (hasUrlParserHazard(url)) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
    const path = parsed.pathname.toLowerCase()
    return DIRECT_VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext))
  } catch {
    return false
  }
}

/**
 * A YouTube video shorter than this downloads whole the moment the link lands;
 * a longer one (or one whose length could not be read) waits for a part to be
 * chosen. The same 4 minutes Recast and Studio use — a two-hour talk nobody
 * asked for never gets fetched by accident. One number for the canvas node, the
 * app runner's card and the server's pre-run fetch.
 */
export const AUTO_DOWNLOAD_MAX_SEC = 240

/** YouTube's quality cap ("up to N rows"). Other hosts have no ladder worth capping. */
export const YOUTUBE_MAX_HEIGHT = 1080

/** The longest link an app input accepts. A real video link is a few hundred characters. */
export const MAX_VIDEO_LINK_INPUT_CHARS = 2048

export type VideoLinkInputProblem = "empty" | "invalid"

/**
 * The ONE rule for what a Video URL app input may hold — the canvas node's own
 * (decided 2026-10-08): a link to a supported social host (downloaded before
 * the nodes that need the file run), or any other http(s) link (passed through
 * as it is, never downloaded; the nodes that read it fetch it through the
 * SSRF-guarded fetch). The app runner's card, the run-request lock and MCP
 * `get_app_inputs` all read it, so a link the card accepts is a link the
 * server accepts, and the reverse.
 *
 * Structural only: the server layers its SSRF guard on top (`safeUrlSchema`),
 * and the card refuses a literal local / private host. A link carrying a
 * backslash or a control character is refused (`hasUrlParserHazard`).
 * `null` = fine; leading and trailing spaces are not a problem (the card trims
 * before it sends).
 */
export function videoLinkInputProblem(value: unknown): VideoLinkInputProblem | null {
  if (value === undefined || value === null) return "empty"
  if (typeof value !== "string") return "invalid"
  const link = value.trim()
  if (link === "") return "empty"
  if (link.length > MAX_VIDEO_LINK_INPUT_CHARS) return "invalid"
  return isSocialVideoUrl(link) || isHttpLink(link) ? null : "invalid"
}

function isHttpLink(link: string): boolean {
  if (hasUrlParserHazard(link)) return false
  try {
    const parsed = new URL(link)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname !== ""
  } catch {
    return false
  }
}

/**
 * The fields of a Video URL node's data that belong to ONE link: the file and
 * audio track fetched from it, the progress of that fetch, and what was read
 * from the link (its id, title, picture, length). Every one of them describes
 * the link it was made for.
 *
 * A run-time override that swaps the link (`dropStaleVideoLinkFields`) drops
 * these first, because the creator's published node carries all of them and a
 * shallow merge would leave them standing under the caller's link — the audio
 * track in particular has no binding to its link (`downloadedAudioUrl` is read
 * straight off the node by Transcribe and Suno Cover), so a caller's episode
 * would be transcribed from the creator's sample. The editor's own
 * link-change reset (`CLEARED_DOWNLOAD` in `lib/video-link-ingest.ts`) is
 * guarded to be inside this list.
 */
export const VIDEO_LINK_DERIVED_FIELDS = [
  "videoId",
  "title",
  "thumbnailUrl",
  "downloadedVideoUrl",
  "downloadedThumbnailUrl",
  "downloadedFromUrl",
  "downloadedSection",
  "downloadStatus",
  "downloadError",
  "downloadErrorCode",
  "downloadId",
  "downloadIdUrl",
  "downloadMode",
  "downloadAllowSilent",
  "downloadPercent",
  "downloadPhase",
  "sectionStartSec",
  "sectionEndSec",
  "needsRangeChoice",
  "videoDurationSec",
  "downloadedAudioUrl",
  "audioDownloadStatus",
  "audioDownloadError",
] as const

/**
 * The saved Video URL node data without what belonged to its previous link,
 * when `incoming` (the run's override for the node) points it at a different
 * one. A field the override brings itself is kept (the merge applies it after
 * this). Returns the SAME object when the link is not being changed; never
 * mutates.
 */
export function dropStaleVideoLinkFields(
  data: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  if (!("youtubeUrl" in incoming)) return data
  if (trimmed(incoming.youtubeUrl) === trimmed(data.youtubeUrl)) return data
  const out: Record<string, unknown> = { ...data }
  for (const key of VIDEO_LINK_DERIVED_FIELDS) delete out[key]
  return out
}
