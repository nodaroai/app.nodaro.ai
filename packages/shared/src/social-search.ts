/**
 * Social Search node — shared vocabulary, the post shape, credit identifiers,
 * and the rule for which posts a run passes on.
 *
 * One node searches one platform (TikTok, Instagram, YouTube, X, Reddit,
 * LinkedIn, Meta's Ad Library) by keyword or by account and returns up to 60
 * posts in one shape. In the editor a person picks the posts to keep; a
 * workflow run without picks passes on the first few. Everything the route
 * reservation, the orchestrator, the editor, the SDK and the docs must agree
 * on lives here.
 *
 * Why public: `SocialPost` is the node's output and the SDK's return type,
 * and `SocialSearchParams` is the `/v1/social-search` request body. The search
 * itself runs in a private plugin (Cloud only).
 */

export const SOCIAL_SEARCH_NODE_TYPE = "social-search" as const

export const SOCIAL_PLATFORMS = ["tiktok", "instagram", "youtube", "x", "reddit", "linkedin", "meta_ads"] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

/** `account` is a creator, a LinkedIn company page or person's profile, or
 *  a Meta advertiser; `community` is a subreddit. */
export const SOCIAL_SEARCH_MODES = ["keyword", "account", "community"] as const
export type SocialSearchMode = (typeof SOCIAL_SEARCH_MODES)[number]

export const SOCIAL_SEARCH_PLATFORM_MODES: Readonly<Record<SocialPlatform, readonly SocialSearchMode[]>> = {
  tiktok: ["keyword", "account"],
  instagram: ["keyword", "account"],
  youtube: ["keyword", "account"],
  x: ["keyword", "account"],
  reddit: ["keyword", "community"],
  linkedin: ["keyword", "account"],
  meta_ads: ["keyword", "account"],
}

export const SOCIAL_SEARCH_PERIODS = ["day", "week", "month", "year", "all"] as const
export type SocialSearchPeriod = (typeof SOCIAL_SEARCH_PERIODS)[number]

export const SOCIAL_SEARCH_SORTS = ["relevance", "popular", "newest"] as const
export type SocialSearchSort = (typeof SOCIAL_SEARCH_SORTS)[number]

/** Results per search: one page of the platform per 20 posts. */
export const SOCIAL_SEARCH_COUNTS = [20, 40, 60] as const
export type SocialSearchCount = (typeof SOCIAL_SEARCH_COUNTS)[number]

/**
 * The searches that can fetch more than one page. Every other one (an
 * account's latest posts on TikTok, Instagram, YouTube or LinkedIn, a YouTube
 * keyword search, a Reddit keyword search) returns one page however many
 * results are asked for, so it is capped at 20 — and billed for one page. The
 * plugin applies the same table to what it fetches and reserves.
 */
export const SOCIAL_SEARCH_PAGED_MODES: Readonly<Record<SocialPlatform, readonly SocialSearchMode[]>> = {
  tiktok: ["keyword"],
  instagram: ["keyword"],
  youtube: [],
  x: ["keyword", "account"],
  reddit: ["community"],
  linkedin: ["keyword"],
  meta_ads: ["keyword", "account"],
}

/** The most results this platform and mode can return in one search. */
export function socialSearchMaxCount(platform: SocialPlatform, mode: SocialSearchMode): SocialSearchCount {
  return SOCIAL_SEARCH_PAGED_MODES[platform].includes(mode) ? 60 : 20
}

export const SOCIAL_SEARCH_VIDEO_KINDS = ["all", "videos", "shorts"] as const
export type SocialSearchVideoKind = (typeof SOCIAL_SEARCH_VIDEO_KINDS)[number]

/** How many posts a run passes on when nobody picked: the first five. */
export const SOCIAL_SEARCH_DEFAULT_PICK_TOP = 5
export const SOCIAL_SEARCH_MAX_QUERY_LENGTH = 300

// ── The post ───────────────────────────────────────────────────────────────

