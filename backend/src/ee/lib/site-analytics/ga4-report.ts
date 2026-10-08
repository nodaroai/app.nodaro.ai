import { everyDay, shiftDay } from "./days.js"
import { columns, GA_DATA_API, type Columns, type GaAnswer, type GaRow } from "./ga4-columns.js"
import { googleJson, type FetchLike } from "./google-api.js"

/** The ranges the page offers — GA's own presets, so a number here matches the one in GA. */
export const SITE_ANALYTICS_DAYS = [7, 28, 90] as const
export type SiteAnalyticsDays = (typeof SITE_ANALYTICS_DAYS)[number]

export interface TrafficTotals {
  readonly views: number
  readonly activeUsers: number
  readonly engagementSeconds: number
  readonly events: number
}

export interface TrafficDay {
  /** YYYY-MM-DD, in the property's time zone. */
  readonly date: string
  readonly views: number
  readonly activeUsers: number
}

/** One page (its site and path) or one page title — GA's "Page title and screen class". */
export interface TrafficRow extends TrafficTotals {
  readonly key: string
  readonly host?: string
  readonly path?: string
}

export interface TrafficReport {
  readonly totals: TrafficTotals
  readonly daily: readonly TrafficDay[]
  /** The busiest pages, at most PAGES_MAX; `pagesTotal` is how many GA has. */
  readonly pages: readonly TrafficRow[]
  readonly pagesTotal: number
  readonly titles: readonly TrafficRow[]
  readonly titlesTotal: number
}

const METRICS = ["screenPageViews", "activeUsers", "userEngagementDuration", "eventCount"] as const
export const PAGES_MAX = 250
export const TITLES_MAX = 100

interface GaBatch {
  reports?: GaAnswer[]
}

const byViews = [{ metric: { metricName: "screenPageViews" }, desc: true }]

/** Totals, each day, each page (site + path) and each title — one batch call, all over the N days ending yesterday. */
export function trafficRequests(days: SiteAnalyticsDays): unknown[] {
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "yesterday" }]
  const metrics = METRICS.map((name) => ({ name }))
  return [
    { dateRanges, metrics },
    {
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      keepEmptyRows: true,
      limit: 100,
    },
    { dateRanges, dimensions: [{ name: "hostName" }, { name: "pagePath" }], metrics, orderBys: byViews, limit: PAGES_MAX },
    { dateRanges, dimensions: [{ name: "unifiedScreenClass" }], metrics, orderBys: byViews, limit: TITLES_MAX },
  ]
}

const trafficTotals = (report: Columns, row: GaRow | undefined): TrafficTotals => ({
  views: report.metric(row, "screenPageViews"),
  activeUsers: report.metric(row, "activeUsers"),
  engagementSeconds: report.metric(row, "userEngagementDuration"),
  events: report.metric(row, "eventCount"),
})

/** GA writes a day as YYYYMMDD. */
const isoDay = (day: string) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`

/** Today in the property's time zone — the clock GA's "NdaysAgo" and "yesterday" run on. Null for a zone this runtime does not know. */
function todayIn(timeZone: string | undefined, now: Date): string | null {
  if (!timeZone) return null
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
  } catch {
    return null
  }
}

/** Every day of the range, a quiet one at zero — including quiet days at either end, which GA leaves out. */
function dailyOf(answer: GaAnswer | undefined, days: SiteAnalyticsDays, now: Date): TrafficDay[] {
  const daily = columns(answer)
  const rows = daily.rows
    .map((row) => ({ date: isoDay(daily.dimension(row, "date")), views: daily.metric(row, "screenPageViews"), activeUsers: daily.metric(row, "activeUsers") }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const zero = (date: string) => ({ date, views: 0, activeUsers: 0 })
  const today = todayIn(answer?.metadata?.timeZone, now)
  if (today) return everyDay(rows, shiftDay(today, -days), shiftDay(today, -1), zero)
  // No zone to read the range in: fill between the first and last day GA sent.
  const first = rows[0]?.date
  const last = rows[rows.length - 1]?.date
  return first && last ? everyDay(rows, first, last, zero) : []
}

export function trafficReportOf(batch: GaBatch, days: SiteAnalyticsDays, now: Date): TrafficReport {
  const totals = columns(batch.reports?.[0])
  const pages = columns(batch.reports?.[2])
  const titles = columns(batch.reports?.[3])
  return {
    totals: trafficTotals(totals, totals.rows[0]),
    daily: dailyOf(batch.reports?.[1], days, now),
    pages: pages.rows.map((row) => {
      const host = pages.dimension(row, "hostName")
      const path = pages.dimension(row, "pagePath")
      return { key: `${host}${path}`, host, path, ...trafficTotals(pages, row) }
    }),
    pagesTotal: pages.rowCount,
    titles: titles.rows.map((row) => ({ key: titles.dimension(row, "unifiedScreenClass"), ...trafficTotals(titles, row) })),
    titlesTotal: titles.rowCount,
  }
}

export async function readGaReport(opts: { propertyId: string; days: SiteAnalyticsDays; token: string; fetch: FetchLike; now: Date }): Promise<TrafficReport> {
  const batch = await googleJson<GaBatch>(opts.fetch, `${GA_DATA_API}/properties/${opts.propertyId}:batchRunReports`, opts.token, {
    requests: trafficRequests(opts.days),
  })
  return trafficReportOf(batch, opts.days, opts.now)
}
