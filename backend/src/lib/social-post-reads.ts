import { socialPostsFrom, type CompetitorReadRole, type SavedPost, type SocialPlatform, type SocialPost } from "@nodaro/shared"
import type { SocialReadRange } from "./social-read-period.js"

/**
 * The pure half of Read Inspiration and Read Competitor (routes in
 * `routes/social-post-reads.ts`): which scans a period needs, how a brand's
 * posts across those scans become one list, and how a saved post becomes the
 * post a node emits.
 */

/** How far back a scan reads (the competitors plugin's own window), so how long after a period a scan can still hold its posts. */
export const SCAN_LOOKBACK_MS = 45 * 24 * 3_600_000
/** The most scans one run reads (each is one in-process request for its posts). */
export const COMPETITOR_READ_MAX_SCANS = 40

export interface ScanPoint {
  readonly id: string
  readonly at: string
}

export interface ScanPlan {
  /** The scans to read for the period's posts. */
  readonly read: ScanPoint[]
  /**
   * The last scan before the period. An undated post it already holds was
   * first seen before the period, so it is not the period's; it is read only
   * when the period's scans hold an undated post.
   */
  readonly before: ScanPoint | null
}

/**
 * The scans a period needs. A scan reads each account's latest posts, about a
 * month back, so a post is best read from the first scans after it:
 *  - every scan taken inside the period, spread evenly over it when there are
 *    more than the cap (newest first, never two closer than period / cap), so
 *    a long period is covered end to end rather than only its newest weeks;
 *  - the first scan after the period, which holds its last posts;
 *  - the last scan before it, for undated posts (see `ScanPlan.before`).
 */
export function planScans(scans: readonly ScanPoint[], range: SocialReadRange, max: number = COMPETITOR_READ_MAX_SCANS): ScanPlan {
  const dated = scans.map((s) => ({ s, at: Date.parse(s.at) })).filter((x) => Number.isFinite(x.at))
  const inside = dated.filter((x) => x.at >= range.from && x.at < range.to).sort((a, b) => b.at - a.at)
  const after = dated.filter((x) => x.at >= range.to && x.at < range.to + SCAN_LOOKBACK_MS).sort((a, b) => a.at - b.at)[0]
  const before = dated.filter((x) => x.at < range.from).sort((a, b) => b.at - a.at)[0]
  const room = Math.max(1, max - (after ? 1 : 0))
  const gap = inside.length > room ? (range.to - range.from) / room : 0
  const kept: typeof inside = []
  for (const x of inside) {
    if (kept.length >= room) break
    const last = kept[kept.length - 1]
    if (!last || last.at - x.at >= gap) kept.push(x)
  }
  return { read: [...(after ? [after] : []), ...kept].map((x) => x.s), before: before?.s ?? null }
}

export interface ScanPosts {
  readonly at: string
  readonly posts: unknown
}

export interface CompetitorPostFilter {
  readonly range: SocialReadRange
  readonly role: CompetitorReadRole
  readonly platform?: SocialPlatform
  readonly order: "newest" | "oldest"
  readonly limit: number
}

/** A post Read Competitor emits: the post as a scan found it, with its role when the scan named one. */
export type CompetitorReadPost = SocialPost & { readonly role?: "own" | "about" | "market" }

const ROLES = new Set(["own", "about", "market"])

const hasDate = (post: SocialPost): boolean => typeof post.publishedAt === "string" && Number.isFinite(Date.parse(post.publishedAt))

/** The undated posts a scan holds — the ones first seen no later than it. */
export function undatedPostIds(scan: ScanPosts): Set<string> {
  return new Set(socialPostsFrom(scan.posts).filter((p) => !hasDate(p)).map((p) => p.id))
}

/** True when any scan holds a post with no date (only then is the scan before the period worth reading). */
export function hasUndatedPosts(scans: readonly ScanPosts[]): boolean {
  return scans.some((s) => socialPostsFrom(s.posts).some((p) => !hasDate(p)))
}

/**
 * A brand's posts across scans as one list: each post once, with the newest
 * scan's numbers; only the role and platform asked for (a post whose role the
 * scan did not name counts only under "all"); only posts that count on a day
 * inside the range — their own date, else the day the first scan saw them, and
 * never an undated post already held by the scan before the period; in the
 * asked order, up to the limit.
 */
export function competitorPostsFromScans(scans: readonly ScanPosts[], filter: CompetitorPostFilter, seenBefore: ReadonlySet<string> = new Set()): CompetitorReadPost[] {
  const newestFirst = [...scans].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const byId = new Map<string, CompetitorReadPost>()
  const firstSeen = new Map<string, number>()
  for (const scan of newestFirst) {
    const at = Date.parse(scan.at)
    for (const post of socialPostsFrom(scan.posts)) {
      if (!byId.has(post.id)) {
        const role = (post as { role?: unknown }).role
        const { role: _drop, ...rest } = post as SocialPost & { role?: unknown }
        byId.set(post.id, typeof role === "string" && ROLES.has(role) ? { ...rest, role: role as CompetitorReadPost["role"] } : rest)
      }
      const seen = firstSeen.get(post.id)
      if (Number.isFinite(at) && (seen === undefined || at < seen)) firstSeen.set(post.id, at)
    }
  }
  const timeOf = (p: CompetitorReadPost): number => {
    if (hasDate(p)) return Date.parse(p.publishedAt as string)
    return seenBefore.has(p.id) ? NaN : (firstSeen.get(p.id) ?? NaN)
  }
  const kept = [...byId.values()]
    .filter((p) => filter.role === "all" || p.role === filter.role)
    .filter((p) => !filter.platform || p.platform === filter.platform)
    .map((p) => ({ post: p, at: timeOf(p) }))
    .filter(({ at }) => Number.isFinite(at) && at >= filter.range.from && at < filter.range.to)
  kept.sort((a, b) => (filter.order === "oldest" ? a.at - b.at : b.at - a.at))
  return kept.slice(0, filter.limit).map(({ post }) => post)
}

/** A post Read Inspiration emits: the post as saved, with when it was saved, its note and its tags. */
export type InspirationPost = SocialPost & {
  readonly savedAt: string
  readonly note?: string
  readonly tags?: readonly string[]
}

/**
 * A saved post as Read Inspiration emits it. The still copied into the
 * person's storage replaces the post's own thumbnail: a platform's link
 * expires within days, the copy does not.
 */
export function inspirationPostOf(saved: SavedPost): InspirationPost {
  const post = saved.post
  const media = saved.thumbnailUrl ? { ...post.media, thumbnailUrl: saved.thumbnailUrl } : post.media
  return {
    ...post,
    media,
    savedAt: saved.createdAt,
    ...(saved.note.trim() ? { note: saved.note } : {}),
    ...(saved.tags.length > 0 ? { tags: saved.tags } : {}),
  }
}
