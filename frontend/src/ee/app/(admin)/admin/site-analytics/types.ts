/** What GET /v1/admin/site-analytics answers — mirrors backend/src/ee/lib/site-analytics. */

export type SiteAnalyticsDays = 7 | 28 | 90
export const SITE_ANALYTICS_DAYS: readonly SiteAnalyticsDays[] = [7, 28, 90]

export interface TrafficTotals {
  views: number
  activeUsers: number
  engagementSeconds: number
  events: number
}

export interface TrafficDay {
  date: string
  views: number
  activeUsers: number
}

export interface TrafficRow extends TrafficTotals {
  key: string
  host?: string
  path?: string
}

export interface TrafficReport {
  totals: TrafficTotals
  daily: TrafficDay[]
  /** The busiest pages Google sent; `pagesTotal` is how many it has in all. */
  pages: TrafficRow[]
  pagesTotal: number
  titles: TrafficRow[]
  titlesTotal: number
}

export interface SearchTotals {
  clicks: number
  impressions: number
  /** 0–1. */
  ctr: number
  position: number
}

export interface SearchRow extends SearchTotals {
  key: string
}

export interface SearchDay {
  date: string
  clicks: number
  impressions: number
}

export interface SitemapStatus {
  path: string
  lastSubmitted?: string
  lastDownloaded?: string
  isPending: boolean
  warnings: number
  errors: number
  contents: Array<{ type: string; submitted: number }>
}

export interface SearchReport {
  window: { startDate: string; endDate: string }
  totals: SearchTotals
  daily: SearchDay[]
  pages: SearchRow[]
  /** Google sent only its top rows — there are more. */
  pagesCapped: boolean
  queries: SearchRow[]
  queriesCapped: boolean
  /** Null when Google could not list them; the numbers above still stand. */
  sitemaps: SitemapStatus[] | null
  sitemapsError?: string
}

export interface IndexStatus {
  url: string
  verdict: string
  coverageState?: string
  indexingState?: string
  pageFetchState?: string
  lastCrawlTime?: string
  googleCanonical?: string
  inspectionLink?: string
  checkedAt: string
}

/** Why a section has no data: Google's words and status, and its code — PERMISSION_DENIED, SERVICE_DISABLED, KEY_FILE, … */
export interface SectionFailure {
  status: "error"
  message: string
  httpStatus?: number
  reason?: string
}

export type SectionResult<T> = { status: "ok"; data: T; fetchedAt: string } | { status: "not_configured" } | SectionFailure

export interface SetupView {
  serviceAccountEmail: string | null
  ga4PropertyId: string | null
  searchConsoleSite: string | null
  problems: string[]
}

export interface SiteAnalyticsReport {
  days: SiteAnalyticsDays
  setup: SetupView
  traffic: SectionResult<TrafficReport>
  search: SectionResult<SearchReport>
}