export interface SocialPostAuthor {
  readonly handle: string
  readonly name: string
  readonly avatarUrl?: string
  readonly followers?: number
  readonly verified?: boolean
  readonly url?: string
}

/** Absent means the platform did not report it, never zero. */
export interface SocialPostMetrics {
  readonly views?: number
  readonly likes?: number
  readonly comments?: number
  readonly shares?: number
  readonly saves?: number
  /** Reddit's vote score. */
  readonly score?: number
}

export interface SocialPostMedia {
  readonly kind: "video" | "image" | "text"
  /** The platform's own still. Signed links expire within days. */
  readonly thumbnailUrl?: string
  /** A direct video file when the platform hands one out. Also short-lived. */
  readonly videoUrl?: string
  readonly durationSec?: number
  readonly aspect?: "9:16" | "16:9" | "1:1"
}

export interface SocialPost {
  /** `<platform>:<the platform's own id>`, stable across searches. */
  readonly id: string
  readonly platform: SocialPlatform
  /** The post's page. */
  readonly url: string
  readonly title?: string
  readonly text: string
  readonly author: SocialPostAuthor
  /** Where it was posted: `r/<subreddit>`, a channel, a company page, an advertiser. */
  readonly container?: string
  /** ISO 8601, UTC. */
  readonly publishedAt?: string
  readonly metrics: SocialPostMetrics
  readonly media: SocialPostMedia
  readonly hashtags: readonly string[]
  /** Platform-specific facts: a TikTok `sound`, an ad's `active` / `endedAt` /
   *  `variants` / `cta`, a Reddit `subreddit`, an X `reply` flag. */
  readonly extra: Readonly<Record<string, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Every field the card, the digest and the picker read, with its type. A
 *  saved post that fails this is skipped, never rendered half-broken. */
export function isSocialPost(value: unknown): value is SocialPost {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.text === "string" &&
    typeof value.platform === "string" &&
    (SOCIAL_PLATFORMS as readonly string[]).includes(value.platform) &&
    isRecord(value.author) &&
    typeof value.author.handle === "string" &&
    typeof value.author.name === "string" &&
    isRecord(value.metrics) &&
    isRecord(value.media) &&
    Array.isArray(value.hashtags) &&
    isRecord(value.extra)
  )
}

/** The posts in an unknown value (a job's output, a node's saved data). */
export function socialPostsFrom(value: unknown): SocialPost[] {
  return Array.isArray(value) ? value.filter(isSocialPost) : []
}

// ── The request ────────────────────────────────────────────────────────────

/** The body of `POST /v1/social-search` (and `nodes.run("social-search", …)`).
 *  A type alias, not an interface, so it is assignable to a plain record (the
 *  SDK's generic `run` body). */
export type SocialSearchParams = {
  readonly platform: SocialPlatform
  /** Default `keyword`. */
  readonly mode?: SocialSearchMode
  /** A keyword, or an account: a handle, a profile link, a subreddit, a
   *  LinkedIn company page or profile, a Meta advertiser's name or page id. */
  readonly query: string
  /** 20, 40 or 60 results. Default 20. */
  readonly count?: SocialSearchCount
  /** Default `month`. */
  readonly period?: SocialSearchPeriod
  /** Default `relevance` (the platform's own order). */
  readonly sort?: SocialSearchSort
  /** TikTok keyword search: a two-letter region. */
  readonly region?: string
  /** Meta ads: a two-letter country, or `ALL`. */
  readonly country?: string
  /** Meta ads: only ads that are running now. Default true. */
  readonly activeOnly?: boolean
  /** Reddit keyword search inside one subreddit. */
  readonly subreddit?: string
  /** YouTube: long videos, Shorts, or both. Default `all`. */
  readonly videoKind?: SocialSearchVideoKind
}

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : fallback
}

export function socialSearchPlatform(value: unknown): SocialPlatform {
  return oneOf(SOCIAL_PLATFORMS, value, "tiktok")
}

/** The mode, or the platform's first one when the stored mode does not apply
 *  (a node switched from Reddit "community" to TikTok). */
