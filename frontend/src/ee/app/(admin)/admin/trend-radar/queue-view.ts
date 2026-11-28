// What the queue shows: the view (gallery or table), the filters and the
// sort, read from and written to the page's address so a view can be kept or
// sent. Pure over the candidate cards; nothing here fetches. The status is the
// one filter the server applies (each status is its own list); everything else
// runs over the cards already loaded.

import type { TrendCandidateCard, TrendCandidatePlatform, TrendCandidatePost, TrendCandidateStatus } from "@nodaro/sdk/trend-radar"

export const QUEUE_VIEWS = ["gallery", "table"] as const
export type QueueView = (typeof QUEUE_VIEWS)[number]

export const QUEUE_PLATFORMS: readonly TrendCandidatePlatform[] = ["tiktok", "instagram", "youtube"]

/** People first: a clip many people recast is a trend; one big video few copy is not. */
export const QUEUE_SORTS = ["creators", "plays", "growth", "newest", "found"] as const
export type QueueSort = (typeof QUEUE_SORTS)[number]

export const QUEUE_SORT_LABELS: Record<QueueSort, string> = {
  creators: "People, most first",
  plays: "Views, most first",
  growth: "Growing fastest",
  newest: "Newest trend",
  found: "Recently found",
}

/** The people floors offered (distinct accounts that posted it); 0 is "any". */
export const MIN_CREATORS_OPTIONS = [0, 5, 10, 20, 50] as const

/** The views floors offered; 0 is "any". */
export const MIN_PLAYS_OPTIONS = [0, 100_000, 1_000_000, 10_000_000, 50_000_000] as const

/** How old a trend may be, in days since its earliest post; `null` is "any age". */
export const MAX_AGE_OPTIONS = [null, 7, 14, 30] as const

export type QueueStatus = "all" | TrendCandidateStatus

export interface QueueFilters {
  view: QueueView
  status: QueueStatus
  platform: "all" | TrendCandidatePlatform
  /** A first-seen site's name, or "all". */
  source: string
  minPlays: number
  /** At least this many people posted it; 0 is any. */
  minCreators: number
  maxAgeDays: number | null
  /** Matched against the name and the sound. */
  q: string
  sort: QueueSort
}

export const DEFAULT_FILTERS: QueueFilters = {
  view: "gallery",
  status: "all",
  platform: "all",
  source: "all",
  minPlays: 0,
  minCreators: 0,
  maxAgeDays: null,
  q: "",
  sort: "creators",
}

const STATUSES: readonly QueueStatus[] = ["all", "watching", "candidate", "slowing", "approved", "rejected", "archived"]

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function wholeNumber(value: string | null): number | null {
  if (value === null || !/^\d{1,12}$/.test(value)) return null
  return Number.parseInt(value, 10)
}

/** The filters an address asks for; anything unknown or malformed falls back to the default. */
export function readFilters(params: URLSearchParams): QueueFilters {
  const minPlays = wholeNumber(params.get("views"))
  const minCreators = wholeNumber(params.get("people"))
  const maxAge = wholeNumber(params.get("age"))
  return {
    view: oneOf(params.get("view"), QUEUE_VIEWS, DEFAULT_FILTERS.view),
    status: oneOf(params.get("status"), STATUSES, DEFAULT_FILTERS.status),
    platform: oneOf(params.get("platform"), ["all", ...QUEUE_PLATFORMS], DEFAULT_FILTERS.platform),
    source: params.get("source")?.trim() || DEFAULT_FILTERS.source,
    minPlays: minPlays ?? DEFAULT_FILTERS.minPlays,
    minCreators: minCreators ?? DEFAULT_FILTERS.minCreators,
    maxAgeDays: maxAge !== null && maxAge > 0 ? maxAge : DEFAULT_FILTERS.maxAgeDays,
    q: (params.get("q") ?? "").slice(0, 100),
    sort: oneOf(params.get("sort"), QUEUE_SORTS, DEFAULT_FILTERS.sort),
  }
}

/** The address of these filters: only what differs from the default, so the plain page stays plain. */
export function writeFilters(f: QueueFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.view !== DEFAULT_FILTERS.view) p.set("view", f.view)
  if (f.status !== DEFAULT_FILTERS.status) p.set("status", f.status)
  if (f.platform !== DEFAULT_FILTERS.platform) p.set("platform", f.platform)
  if (f.source !== DEFAULT_FILTERS.source) p.set("source", f.source)
  if (f.minPlays !== DEFAULT_FILTERS.minPlays) p.set("views", String(f.minPlays))
  if (f.minCreators !== DEFAULT_FILTERS.minCreators) p.set("people", String(f.minCreators))
  if (f.maxAgeDays !== DEFAULT_FILTERS.maxAgeDays) p.set("age", String(f.maxAgeDays))
  if (f.q.trim()) p.set("q", f.q.trim())
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort)
  return p
}

/** The platforms a card has posts on. A card read before platforms were kept answers its top post's. */
export function cardPlatforms(c: TrendCandidateCard): TrendCandidatePlatform[] {
  const stats = c.platforms ?? {}
  const found = QUEUE_PLATFORMS.filter((p) => (stats[p]?.posts ?? 0) > 0)
  if (found.length) return found
  return c.topPost ? [c.topPost.platform] : []
}

