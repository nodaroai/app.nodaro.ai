/**
 * What a name's public posts say about it: how many distinct creators posted
 * it, the plays they add up to, the sound most of them share, each
 * platform's share, and the top posts as links. Pure over Social Search's
 * posts (`@nodaro/shared`'s `SocialPost`); nothing here fetches.
 */
import type { SocialPost } from "@nodaro/shared/social"
import { TREND_CANDIDATE_PLATFORMS, type TrendCandidatePlatform, type TrendCandidatePost } from "./types.js"

/** One platform's share before the run knows whether its search was capped. */
export interface PlatformCluster {
  posts: number
  creators: number
  plays: number
  top: TrendCandidatePost | null
}

export interface ClipCluster {
  creators: number
  plays: number
  posts: number
  soundName: string | null
  durationSec: number | null
  top: TrendCandidatePost[]
  platforms: Partial<Record<TrendCandidatePlatform, PlatformCluster>>
  /** Post id (`<platform>:<id>`) -> its plays: what the next reading's growth is read against. */
  panel: Record<string, number>
  /** The earliest post date among the posts; `null` when none states one. */
  firstPostedAt: string | null
}

const PLATFORMS: ReadonlySet<string> = new Set(TREND_CANDIDATE_PLATFORMS)

/** The most posts `posts` (and so the candidate page) carries. */
export const TOP_POSTS_MAX = 8

function soundOf(p: SocialPost): string | null {
  const s = p.extra?.sound
  if (typeof s === "string" && s.trim()) return s.trim()
  if (s && typeof s === "object" && typeof (s as { title?: unknown }).title === "string") {
    const t = (s as { title: string }).title.trim()
    return t || null
  }
  return null
}

/** Instagram hides views to a logged-out reader, so its count is likes. */
function playsOf(p: SocialPost): number {
  const v = p.metrics.views
  if (typeof v === "number" && v > 0) return v
  const l = p.metrics.likes
  return typeof l === "number" && l > 0 ? l : 0
}

function embedUrlOf(p: SocialPost): string | null {
  try {
    const u = new URL(p.url)
    if (p.platform === "youtube") {
      const id = u.searchParams.get("v") ?? (u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : null)
      return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : null
    }
    if (p.platform === "tiktok") {
      const id = u.pathname.split("/").filter(Boolean).pop()
      return id && /^\d+$/.test(id) ? `https://www.tiktok.com/embed/v2/${id}` : null
    }
    if (p.platform === "instagram") {
      const m = /\/(p|reel|reels)\/([A-Za-z0-9_-]+)/.exec(u.pathname)
      return m ? `https://www.instagram.com/${m[1] === "p" ? "p" : "reel"}/${m[2]}/embed` : null
    }
  } catch {
    /* not a URL */
  }
  return null
}

export function toCandidatePost(p: SocialPost): TrendCandidatePost | null {
  if (!PLATFORMS.has(p.platform)) return null
  return {
    platform: p.platform as TrendCandidatePlatform,
    url: p.url,
    author: p.author.handle || p.author.name,
    postedAt: p.publishedAt ?? null,
    plays: typeof p.metrics.views === "number" ? p.metrics.views : null,
    likes: typeof p.metrics.likes === "number" ? p.metrics.likes : null,
    soundName: soundOf(p),
    stillUrl: p.media.thumbnailUrl ?? null,
    embedUrl: embedUrlOf(p),
    durationSec: typeof p.media.durationSec === "number" ? Math.round(p.media.durationSec) : null,
  }
}

