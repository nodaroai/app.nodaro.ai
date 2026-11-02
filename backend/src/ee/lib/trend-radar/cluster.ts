/**
 * What a name's public posts say about it: how many distinct creators posted
 * it, the plays they add up to, the sound most of them share, and the top
 * posts as links. Pure over Social Search's posts (`@nodaro/shared`'s
 * `SocialPost`); nothing here fetches.
 */
import type { SocialPost } from "@nodaro/shared/social"
import type { TrendCandidatePlatform, TrendCandidatePost } from "./types.js"

export interface ClipCluster {
  creators: number
  plays: number
  posts: number
  soundName: string | null
  durationSec: number | null
  top: TrendCandidatePost[]
}

const PLATFORMS: ReadonlySet<string> = new Set(["tiktok", "instagram", "youtube"])

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

/**
 * The cluster of one name's posts. Posts are the search's answer for the name,
 * so every post counts; a creator counts once however many posts they made.
 * The sound is the one most posts share; the length the median of the posts
 * that state one.
 */
export function clusterPosts(posts: readonly SocialPost[], topCount = 5): ClipCluster {
  const creators = new Set<string>()
  const sounds = new Map<string, number>()
  const durations: number[] = []
  let plays = 0
  const converted: Array<{ post: TrendCandidatePost; plays: number }> = []
  for (const p of posts) {
    const post = toCandidatePost(p)
    if (!post) continue
    creators.add(post.author.toLowerCase())
    const n = playsOf(p)
    plays += n
    const s = soundOf(p)
    if (s) sounds.set(s, (sounds.get(s) ?? 0) + 1)
    if (post.durationSec !== null) durations.push(post.durationSec)
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
  durations.sort((a, b) => a - b)
  const durationSec = durations.length ? durations[Math.floor(durations.length / 2)]! : null
  const top = converted
    .sort((a, b) => b.plays - a.plays)
    .slice(0, topCount)
    .map((c) => c.post)
  return { creators: creators.size, plays, posts: converted.length, soundName, durationSec, top }
}
