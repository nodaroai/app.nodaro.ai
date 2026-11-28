/**
 * Trend Radar — the wire shapes of `/v1/trend-radar/*` (`routes/trend-radar.ts`).
 *
 * A candidate is a short clip several different creators recast within a few
 * weeks. The daily run (`run.ts`) finds names on template sites' public
 * sitemaps, reads each name's public posts through Social Search, counts the
 * distinct creators and the plays, and keeps one reading per day. An admin
 * approves a candidate into a draft trend by hand; nothing is published by
 * the run.
 *
 * Mirrored by `@nodaro/sdk`'s `trend-radar` resource (`packages/client/src/
 * resources/trend-radar.ts`): keep the two in step.
 */

export const TREND_CANDIDATE_STATUSES = ["watching", "candidate", "slowing", "approved", "rejected", "archived"] as const
export type TrendCandidateStatus = (typeof TREND_CANDIDATE_STATUSES)[number]

export const TREND_CANDIDATE_LABELS = ["new", "watching", "rising", "hot", "slowing"] as const
export type TrendCandidateLabel = (typeof TREND_CANDIDATE_LABELS)[number]

export const TREND_RADAR_SOURCE_KINDS = ["sitemap", "social", "suggest"] as const
export type TrendRadarSourceKind = (typeof TREND_RADAR_SOURCE_KINDS)[number]

export const TREND_CANDIDATE_SORTS = ["creators", "dayChange", "firstSeen", "plays"] as const
export type TrendCandidateSort = (typeof TREND_CANDIDATE_SORTS)[number]

export const TREND_CANDIDATE_PLATFORMS = ["tiktok", "instagram", "youtube"] as const
export type TrendCandidatePlatform = (typeof TREND_CANDIDATE_PLATFORMS)[number]

export interface TrendCandidateSource {
  kind: "template-site" | "social"
  name: string
  url: string | null
  firstSeenAt: string
}

/** One public post, as a link and its public counts. */
export interface TrendCandidatePost {
  platform: TrendCandidatePlatform
  url: string
  author: string
  postedAt: string | null
  plays: number | null
  likes: number | null
  soundName: string | null
  /** A small copy of the post's still kept on this deployment's storage (`stills.ts`); else the platform's own, a link that stops answering within hours. */
  stillUrl: string | null
  /** The platform's own player for the post, when it has one. */
  embedUrl: string | null
  durationSec: number | null
}

/** One day's reading of a candidate. */
export interface TrendCandidateReading {
  /** `YYYY-MM-DD`, in Israel time. */
  date: string
  creators: number
  plays: number
  posts: number
  /**
   * Plays growth per day, percent, over the posts this reading and the
   * previous one both saw; `null` on the first reading, when no post was seen
   * twice, or on a reading from before it was measured.
   */
  growthPct: number | null
}

/** One platform's share of a candidate's last reading. */
export interface TrendCandidatePlatformStats {
  posts: number
  creators: number
  plays: number
  /** The search returned as many posts as it may: more creators likely posted it than were counted. */
  capped: boolean
  top: TrendCandidatePost | null
}

export type TrendCandidatePlatforms = Partial<Record<TrendCandidatePlatform, TrendCandidatePlatformStats>>

export interface TrendCandidateCard {
  id: string
  name: string
  slug: string
  status: TrendCandidateStatus
  label: TrendCandidateLabel
  soundName: string | null
  durationSec: number | null
  creators: number
  /** A platform's search returned its most posts: the true count is likely higher. */
  creatorsCapped: boolean
  plays: number
  /** Growth per day of the latest reading (its `growthPct`, else the summed-plays change). */
  dayChangePct: number | null
  firstSeen: TrendCandidateSource
  topPost: TrendCandidatePost | null
  platforms: TrendCandidatePlatforms
  /** The earliest post date the readings saw. */
  firstPostedAt: string | null
  lastReadAt: string | null
  passedAt: string | null
  trendId: string | null
  createdAt: string
  updatedAt: string
}

export interface TrendCandidateTemplate {
  site: string
  url: string
  since: string | null
  note: string | null
}

