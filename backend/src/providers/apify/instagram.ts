import { getApifyClient, sanitizeApifyError } from "./client.js"
import { MissingProviderKeyError } from "../provider-keys.js"
import {
  INSTAGRAM_SCRAPE_MAX_COUNT,
  classifyCreativeFormat,
  instagramPostLink,
  instagramRequestedCount,
  type InstagramScrapeMode,
  type InstagramScrapePeriod,
} from "@nodaro/shared"

/**
 * Instagram provider — pulls PUBLIC posts (feed images, carousels, reels) from
 * `apify/instagram-scraper` by profile, by hashtag, or by post link (exactly
 * the linked posts, whatever their age). Unlike Meta's Ad Library,
 * the actor honours the date window SERVER-SIDE (`onlyPostsNewerThan`), so
 * there is no over-fetch: a light post-filter only trims the odd item that
 * slips through by hours. Posts carry pixel dimensions inline, so the node's
 * format classification is free (no probe fetch).
 */
export const INSTAGRAM_ACTOR = {
  apifyActorId: "apify/instagram-scraper",
  timeoutSecs: 300,
} as const

const CONTEXT = "instagram-scrape"

export interface InstagramScrapeArgs {
  mode: InstagramScrapeMode
  /** Usernames (profile mode) or hashtags (hashtag mode), already split + stripped of @/#; canonical post links (post mode). */
  targets: string[]
  count: number
  period: InstagramScrapePeriod
}

/** One normalized post — mirrors the MetaAd shape so the media / featured-output helpers are shared. */
export interface InstagramPost {
  postId: string
  shortCode: string
  url: string
  type: "image" | "video" | "carousel" | "unknown"
  caption: string
  ownerUsername: string
  ownerFullName: string
  timestamp: string | null
  likesCount: number | null
  commentsCount: number | null
  videoViewCount: number | null
  hashtags: string[]
  locationName: string | null
  images: string[]
  videos: string[]
  videoPreviews: string[]
  /** The primary creative's reported pixels, when Instagram gave them (skips a probe). */
  dimsWidth: number | null
  dimsHeight: number | null
}

export interface InstagramScrapeOutput {
  json: InstagramPost[]
}

const PERIOD_NEWER_THAN: Record<InstagramScrapePeriod, string | undefined> = {
  "24h": "1 day",
  "7d": "7 days",
  "30d": "30 days",
  all: undefined,
}
const PERIOD_MS: Record<InstagramScrapePeriod, number | null> = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  all: null,
}

/**
 * The Instagram URL a target scrapes: a profile page, the hashtag's posts
 * feed, or — in post mode — the post itself (the actor answers a post url with
 * that one post, carousel children included). Post targets arrive canonical
 * from `splitInstagramTargets`; anything that is not a post link yields "" so
 * it can never be scraped as a profile by accident.
 */
