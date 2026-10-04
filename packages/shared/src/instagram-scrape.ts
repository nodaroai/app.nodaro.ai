/**
 * Instagram scraper node — shared vocabulary + credit identifiers.
 *
 * Pulls PUBLIC Instagram posts (feed images, carousels, reels) by profile, by
 * hashtag or by post link and emits a normalized JSON array. Same shape of contract as the
 * Meta Ads node: everything the backend guard/reservation, the frontend credit
 * badge and the docs formula must agree on lives here.
 *
 * Pricing: 1 credit per REQUESTED post, rounded UP to a fixed tier of
 * `count × sources` (a profile / hashtag / post link is one source, up to 5;
 * a post link is always ONE post — see `instagramRequestedCount`). Optional
 * per-post AI analysis folds into the same identifier, priced by the model's
 * tier — reusing the Meta analysis per-item values so the two nodes stay in
 * lockstep.
 */
import {
  META_ADS_ANALYSIS_CREDITS_PER_AD,
  META_ADS_ANALYSIS_TIERS,
  metaAdsAnalysisTier,
  type MetaAdsAnalysisTier,
} from "./meta-ads-scrape.js"
import { classifyCreativeFormat, type MetaAdsFormat } from "./meta-ads-scrape.js"

export const INSTAGRAM_SCRAPE_NODE_TYPE = "instagram-scrape" as const

/**
 * `profile` = recent posts of an account, `hashtag` = recent posts under a tag,
 * `post` = exactly the posts whose links are given (one post per link — the
 * "remake this post" entry point, where a full run must land on THAT post).
 */
export const INSTAGRAM_SCRAPE_MODES = ["profile", "hashtag", "post"] as const
export type InstagramScrapeMode = (typeof INSTAGRAM_SCRAPE_MODES)[number]

export function isInstagramScrapeMode(value: unknown): value is InstagramScrapeMode {
  return typeof value === "string" && (INSTAGRAM_SCRAPE_MODES as readonly string[]).includes(value)
}
export function instagramScrapeMode(value: unknown): InstagramScrapeMode {
  return isInstagramScrapeMode(value) ? value : "profile"
}

/** Same window vocabulary as Meta Ads; the Instagram actor honours it server-side (`onlyPostsNewerThan`). */
export const INSTAGRAM_SCRAPE_PERIODS = ["24h", "7d", "30d", "all"] as const
export type InstagramScrapePeriod = (typeof INSTAGRAM_SCRAPE_PERIODS)[number]

export const INSTAGRAM_SCRAPE_DEFAULT_COUNT = 20
export const INSTAGRAM_SCRAPE_MAX_COUNT = 100
export const INSTAGRAM_SCRAPE_MAX_SOURCES = 5
/** Instagram usernames / hashtags are short; cap a single target well under a URL. */
export const INSTAGRAM_SCRAPE_MAX_TARGET_LENGTH = 200

/** Requested-total buckets — identical shape to Meta (the pricing model is the same). */
export const INSTAGRAM_SCRAPE_TIERS = [10, 20, 50, 100, 200, 500] as const
export type InstagramScrapeTier = (typeof INSTAGRAM_SCRAPE_TIERS)[number]

export function instagramScrapeTier(requestedTotal: number): InstagramScrapeTier {
  for (const tier of INSTAGRAM_SCRAPE_TIERS) if (requestedTotal <= tier) return tier
  return INSTAGRAM_SCRAPE_TIERS[INSTAGRAM_SCRAPE_TIERS.length - 1]
}

/** The analysis tier a request / node asks for, or null when analysis is off. */
export function instagramAnalysisTierFrom(data: { readonly analyze?: unknown; readonly analysisModel?: unknown }): MetaAdsAnalysisTier | null {
  return data.analyze === true ? metaAdsAnalysisTier(data.analysisModel) : null
}

function analysisSuffix(tier: MetaAdsAnalysisTier): string {
  return tier === "standard" ? ":analysis" : `:analysis:${tier}`
}

/** Per-post settlement SKU for a tier (the bare id is the standard tier). */
export const INSTAGRAM_ANALYSIS_CREDIT_ID = "instagram-analysis" as const
export function instagramAnalysisCreditId(tier: MetaAdsAnalysisTier): string {
  return tier === "standard" ? INSTAGRAM_ANALYSIS_CREDIT_ID : `${INSTAGRAM_ANALYSIS_CREDIT_ID}:${tier}`
}

export interface InstagramScrapeCreditInput {
  count: number
  sources: number
  analysis?: MetaAdsAnalysisTier | null
}

