import { columns, GA_DATA_API, type GaAnswer, type QuotaBucket } from "./ga4-columns.js"
import { googleJson, type FetchLike } from "./google-api.js"

/**
 * Google's realtime tokens left, per bucket; null where Google did not say.
 * Every realtime question costs some 35–45 of them.
 */
export interface RealtimeQuota {
  /** This Google Cloud project, for this property, this hour (about 14,000) — shared with every tool on the project. */
  readonly projectPerHour: number | null
  /** The property, this hour (about 40,000) — shared with every tool that reads it. */
  readonly propertyPerHour: number | null
  /** The property, today (about 200,000). */
  readonly propertyPerDay: number | null
}

/**
 * The last 30 minutes, as GA's Realtime report shows them: three questions —
 * the headline, each minute, the pages — and nothing that only adds detail.
 */
export interface RealtimeSnapshot {
  readonly activeUsers: number
  readonly views: number
  readonly events: number
  /** Active users per minute: index 0 is this minute, 29 is half an hour ago. */
  readonly perMinute: readonly number[]
  /** The pages people are on, by title — realtime has no page path. */
  readonly pages: ReadonlyArray<{ readonly title: string; readonly activeUsers: number; readonly views: number }>
  readonly quota: RealtimeQuota
}

export const REALTIME_MINUTES = 30
const PAGES_MAX = 10

/**
 * The headline is its own question with no dimension: active users across
 * the pages or minutes would count a person once per page or minute.
 */
export function realtimeRequests(): unknown[] {
  return [
    { metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }, { name: "eventCount" }], returnPropertyQuota: true },
    { dimensions: [{ name: "minutesAgo" }], metrics: [{ name: "activeUsers" }], limit: REALTIME_MINUTES },
    {
      dimensions: [{ name: "unifiedScreenName" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: PAGES_MAX,
    },
  ]
}

/** A bucket Google sent reads its remaining tokens (none, when the field is left out); a bucket it did not send is unknown. */
const remainingIn = (bucket: QuotaBucket | undefined): number | null => (bucket ? Number(bucket.remaining ?? 0) || 0 : null)

export async function readRealtime(opts: { propertyId: string; token: string; fetch: FetchLike }): Promise<RealtimeSnapshot> {
  const url = `${GA_DATA_API}/properties/${opts.propertyId}:runRealtimeReport`
  const [headlineAsk, ...restAsks] = realtimeRequests()
  // The headline alone first: when Google fails, one question fails rather than three. Its
  // allowance of server errors is small and shared with every tool on the project.
  const headlineAnswer = await googleJson<GaAnswer>(opts.fetch, url, opts.token, headlineAsk)
  const [minutesAnswer, pagesAnswer] = await Promise.all(restAsks.map((body) => googleJson<GaAnswer>(opts.fetch, url, opts.token, body)))
  const headline = columns(headlineAnswer)
  const minutes = columns(minutesAnswer)
  const pages = columns(pagesAnswer)
  const usersAt = new Map(minutes.rows.map((row) => [Number(minutes.dimension(row, "minutesAgo")), minutes.metric(row, "activeUsers")]))
  const quota = headlineAnswer.propertyQuota
  return {
    activeUsers: headline.metric(headline.rows[0], "activeUsers"),
    views: headline.metric(headline.rows[0], "screenPageViews"),
    events: headline.metric(headline.rows[0], "eventCount"),
    perMinute: Array.from({ length: REALTIME_MINUTES }, (_, minute) => usersAt.get(minute) ?? 0),
    pages: pages.rows.map((row) => ({
      title: pages.dimension(row, "unifiedScreenName"),
      activeUsers: pages.metric(row, "activeUsers"),
      views: pages.metric(row, "screenPageViews"),
    })),
    quota: {
      projectPerHour: remainingIn(quota?.tokensPerProjectPerHour),
      propertyPerHour: remainingIn(quota?.tokensPerHour),
      propertyPerDay: remainingIn(quota?.tokensPerDay),
    },
  }
}