export interface TrendCandidateSearch {
  /** Whether the search engine suggests "<name> ai"; `null` when not checked. */
  suggest: boolean | null
  interest7d: { from: number; to: number } | null
  checkedAt: string
}

export interface TrendCandidateEvent {
  at: string
  event: string
  detail: string | null
}

export interface TrendCandidateCheck {
  key: string
  label: string
  hint: string | null
  /** What the run can tell: `true` / `false`, or `null` when only a person can. */
  auto: boolean | null
}

export interface TrendCandidate extends TrendCandidateCard {
  summary: string | null
  posts: TrendCandidatePost[]
  readings: TrendCandidateReading[]
  templatesElsewhere: TrendCandidateTemplate[]
  search: TrendCandidateSearch | null
  history: TrendCandidateEvent[]
  checklist: TrendCandidateCheck[]
  rejectReason: string | null
}

export interface TrendRadarSource {
  id: string
  name: string
  kind: TrendRadarSourceKind
  url: string | null
  enabled: boolean
  lastReadAt: string | null
  pages: number | null
  newToday: number | null
  lastError: string | null
}

export interface TrendRadarThresholds {
  minCreators: number
  windowDays: number
  risingPct: number
  slowingPct: number
  maxClipSec: number
  dailySearchBudget: number
}

export interface TrendRadarAlerts {
  slackNewCandidate: boolean
  slackDailySummary: boolean
}

export interface TrendRadarLastRun {
  at: string
  sourcesRead: number
  namesSeen: number
  searchesUsed: number
  /** Why the run stopped before every candidate it could afford was read (the search account ran out of credits); absent when it did not. */
  stoppedEarly?: string | null
}

export interface TrendRadarSettings {
  sources: TrendRadarSource[]
  thresholds: TrendRadarThresholds
  alerts: TrendRadarAlerts
  retentionDays: number
  /** `HH:MM`, Israel time. */
  runAt: string
}

/** What a day's reading costs, so the budget can be set in candidates and credits rather than searches. */
export interface TrendRadarReadingCost {
  /** Searches one candidate's reading takes: one per platform. */
  searchesPerRead: number
  /** Credits one candidate's reading is charged to the account the run searches as; null when the price could not be read. */
  creditsPerRead: number | null
  /** Credits that account holds now; null when there is no runner yet or the balance could not be read. */
  runnerCredits: number | null
  /** The highest daily search budget the settings take. */
  maxSearchesPerDay: number
  /** Extra searches at most one candidate's deeper count makes (a platform whose search came back full, searched again in other orders); they come out of the same daily budget. */
  deepSearchesMax: number
  /** Credits one of those extra searches is charged; null when the price could not be read. */
  creditsPerDeepSearch: number | null
}

export interface TrendRadarSummary {
  lastRun: TrendRadarLastRun | null
  counts: { candidates: number; watching: number; slowing: number }
  searchesToday: number
  dailySearchBudget: number
  /** What reading costs; absent from a server older than this field. */
  reading?: TrendRadarReadingCost
}

/** The highest daily search budget the settings take. */
export const DAILY_SEARCH_BUDGET_MAX = 5000

export const DEFAULT_THRESHOLDS: TrendRadarThresholds = {
  minCreators: 5,
  windowDays: 21,
  risingPct: 15,
  slowingPct: 1,
  maxClipSec: 30,
  dailySearchBudget: 900,
}

export const DEFAULT_ALERTS: TrendRadarAlerts = {
  slackNewCandidate: true,
  slackDailySummary: false,
}

/** The thresholds a candidate is held to, as the run read them; the admin's settings, nothing else. */
export function candidateChecklist(c: Pick<TrendCandidate, "creators" | "durationSec">, thresholds: TrendRadarThresholds): TrendCandidateCheck[] {
  return [
    {
      key: "creators",
      label: `${thresholds.minCreators} or more distinct creators`,
      hint: `${c.creators} found`,
      auto: c.creators >= thresholds.minCreators,
    },
    {
      key: "length",
      label: `Clip is ${thresholds.maxClipSec}s or less`,
      hint: c.durationSec === null ? "Length not read yet" : `${c.durationSec}s`,
      auto: c.durationSec === null ? null : c.durationSec <= thresholds.maxClipSec,
    },
  ]
}