export function buildInstagramScrapeCreditId(input: InstagramScrapeCreditInput): string {
  const sources = Math.min(Math.max(Math.trunc(input.sources) || 1, 1), INSTAGRAM_SCRAPE_MAX_SOURCES)
  const count = Math.min(Math.max(Math.trunc(input.count) || 1, 1), INSTAGRAM_SCRAPE_MAX_COUNT)
  const base = `${INSTAGRAM_SCRAPE_NODE_TYPE}:${instagramScrapeTier(count * sources)}`
  return input.analysis ? `${base}${analysisSuffix(input.analysis)}` : base
}

/**
 * Cost per SKU — mirror of the backend `STATIC_CREDIT_COSTS` rows / migration,
 * for the frontend badge / estimator. 1 credit per requested post at every
 * tier, plus the analysis multiples.
 */
export const INSTAGRAM_SCRAPE_CREDIT_COSTS: Record<string, number> = (() => {
  const table: Record<string, number> = { [INSTAGRAM_SCRAPE_NODE_TYPE]: 20 }
  for (const tier of META_ADS_ANALYSIS_TIERS) table[instagramAnalysisCreditId(tier)] = META_ADS_ANALYSIS_CREDITS_PER_AD[tier]
  for (const t of INSTAGRAM_SCRAPE_TIERS) {
    table[`${INSTAGRAM_SCRAPE_NODE_TYPE}:${t}`] = t
    for (const tier of META_ADS_ANALYSIS_TIERS) {
      table[`${INSTAGRAM_SCRAPE_NODE_TYPE}:${t}${analysisSuffix(tier)}`] = t * (1 + META_ADS_ANALYSIS_CREDITS_PER_AD[tier])
    }
  }
  return table
})()

export const INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID = "instagram-scrape:20"

export function isInstagramScrapeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= INSTAGRAM_SCRAPE_MAX_COUNT
}

/**
 * A post link: instagram.com (any subdomain, an optional username segment
 * before the kind) or instagr.am, `/p/`, `/reel/`, `/reels/` or `/tv/`, with or
 * without scheme, query string or trailing slash. Group 1 = the kind, group 2 =
 * the shortcode. The shortcode is CASE-SENSITIVE — two codes that differ only
 * in case are two different posts — so the `i` flag only relaxes the host and
 * the kind; the captured code keeps its case.
 *
 * Instagram's own path words are never a username: `/share/p/<token>/` (the
 * token of a share redirect, not a shortcode), `/stories/…`, `/explore/…` and
 * the kinds themselves would otherwise turn into a wrong post that still bills.
 * `/reels/audio/<id>/` is an audio page, not a reel.
 */