/** The post a card shows: the platform's own top post when one platform is chosen, else the card's. */
export function cardPost(c: TrendCandidateCard, platform: QueueFilters["platform"]): TrendCandidatePost | null {
  if (platform !== "all") {
    const top = c.platforms?.[platform]?.top
    if (top) return top
    return c.topPost?.platform === platform ? c.topPost : null
  }
  return c.topPost
}

/** The views a card counts: the chosen platform's alone, else every platform's. */
export function cardPlays(c: TrendCandidateCard, platform: QueueFilters["platform"]): number {
  if (platform === "all") return c.plays
  const stats = c.platforms?.[platform]
  if (stats) return stats.plays
  // Read before platforms were kept: every post was on the top post's platform.
  return c.topPost?.platform === platform ? c.plays : 0
}

/** The people a card counts: the chosen platform's alone, else every platform's ("60+" when a search returned all it may). */
export function cardCreators(c: TrendCandidateCard, platform: QueueFilters["platform"]): Pick<TrendCandidateCard, "creators" | "creatorsCapped"> {
  if (platform === "all") return { creators: c.creators, creatorsCapped: c.creatorsCapped ?? false }
  const stats = c.platforms?.[platform]
  if (stats) return { creators: stats.creators, creatorsCapped: stats.capped }
  // Read before platforms were kept: every post was on the top post's platform.
  return c.topPost?.platform === platform ? { creators: c.creators, creatorsCapped: c.creatorsCapped ?? false } : { creators: 0, creatorsCapped: false }
}

/** When the trend started: the earliest post the readings saw, else the top post's date. */
export function trendStart(c: TrendCandidateCard): string | null {
  return c.firstPostedAt ?? c.topPost?.postedAt ?? null
}

const DAY_MS = 86_400_000

/** Whole days since the trend started; `null` when no post carried a date. */
export function trendAgeDays(c: TrendCandidateCard, now: Date): number | null {
  const start = trendStart(c)
  if (!start) return null
  const t = Date.parse(start)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS))
}

/** The first-seen sites among the cards, A to Z. */
export function sourceNames(cards: readonly TrendCandidateCard[]): string[] {
  return Array.from(new Set(cards.map((c) => c.firstSeen.name))).sort((a, b) => a.localeCompare(b))
}

/** How many cards have posts on each platform. */
export function platformCounts(cards: readonly TrendCandidateCard[]): Record<TrendCandidatePlatform, number> {
  const counts: Record<TrendCandidatePlatform, number> = { tiktok: 0, instagram: 0, youtube: 0 }
  for (const c of cards) for (const p of cardPlatforms(c)) counts[p] = counts[p] + 1
  return counts
}

function matchesText(c: TrendCandidateCard, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return c.name.toLowerCase().includes(needle) || (c.soundName ?? "").toLowerCase().includes(needle)
}

/** The cards these filters keep (the status was applied by the server). */
export function filterCards(cards: readonly TrendCandidateCard[], f: QueueFilters, now: Date): TrendCandidateCard[] {
  return cards.filter((c) => {
    if (f.platform !== "all" && !cardPlatforms(c).includes(f.platform)) return false
    if (f.source !== "all" && c.firstSeen.name !== f.source) return false
    if (f.minPlays > 0 && cardPlays(c, f.platform) < f.minPlays) return false
    if (f.minCreators > 0 && cardCreators(c, f.platform).creators < f.minCreators) return false
    if (f.maxAgeDays !== null) {
      const age = trendAgeDays(c, now)
      if (age === null || age > f.maxAgeDays) return false
    }
    return matchesText(c, f.q)
  })
}

function time(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

type Compare = (a: TrendCandidateCard, b: TrendCandidateCard) => number

const newestFound: Compare = (a, b) => (time(b.firstSeen.firstSeenAt) ?? 0) - (time(a.firstSeen.firstSeenAt) ?? 0)

/** Larger first, unknown values last; ties go to `tie` (by default the most recently found first). */
function byDescending(value: (c: TrendCandidateCard) => number | null, tie: Compare = newestFound): Compare {
  return (a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null && vb === null) return tie(a, b)
    if (va === null) return 1
    if (vb === null) return -1
    if (vb !== va) return vb - va
    return tie(a, b)
  }
}

/** The cards in the chosen order, as a new list. */
export function sortCards(cards: readonly TrendCandidateCard[], sort: QueueSort, platform: QueueFilters["platform"]): TrendCandidateCard[] {
  const compare = {
    // Equal people (a search's ceiling is often shared): the bigger one first.
    creators: byDescending((c) => cardCreators(c, platform).creators, byDescending((c) => cardPlays(c, platform))),
    plays: byDescending((c) => cardPlays(c, platform)),
    growth: byDescending((c) => c.dayChangePct),
    newest: byDescending((c) => time(trendStart(c))),
    found: byDescending((c) => time(c.firstSeen.firstSeenAt)),
  }[sort]
  return [...cards].sort(compare)
}

/** Creators as read: "60+" when a platform's search returned all it may. */
export function formatCreators(c: Pick<TrendCandidateCard, "creators" | "creatorsCapped">): string {
  return c.creatorsCapped ? `${c.creators}+` : String(c.creators)
}

/** "3d", "2w", "4mo" — how long ago the trend started. */
export function formatAge(days: number | null): string {
  if (days === null) return "—"
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 30)}mo`
}
