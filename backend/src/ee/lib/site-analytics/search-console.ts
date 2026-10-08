import { everyDay, shiftDay } from "./days.js"
import { GoogleApiError, googleJson, type FetchLike } from "./google-api.js"
import type { SiteAnalyticsDays } from "./ga4-report.js"

export interface SearchTotals {
  readonly clicks: number
  readonly impressions: number
  /** 0–1. */
  readonly ctr: number
  readonly position: number
}

/** One page or one search query. */
export interface SearchRow extends SearchTotals {
  readonly key: string
}

export interface SearchDay {
  readonly date: string
  readonly clicks: number
  readonly impressions: number
}

export interface SitemapStatus {
  readonly path: string
  readonly lastSubmitted?: string
  readonly lastDownloaded?: string
  readonly isPending: boolean
  readonly warnings: number
  readonly errors: number
  /** What the sitemap lists, per kind (web, image, video, …). */
  readonly contents: ReadonlyArray<{ readonly type: string; readonly submitted: number }>
}

export interface SearchReport {
  readonly window: { readonly startDate: string; readonly endDate: string }
  readonly totals: SearchTotals
  /** Every day of the window, a day without search data at zero. */
  readonly daily: readonly SearchDay[]
  readonly pages: readonly SearchRow[]
  /** Google gave its top ROWS_MAX — there are more. */
  readonly pagesCapped: boolean
  readonly queries: readonly SearchRow[]
  readonly queriesCapped: boolean
  /** Null when Google could not list them — the search numbers above still stand. */
  readonly sitemaps: readonly SitemapStatus[] | null
  readonly sitemapsError?: string
}

/** One page as Google's index sees it. URL Inspection has no video verdict — only the page's. */
export interface IndexStatus {
  readonly url: string
  /** PASS, PARTIAL, FAIL, NEUTRAL or VERDICT_UNSPECIFIED. */
  readonly verdict: string
  /** Google's sentence: "Submitted and indexed", "Crawled - currently not indexed", … */
  readonly coverageState?: string
  readonly indexingState?: string
  readonly pageFetchState?: string
  readonly lastCrawlTime?: string
  readonly googleCanonical?: string
  readonly inspectionLink?: string
  readonly checkedAt: string
}

const SEARCH_CONSOLE_API = "https://searchconsole.googleapis.com"
/** Search Console keeps its days on Pacific time. */
const SEARCH_CONSOLE_TIME_ZONE = "America/Los_Angeles"
export const ROWS_MAX = 250

const pacificDay = new Intl.DateTimeFormat("en-CA", { timeZone: SEARCH_CONSOLE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })

/** Today on Search Console's clock (also the day its URL Inspection quota resets on). */
export const searchConsoleToday = (now: Date): string => pacificDay.format(now)

/** The N days ending yesterday on Search Console's clock — the window its own presets use. */
export function searchWindow(days: SiteAnalyticsDays, now: Date): { startDate: string; endDate: string } {
  const endDate = shiftDay(searchConsoleToday(now), -1)
  return { startDate: shiftDay(endDate, -(days - 1)), endDate }
}

/**
 * The page as the site's own address, or null when the Search Console site
 * does not cover it: a domain property covers the domain and every
 * subdomain over http or https; a URL-prefix property covers what starts
 * with it. The parsed form (no fragment) is what gets checked, sent to
 * Google and cached — never the raw text, which could read one way and
 * parse another.
 */
export function siteUrlOf(url: string, site: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
  if (parsed.username || parsed.password) return null
  // A copy without its fragment — a bare trailing "#" included, which `hash` reports as "".
  const withoutFragment = new URL(parsed.href)
  withoutFragment.hash = ""
  const href = withoutFragment.href
  if (site.startsWith("sc-domain:")) {
    const domain = site.slice("sc-domain:".length)
    const host = parsed.hostname.toLowerCase()
    return host === domain || host.endsWith(`.${domain}`) ? href : null
  }
  return href.startsWith(site) ? href : null
}

export const urlBelongsToSite = (url: string, site: string): boolean => siteUrlOf(url, site) !== null

interface AnalyticsRow {
  keys?: string[]
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}
interface AnalyticsAnswer {
  rows?: AnalyticsRow[]
}
interface SitemapsAnswer {
  sitemap?: Array<{
    path?: string
    lastSubmitted?: string
    lastDownloaded?: string
    isPending?: boolean
    warnings?: string | number
    errors?: string | number
    contents?: Array<{ type?: string; submitted?: string | number }>
  }>
}