const INSTAGRAM_POST_LINK_RE =
  /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:instagram\.com|instagr\.am)\/(?:(?!(?:share|stories|explore|accounts|direct|p|reels?|tv)\/)[A-Za-z0-9._]+\/)?(p|reels?|tv)\/(?!audio(?:[/?#]|$))([A-Za-z0-9_-]+)/i

function parseInstagramPostLink(value: string): { readonly link: string; readonly shortcode: string } | null {
  const match = INSTAGRAM_POST_LINK_RE.exec(value.trim())
  if (!match) return null
  const kind = match[1].toLowerCase()
  const segment = kind === "p" ? "p" : kind === "tv" ? "tv" : "reel"
  return { link: `https://www.instagram.com/${segment}/${match[2]}/`, shortcode: match[2] }
}

/** The canonical link of the post a value points at, or null when it is not an Instagram post link. */
export function instagramPostLink(value: string): string | null {
  return parseInstagramPostLink(value)?.link ?? null
}

/**
 * Post links, canonicalised, deduped by shortcode (`/p/X` and `/reel/X` are
 * one post), capped at MAX_SOURCES. An item holding several links (an API
 * caller's array entry) is split like typed text.
 */
function splitInstagramPostLinks(raw: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw.flatMap((entry) => entry.split(/[\s,]+/))) {
    const parsed = parseInstagramPostLink(item)
    if (!parsed || seen.has(parsed.shortcode)) continue
    seen.add(parsed.shortcode)
    out.push(parsed.link)
    if (out.length >= INSTAGRAM_SCRAPE_MAX_SOURCES) break
  }
  return out
}

/**
 * Targets are typed one per line; the route wants an array.
 *
 * - `profile` / `hashtag` (the default — the signature predates post mode):
 *   a target can be a bare username / `#tag`, so split on lines / commas only
 *   (never whitespace), strip a leading `@` or `#`, dedupe, cap at MAX_SOURCES.
 * - `post`: only Instagram post links count; each is canonicalised (see
 *   `instagramPostLink`) and anything else is dropped, so the guard, the
 *   reservation and the scrape all see the same set of posts.
 */
export function splitInstagramTargets(value: unknown, mode: InstagramScrapeMode = "profile"): string[] {
  const separator = mode === "post" ? /[\s,]+/ : /[\n,]+/
  const raw = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? value.split(separator)
      : []
  if (mode === "post") return splitInstagramPostLinks(raw)
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const t = item.trim().replace(/^[@#]+/, "").trim()
    if (t.length < 1 || t.length > INSTAGRAM_SCRAPE_MAX_TARGET_LENGTH) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= INSTAGRAM_SCRAPE_MAX_SOURCES) break
  }
  return out
}

/** The featured post index, clamped. */
export function clampInstagramFeaturedIndex(stored: unknown, count: number): number {
  if (count <= 0) return 0
  const n = typeof stored === "number" && Number.isFinite(stored) ? Math.trunc(stored) : 0
  return Math.min(Math.max(n, 0), count - 1)
}

export interface FeaturedInstagramOutputs {
  readonly text?: string
  readonly imageUrl?: string
  readonly videoUrl?: string
}

function urlStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : []
}

/** The featured post's caption (`text`), first image / cover (`image`), and first video (`video`). */
export function featuredInstagramOutputs(json: unknown, featuredIndex: unknown): FeaturedInstagramOutputs {
  if (!Array.isArray(json) || json.length === 0) return {}
  const post = json[clampInstagramFeaturedIndex(featuredIndex, json.length)]
  if (!post || typeof post !== "object") return {}
  const p = post as Record<string, unknown>
  const text = typeof p.caption === "string" ? p.caption.trim() : ""
  const imageUrl = urlStrings(p.images)[0] ?? urlStrings(p.videoPreviews)[0]
  const videoUrl = urlStrings(p.videos)[0]
  return {
    ...(text ? { text } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(videoUrl ? { videoUrl } : {}),
  }
}

/** The node-data fields a quote reads. */
export interface InstagramNodeQuoteFields {
  readonly [key: string]: unknown
  readonly mode?: unknown
  readonly targets?: unknown
  readonly count?: unknown
  readonly analyze?: unknown
  readonly analysisModel?: unknown
}

/**
 * Posts requested PER SOURCE: the `count` setting, except in post mode, where
 * every source is one link and so one post (the count setting does not apply).
 * Every price computation goes through this, so the guard, the reservation,
 * the settlement and the node's badge cannot disagree on a post-mode run.
 */
export function instagramRequestedCount(mode: InstagramScrapeMode, count: number): number {
  return mode === "post" ? 1 : count
}

/** Billable source count: number of targets (min 1). */
export function instagramScrapeSources(data: InstagramNodeQuoteFields): number {
  return Math.max(1, Math.min(splitInstagramTargets(data.targets, instagramScrapeMode(data.mode)).length, INSTAGRAM_SCRAPE_MAX_SOURCES))
}

/** The ONE credit identifier for a node's current settings. */
export function instagramScrapeCreditIdFromNode(data: InstagramNodeQuoteFields): string {
  const count = typeof data.count === "number" ? data.count : INSTAGRAM_SCRAPE_DEFAULT_COUNT
  return buildInstagramScrapeCreditId({
    count: instagramRequestedCount(instagramScrapeMode(data.mode), count),
    sources: instagramScrapeSources(data),
    analysis: instagramAnalysisTierFrom(data),
  })
}

/**
 * Resolve the credit identifier from an UNVALIDATED request body (the guard
 * runs before Zod). Lands on the SAME tier the reservation computes.
 */
export function resolveInstagramScrapeCreditId(body: unknown): string {
  const raw = body as { mode?: unknown; count?: unknown; targets?: unknown; analyze?: unknown; analysisModel?: unknown } | null | undefined
  if (!raw || typeof raw !== "object") return INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID
  const count = raw.count === undefined ? INSTAGRAM_SCRAPE_DEFAULT_COUNT : raw.count
  if (!isInstagramScrapeCount(count)) return INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID
  // Same mode resolution as the route's Zod default (absent → profile) and the
  // same splitter the handler uses for `sources` (dedupes, caps at MAX), so the
  // pre-Zod guard and the post-Zod reservation always land on the same tier —
  // a duplicate target bills once, not per copy.
  const mode = instagramScrapeMode(raw.mode)
  const sources = splitInstagramTargets(raw.targets, mode).length
  if (sources < 1) return INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID
  return buildInstagramScrapeCreditId({ count: instagramRequestedCount(mode, count), sources, analysis: instagramAnalysisTierFrom(raw) })
}

// Re-export the shared creative-format vocabulary so the node imports one place.
export { classifyCreativeFormat }
export type InstagramFormat = MetaAdsFormat