export function socialSearchMode(platform: SocialPlatform, value: unknown): SocialSearchMode {
  const allowed = SOCIAL_SEARCH_PLATFORM_MODES[platform]
  return oneOf(allowed, value, allowed[0]!)
}

export function socialSearchCount(value: unknown): SocialSearchCount {
  return value === 60 ? 60 : value === 40 ? 40 : 20
}

export function socialSearchPages(count: SocialSearchCount): 1 | 2 | 3 {
  return count === 60 ? 3 : count === 40 ? 2 : 1
}

function cleanText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined
}

/** The count a search really runs at: the asked count, capped for a search
 *  that returns one page (`socialSearchMaxCount`). */
export function socialSearchEffectiveCount(platform: SocialPlatform, mode: SocialSearchMode, value: unknown): SocialSearchCount {
  const asked = socialSearchCount(value)
  const max = socialSearchMaxCount(platform, mode)
  return asked > max ? max : asked
}

/** A two-letter region (TikTok), upper-cased, or undefined. */
export function socialSearchRegion(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim().toUpperCase() : ""
  return /^[A-Z]{2}$/.test(text) ? text : undefined
}

/** A two-letter country or ALL (Meta ads), upper-cased; anything else is ALL. */
export function socialSearchCountry(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toUpperCase() : ""
  return /^([A-Z]{2}|ALL)$/.test(text) ? text : "ALL"
}

/**
 * The request a Social Search node sends — the ONE builder the editor's run
 * and the workflow orchestrator share. `query` is the wired text when there is
 * one (a Text node, a List item), else the node's own field.
 */
export function socialSearchRequestFromNode(
  data: Readonly<Record<string, unknown>>,
  wiredQuery?: string,
): SocialSearchParams {
  const platform = socialSearchPlatform(data.platform)
  const mode = socialSearchMode(platform, data.mode)
  const query = cleanText(wiredQuery, SOCIAL_SEARCH_MAX_QUERY_LENGTH) ?? cleanText(data.query, SOCIAL_SEARCH_MAX_QUERY_LENGTH) ?? ""
  const region = socialSearchRegion(data.region)
  const country = socialSearchCountry(data.country)
  const subreddit = cleanText(data.subreddit, 100)
  return {
    platform,
    mode,
    query,
    count: socialSearchEffectiveCount(platform, mode, data.count),
    period: oneOf(SOCIAL_SEARCH_PERIODS, data.period, "month"),
    sort: oneOf(SOCIAL_SEARCH_SORTS, data.sort, "relevance"),
    ...(platform === "tiktok" && mode === "keyword" && region ? { region } : {}),
    ...(platform === "meta_ads" ? { country, activeOnly: data.activeOnly !== false } : {}),
    ...(platform === "reddit" && mode === "keyword" && subreddit ? { subreddit } : {}),
    ...(platform === "youtube" ? { videoKind: oneOf(SOCIAL_SEARCH_VIDEO_KINDS, data.videoKind, "all") } : {}),
  }
}

/**
 * The page link of a Social Search post, read from the node's `json` output
 * as a wire hands it on: one post (a wire in Each mode) or the list of posts
 * (any other wire: the first). Undefined when the output holds no post with
 * an http(s) link.
 */
export function socialSearchPostLink(output: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return undefined
  }
  const post = Array.isArray(parsed) ? parsed[0] : parsed
  const url = typeof post === "object" && post !== null ? (post as { url?: unknown }).url : undefined
  return httpLink(url)
}

function httpLink(value: unknown): string | undefined {
  const link = typeof value === "string" ? value.trim() : ""
  return /^https?:\/\/\S+$/i.test(link) ? link : undefined
}

// ── A post's video, for Video Analysis ─────────────────────────────────────

/**
 * A signed link counts as expired this long before its stated end, so it
 * still answers when the run reads it: the length check, then the download.
 */
export const SOCIAL_POST_VIDEO_LINK_MARGIN_MS = 60 * 60 * 1000