const totalsOf = (row: AnalyticsRow | undefined): SearchTotals => ({
  clicks: Number(row?.clicks) || 0,
  impressions: Number(row?.impressions) || 0,
  ctr: Number(row?.ctr) || 0,
  position: Number(row?.position) || 0,
})

const rowsOf = (answer: AnalyticsAnswer): SearchRow[] => (answer.rows ?? []).map((row) => ({ key: row.keys?.[0] ?? "", ...totalsOf(row) }))

function sitemapsOf(answer: SitemapsAnswer): SitemapStatus[] {
  return (answer.sitemap ?? []).map((s) => ({
    path: s.path ?? "",
    ...(s.lastSubmitted ? { lastSubmitted: s.lastSubmitted } : {}),
    ...(s.lastDownloaded ? { lastDownloaded: s.lastDownloaded } : {}),
    isPending: s.isPending === true,
    warnings: Number(s.warnings) || 0,
    errors: Number(s.errors) || 0,
    contents: (s.contents ?? []).map((c) => ({ type: c.type ?? "", submitted: Number(c.submitted) || 0 })),
  }))
}

const siteApi = (site: string) => `${SEARCH_CONSOLE_API}/webmasters/v3/sites/${encodeURIComponent(site)}`

/** Totals, each day, each page and each query over the window — with Google's newest, still-settling days — plus the sitemaps. */
export async function readSearchReport(opts: {
  site: string
  days: SiteAnalyticsDays
  token: string
  fetch: FetchLike
  now: Date
}): Promise<SearchReport> {
  const window = searchWindow(opts.days, opts.now)
  const query = (dimensions: string[], rowLimit?: number) =>
    googleJson<AnalyticsAnswer>(opts.fetch, `${siteApi(opts.site)}/searchAnalytics/query`, opts.token, {
      ...window,
      dimensions,
      dataState: "all",
      ...(rowLimit ? { rowLimit } : {}),
    })
  // The sitemaps are a side panel: their failure must not take the search numbers with it.
  const sitemapsCall = googleJson<SitemapsAnswer>(opts.fetch, `${siteApi(opts.site)}/sitemaps`, opts.token).then(
    (answer) => ({ sitemaps: sitemapsOf(answer) }),
    (error: unknown) => ({ sitemaps: null, sitemapsError: error instanceof GoogleApiError ? error.message : "Google could not list the sitemaps." }),
  )
  const [totals, daily, pages, queries, sitemaps] = await Promise.all([
    query([]),
    query(["date"], 100),
    query(["page"], ROWS_MAX),
    query(["query"], ROWS_MAX),
    sitemapsCall,
  ])
  const pageRows = rowsOf(pages)
  const queryRows = rowsOf(queries)
  const days = rowsOf(daily).map((row) => ({ date: row.key, clicks: row.clicks, impressions: row.impressions }))
  return {
    window,
    totals: totalsOf(totals.rows?.[0]),
    daily: everyDay(days, window.startDate, window.endDate, (date) => ({ date, clicks: 0, impressions: 0 })),
    pages: pageRows,
    pagesCapped: pageRows.length >= ROWS_MAX,
    queries: queryRows,
    queriesCapped: queryRows.length >= ROWS_MAX,
    ...sitemaps,
  }
}

interface InspectionAnswer {
  inspectionResult?: {
    inspectionResultLink?: string
    indexStatusResult?: {
      verdict?: string
      coverageState?: string
      indexingState?: string
      pageFetchState?: string
      lastCrawlTime?: string
      googleCanonical?: string
    }
  }
}

/** Whether Google indexed one page of the site, and why not when it did not. */
export async function inspectUrl(opts: { site: string; url: string; token: string; fetch: FetchLike; now: Date }): Promise<IndexStatus> {
  const answer = await googleJson<InspectionAnswer>(opts.fetch, `${SEARCH_CONSOLE_API}/v1/urlInspection/index:inspect`, opts.token, {
    inspectionUrl: opts.url,
    siteUrl: opts.site,
    languageCode: "en-US",
  })
  const result = answer.inspectionResult ?? {}
  const index = result.indexStatusResult ?? {}
  const optional = (field: string, value: string | undefined) => (value ? { [field]: value } : {})
  return {
    url: opts.url,
    verdict: index.verdict ?? "VERDICT_UNSPECIFIED",
    ...optional("coverageState", index.coverageState),
    ...optional("indexingState", index.indexingState),
    ...optional("pageFetchState", index.pageFetchState),
    ...optional("lastCrawlTime", index.lastCrawlTime),
    ...optional("googleCanonical", index.googleCanonical),
    ...optional("inspectionLink", result.inspectionResultLink),
    checkedAt: opts.now.toISOString(),
  }
}