export function instagramTargetUrl(mode: InstagramScrapeMode, target: string): string {
  if (mode === "post") return instagramPostLink(target) ?? ""
  const slug = encodeURIComponent(target.trim().replace(/^[@#]+/, ""))
  return mode === "hashtag"
    ? `https://www.instagram.com/explore/tags/${slug}/`
    : `https://www.instagram.com/${slug}/`
}

export function buildInstagramActorInput(args: InstagramScrapeArgs): Record<string, unknown> {
  // A post link names one post, whatever its age: no date window, one result each.
  if (args.mode === "post") {
    return {
      directUrls: args.targets.map((t) => instagramTargetUrl("post", t)).filter((u) => u.length > 0),
      resultsType: "posts",
      resultsLimit: 1,
    }
  }
  const newerThan = PERIOD_NEWER_THAN[args.period]
  return {
    directUrls: args.targets.map((t) => instagramTargetUrl(args.mode, t)),
    resultsType: "posts",
    resultsLimit: Math.min(Math.max(args.count, 1), INSTAGRAM_SCRAPE_MAX_COUNT),
    ...(newerThan ? { onlyPostsNewerThan: newerThan } : {}),
  }
}

type Raw = Record<string, unknown>

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}
function mapType(v: unknown): InstagramPost["type"] {
  if (v === "Image") return "image"
  if (v === "Video") return "video"
  if (v === "Sidecar") return "carousel"
  return "unknown"
}

/** Flatten a post's media (carousel children included) into image / video / poster arrays. */
function collectMedia(it: Raw): Pick<InstagramPost, "images" | "videos" | "videoPreviews"> {
  const images: string[] = []
  const videos: string[] = []
  const videoPreviews: string[] = []
  const children = Array.isArray(it.childPosts) ? (it.childPosts as Raw[]) : null
  if (children && children.length > 0) {
    for (const c of children) {
      const video = str(c.videoUrl)
      const display = str(c.displayUrl)
      if (video) {
        videos.push(video)
        if (display) videoPreviews.push(display)
      } else if (display) {
        images.push(display)
      }
    }
    return { images, videos, videoPreviews }
  }
  const video = str(it.videoUrl)
  const display = str(it.displayUrl)
  if (video) {
    videos.push(video)
    if (display) videoPreviews.push(display)
  } else if (display) {
    images.push(display)
  }
  return { images, videos, videoPreviews }
}

/** Project raw actor items to trim posts (raw items are tens of KB — nested comments, etc.). */
export function projectInstagramPosts(items: Raw[], limit: number): InstagramPost[] {
  const out: InstagramPost[] = []
  const seen = new Set<string>()
  for (const it of items) {
    const shortCode = str(it.shortCode)
    const postId = str(it.id) || shortCode
    if (!postId || seen.has(postId)) continue
    seen.add(postId)
    const media = collectMedia(it)
    out.push({
      postId,
      shortCode,
      url: str(it.url) || (shortCode ? `https://www.instagram.com/p/${shortCode}/` : ""),
      type: mapType(it.type),
      caption: str(it.caption),
      ownerUsername: str(it.ownerUsername),
      ownerFullName: str(it.ownerFullName),
      timestamp: str(it.timestamp) || null,
      likesCount: num(it.likesCount),
      commentsCount: num(it.commentsCount),
      videoViewCount: num(it.videoViewCount),
      hashtags: Array.isArray(it.hashtags) ? (it.hashtags as unknown[]).filter((h): h is string => typeof h === "string") : [],
      locationName: str(it.locationName) || null,
      ...media,
      dimsWidth: num(it.dimensionsWidth),
      dimsHeight: num(it.dimensionsHeight),
    })
    if (out.length >= limit) break
  }
  return out
}

/** Keep posts within the window (the actor already trims, this catches slips), then per-source quota + total cap. */
export function selectInstagramPosts(
  items: Raw[],
  opts: { count: number; sources: number; period: InstagramScrapePeriod; mode: InstagramScrapeMode; now?: Date },
): InstagramPost[] {
  const now = opts.now ?? new Date()
  // A post link names its post whatever its age — no date window in post mode.
  const windowMs = opts.mode === "post" ? null : PERIOD_MS[opts.period]
  const inWindow = projectInstagramPosts(items, Number.POSITIVE_INFINITY).filter((p) => {
    if (windowMs === null || !p.timestamp) return true
    const t = Date.parse(p.timestamp)
    return Number.isNaN(t) ? true : now.getTime() - t <= windowMs
  })

  // Per-source quota keyed on the input url (hashtag feeds carry many owners,
  // so owner is NOT the source) — but projection dropped inputUrl, so re-read
  // it from the raw items in order, matched by shortCode.
  const inputByShort = new Map<string, string>()
  for (const it of items) {
    const sc = str(it.shortCode) || str(it.id)
    if (sc && !inputByShort.has(sc)) inputByShort.set(sc, str(it.inputUrl))
  }
  const perSource = new Map<string, number>()
  const out: InstagramPost[] = []
  for (const p of inWindow) {
    // Source key: the actor's inputUrl (present on every item in practice; one
    // per profile). If it is ever missing, fall back to the owner in PROFILE
    // mode (one owner per profile); in hashtag mode leave it UNKEYED rather
    // than collapse every post into one capped bucket — collapsing would trim
    // the run to `count` and under-deliver what the user paid `count × sources`
    // for. Unkeyed posts are bounded only by the total cap below.
    const inputUrl = inputByShort.get(p.shortCode || p.postId) || ""
    const key = inputUrl || (opts.mode === "profile" && p.ownerUsername ? `owner:${p.ownerUsername.toLowerCase()}` : "")
    if (key) {
      const taken = perSource.get(key) ?? 0
      if (taken >= opts.count) continue
      perSource.set(key, taken + 1)
    }
    out.push(p)
    if (out.length >= opts.count * opts.sources) break
  }
  return out
}

interface ActorRunLike {
  id?: string
  status?: string
  defaultDatasetId: string
}

export async function runInstagramScrape(args: InstagramScrapeArgs): Promise<InstagramScrapeOutput> {
  const input = buildInstagramActorInput(args)
  const sources = args.targets.length
  const perSource = Math.min(instagramRequestedCount(args.mode, args.count), INSTAGRAM_SCRAPE_MAX_COUNT)
  const maxItems = perSource * Math.max(1, sources)
  try {
    const client = getApifyClient()
    const run = (await client
      .actor(INSTAGRAM_ACTOR.apifyActorId)
      .call(input, { waitSecs: INSTAGRAM_ACTOR.timeoutSecs, timeout: INSTAGRAM_ACTOR.timeoutSecs, maxItems })) as ActorRunLike

    if (run.status === "RUNNING" || run.status === "READY") {
      if (run.id) {
        await client.run(run.id).abort().catch((err: unknown) => {
          console.warn(`[${CONTEXT}] abort of run ${run.id} failed: ${err instanceof Error ? err.message : String(err)}`)
        })
      }
      throw new Error(`timeout: actor run still ${run.status} after ${INSTAGRAM_ACTOR.timeoutSecs}s`)
    }
    if (run.status && run.status !== "SUCCEEDED") {
      throw new Error(run.status.includes("TIM") ? `timeout: actor run ${run.status}` : `actor run ${run.status}`)
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems()
    return { json: selectInstagramPosts(items as Raw[], { count: perSource, sources: Math.max(1, sources), period: args.period, mode: args.mode }) }
  } catch (err) {
    if (err instanceof MissingProviderKeyError) throw err
    throw sanitizeApifyError(err, CONTEXT)
  }
}

/** The primary creative's classify url (a video's poster, else the first image) and its known dims — for the media step. */
export function instagramKnownDims(post: InstagramPost): Record<string, { width: number; height: number }> {
  const primary = post.videoPreviews[0] ?? post.images[0]
  if (primary && post.dimsWidth && post.dimsHeight && post.dimsWidth > 0 && post.dimsHeight > 0) {
    return { [primary]: { width: post.dimsWidth, height: post.dimsHeight } }
  }
  return {}
}

export { classifyCreativeFormat }
