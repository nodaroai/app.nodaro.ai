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

export const TREND_CANDIDATE_SORTS = ["creators", "dayChange", "firstSeen"] as const
export type TrendCandidateSort = (typeof TREND_CANDIDATE_SORTS)[number]

export type TrendCandidatePlatform = "tiktok" | "instagram" | "youtube"

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
  /** The platform's own still, when it gave one (a short-lived link). */
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
}

export interface TrendCandidateCard {
  id: string
  name: string
  slug: string
  status: TrendCandidateStatus
  label: TrendCandidateLabel
  soundName: string | null
  durationSec: number | null
  creators: number
  plays: number
  dayChangePct: number | null
  firstSeen: TrendCandidateSource
  topPost: TrendCandidatePost | null
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
}

export interface TrendRadarSettings {
  sources: TrendRadarSource[]
  thresholds: TrendRadarThresholds
  alerts: TrendRadarAlerts
  retentionDays: number
  /** `HH:MM`, Israel time. */
  runAt: string
}

export interface TrendRadarSummary {
  lastRun: TrendRadarLastRun | null
  counts: { candidates: number; watching: number; slowing: number }
  searchesToday: number
  dailySearchBudget: number
}

export const DEFAULT_THRESHOLDS: TrendRadarThresholds = {
  minCreators: 5,
  windowDays: 21,
  risingPct: 15,
  slowingPct: 1,
  maxClipSec: 30,
  dailySearchBudget: 60,
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