/**
 * When a platform's signed media link stops working, in epoch milliseconds,
 * if the link says: `oe` (hex seconds: Instagram, Facebook and ad videos),
 * `x-expires` (TikTok), `Expires` (S3, CloudFront), `e` (LinkedIn). Undefined
 * for a link that names no end (an X video's link does not expire).
 */
export function signedLinkExpiresAt(link: string): number | undefined {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return undefined
  }
  const params = url.searchParams
  const oe = params.get("oe")
  if (oe !== null && /^[0-9a-f]{6,10}$/i.test(oe)) return parseInt(oe, 16) * 1000
  const linkedin = /(^|\.)licdn\.com$/i.test(url.hostname)
  const seconds = params.get("x-expires") ?? params.get("Expires") ?? params.get("expires") ?? (linkedin ? params.get("e") : null)
  return seconds !== null && /^\d{9,11}$/.test(seconds) ? Number(seconds) * 1000 : undefined
}

/**
 * A post's video link when it is a FILE the analysis can download whole; a
 * streaming playlist (an HLS `.m3u8`, which some LinkedIn videos are) is not
 * one, so the post is read by its page instead.
 */
function videoFileLink(value: unknown): string | undefined {
  const link = httpLink(value)
  if (!link) return undefined
  try {
    return /\.m3u8$/i.test(new URL(link).pathname) ? undefined : link
  } catch {
    return undefined
  }
}

/** What a Social Search post hands Video Analysis. */
export type SocialSearchPostVideo =
  /** The post's own video file, while the platform's signed link is valid. */
  | { readonly kind: "file"; readonly url: string }
  /** No file came with the post (TikTok, YouTube): its page, which the analysis fetches. */
  | { readonly kind: "page"; readonly url: string }
  /** The file's signed link has expired: the search has to run again. */
  | { readonly kind: "expired" }
  /** The post is an image or a text post: there is no video to analyze. */
  | { readonly kind: "none" }

/**
 * The video Video Analysis reads from a Social Search node's `json` output,
 * as a wire hands it on: one post (a wire in Each mode) or the list (any
 * other wire: the first post). A post that came with its own video file is
 * analyzed from that file, so the platform's page is never read: Instagram's
 * page does not say how long the video is, and a video without a length
 * cannot be priced. A file whose signed link has expired is reported as such
 * rather than swapped for the page. Undefined when the output holds no post.
 * Both engines read it (input-resolver / node-input-resolver).
 */
export function socialSearchPostVideo(output: string, now: number = Date.now()): SocialSearchPostVideo | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return undefined
  }
  const post = Array.isArray(parsed) ? socialPostsFrom(parsed)[0] : isSocialPost(parsed) ? parsed : undefined
  if (!post) return undefined
  if (post.media.kind !== "video") return { kind: "none" }
  const file = videoFileLink(post.media.videoUrl)
  if (file) {
    const end = signedLinkExpiresAt(file)
    return end !== undefined && end - SOCIAL_POST_VIDEO_LINK_MARGIN_MS <= now ? { kind: "expired" } : { kind: "file", url: file }
  }
  const page = httpLink(post.url)
  return page ? { kind: "page", url: page } : undefined
}

/**
 * The longest video among the posts, in seconds: what Video Analysis quotes
 * for each post a Social Search wire hands it (each post is charged by its
 * own length when it runs, so the quote is never lower than the charge).
 * Posts without a video are left out: Video Analysis refuses them without a
 * charge. Undefined when no post has a video, or one of them does not say
 * how long it is (the ceiling quotes it).
 */
export function socialPostsLongestVideoSec(posts: readonly SocialPost[]): number | undefined {
  const lengths = posts.filter((p) => p.media.kind === "video").map((p) => p.media.durationSec)
  if (lengths.length === 0) return undefined
  return lengths.every((d): d is number => typeof d === "number" && Number.isFinite(d) && d > 0)
    ? Math.max(...lengths)
    : undefined
}

// ── Pricing ────────────────────────────────────────────────────────────────