function validTime(iso: string | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

interface Converted {
  post: TrendCandidatePost
  plays: number
}

/**
 * The top posts: each platform's most-played, then the most-played overall,
 * without repeats, up to `max`, most-played first — so every platform with
 * posts has a playable post in the list.
 */
function topPosts(converted: readonly Converted[], max: number): TrendCandidatePost[] {
  const byPlays = [...converted].sort((a, b) => b.plays - a.plays)
  const firstOfEach = TREND_CANDIDATE_PLATFORMS.map((platform) => byPlays.find((c) => c.post.platform === platform)).filter((c): c is Converted => c !== undefined)
  const picked = new Set<Converted>(firstOfEach.slice(0, max))
  for (const c of byPlays) {
    if (picked.size >= max) break
    picked.add(c)
  }
  return [...picked].sort((a, b) => b.plays - a.plays).map((c) => c.post)
}

function platformShares(converted: readonly Converted[]): Partial<Record<TrendCandidatePlatform, PlatformCluster>> {
  const shares: Partial<Record<TrendCandidatePlatform, PlatformCluster>> = {}
  for (const platform of TREND_CANDIDATE_PLATFORMS) {
    const mine = converted.filter((c) => c.post.platform === platform)
    if (mine.length === 0) continue
    const best = mine.reduce((a, b) => (b.plays > a.plays ? b : a))
    shares[platform] = {
      posts: mine.length,
      creators: new Set(mine.map((c) => c.post.author.toLowerCase())).size,
      plays: mine.reduce((sum, c) => sum + c.plays, 0),
      top: best.post,
    }
  }
  return shares
}

/**
 * The cluster of one name's posts. Posts are the searches' answers for the
 * name, so every post counts; a creator counts once per platform however many
 * posts they made (the same handle on two platforms is two accounts). The
 * sound is the one most posts share; the length the median of the posts that
 * state one.
 */
export function clusterPosts(posts: readonly SocialPost[], topCount = TOP_POSTS_MAX): ClipCluster {
  const creators = new Set<string>()
  const sounds = new Map<string, number>()
  const durations: number[] = []
  const panel: Record<string, number> = {}
  const converted: Converted[] = []
  let plays = 0
  let earliest: number | null = null
  let earliestIso: string | null = null
  for (const p of posts) {
    const post = toCandidatePost(p)
    if (!post) continue
    creators.add(`${post.platform}:${post.author.toLowerCase()}`)
    const n = playsOf(p)
    plays += n
    panel[p.id] = n
    const s = soundOf(p)
    if (s) sounds.set(s, (sounds.get(s) ?? 0) + 1)
    if (post.durationSec !== null) durations.push(post.durationSec)
    const at = validTime(p.publishedAt)
    if (at !== null && (earliest === null || at < earliest)) {
      earliest = at
      earliestIso = new Date(at).toISOString()
    }
    converted.push({ post, plays: n })
  }
  let soundName: string | null = null
  let best = 0
  for (const [s, n] of sounds) {
    if (n > best) {
      best = n
      soundName = s
    }
  }
  const sortedDurations = [...durations].sort((a, b) => a - b)
  const durationSec = sortedDurations.length ? sortedDurations[Math.floor(sortedDurations.length / 2)]! : null
  return {
    creators: creators.size,
    plays,
    posts: converted.length,
    soundName,
    durationSec,
    top: topPosts(converted, topCount),
    platforms: platformShares(converted),
    panel,
    firstPostedAt: earliestIso,
  }
}

/**
 * Plays growth per day, percent (one decimal), over the posts both panels
 * saw: the summed plays of those posts now against then, spread over the
 * days between the two readings (compounded). `null` without a previous
 * panel, with no post seen twice, or with no plays to grow from.
 */
export function panelGrowthPct(previous: Readonly<Record<string, number>> | null | undefined, next: Readonly<Record<string, number>>, days: number): number | null {
  if (!previous) return null
  let base = 0
  let now = 0
  let common = 0
  for (const [id, plays] of Object.entries(next)) {
    const before = previous[id]
    if (typeof before !== "number" || !Number.isFinite(before)) continue
    common++
    base += before
    now += plays
  }
  if (common === 0 || base <= 0) return null
  const span = Math.max(1, Math.round(days))
  const perDay = (Math.pow(now / base, 1 / span) - 1) * 100
  // `+ 0` turns a rounded -0 into 0.
  return Math.round(perDay * 10) / 10 + 0
}