/**
 * Credits for one page of results (up to 20 posts), set by the owner: 20 /
 * 40 / 60 results cost 20 / 40 / 60 credits on every platform. The
 * `model_pricing` rows seed the same values. A run is charged by the results
 * it asks for (pages), never by the platform.
 */
export const SOCIAL_SEARCH_CREDITS_PER_PAGE = 20

export function socialSearchCreditId(count: SocialSearchCount): string {
  return `${SOCIAL_SEARCH_NODE_TYPE}:${socialSearchPages(count)}`
}

export function socialSearchCreditIdFromNode(data: Readonly<Record<string, unknown>>): string {
  const platform = socialSearchPlatform(data.platform)
  return socialSearchCreditId(socialSearchEffectiveCount(platform, socialSearchMode(platform, data.mode), data.count))
}

/** Every id a search can reserve, plus the bare id (the node's headline price). */
export const SOCIAL_SEARCH_CREDIT_COSTS: Readonly<Record<string, number>> = Object.fromEntries([
  [SOCIAL_SEARCH_NODE_TYPE, SOCIAL_SEARCH_CREDITS_PER_PAGE],
  ...SOCIAL_SEARCH_COUNTS.map((count) => [socialSearchCreditId(count), SOCIAL_SEARCH_CREDITS_PER_PAGE * socialSearchPages(count)] as const),
])

// ── Which posts a run passes on ────────────────────────────────────────────

export function socialSearchPickTop(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : SOCIAL_SEARCH_DEFAULT_PICK_TOP
  return Math.min(60, Math.max(1, n))
}

/**
 * The posts passed on: the ones a person picked, in the order they picked
 * them, when any of them is among the results; otherwise the first `pickTop`.
 * Picks belong to the search a person picked from: a NEW search (the editor's
 * run, a workflow run) starts with none, so it passes on the first `pickTop`
 * — the same in both engines. Keeping picks means not searching again
 * (`isSocialSearchPickFrozen`).
 */
export function pickSocialPosts(
  results: readonly SocialPost[],
  pickedIds: readonly string[] | undefined,
  pickTop: unknown,
): SocialPost[] {
  const byId = new Map(results.map((p) => [p.id, p]))
  const picked = (pickedIds ?? []).map((id) => byId.get(id)).filter((p): p is SocialPost => p !== undefined)
  return picked.length > 0 ? picked : results.slice(0, socialSearchPickTop(pickTop))
}

/**
 * "Keep my picks": a node whose author picked posts and chose to keep them
 * does not search again on a workflow run — it passes its picks on, like a
 * frozen (skipped) node. Both engines treat it as skipped.
 */
export function isSocialSearchPickFrozen(type: string | undefined, data: Readonly<Record<string, unknown>>): boolean {
  return type === SOCIAL_SEARCH_NODE_TYPE && data.keepPicks === true && socialPostsFrom(data.generatedJson).length > 0
}

function metricLine(post: SocialPost): string {
  const m = post.metrics
  if (m.views !== undefined) return `${m.views} views`
  if (m.score !== undefined) return `${m.score} points`
  if (m.likes !== undefined) return `${m.likes} likes`
  return ""
}

/** One post as a few plain lines: who, when, reach; the words; the link. */
export function socialPostDigestLine(post: SocialPost, index: number): string {
  const who = post.author.handle ? `@${post.author.handle.replace(/^@/, "")}` : post.author.name || post.container || ""
  const when = post.publishedAt ? post.publishedAt.slice(0, 10) : ""
  const words = (post.title || post.text).replace(/\s+/g, " ").trim()
  const snippet = words.length > 160 ? `${words.slice(0, 159)}…` : words
  const head = `${index + 1}. ${[who, when, metricLine(post)].filter(Boolean).join(" · ")}`
  return [head, snippet, post.url].filter(Boolean).join("\n   ")
}

/** The posts as text, for nodes that read text (a prompt, a writer). */
export function socialPostsDigest(posts: readonly SocialPost[]): string {
  return posts.map(socialPostDigestLine).join("\n\n")
}
