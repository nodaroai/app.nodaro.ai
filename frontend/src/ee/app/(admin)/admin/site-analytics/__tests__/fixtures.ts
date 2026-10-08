import type { RealtimeSnapshot, SearchReport, SectionResult, SiteAnalyticsReport, SourceRow, SourcesReport, TrafficReport } from "../types"

export const EMAIL = "reader@nodaro-analytics.iam.gserviceaccount.com"
export const SETUP = { serviceAccountEmail: EMAIL, ga4PropertyId: "537345785", searchConsoleSite: "sc-domain:nodaro.ai", problems: [] }
export const AT = "2026-10-08T12:00:00.000Z"

export const NOT_SET_UP: SiteAnalyticsReport = {
  days: 28,
  setup: {
    serviceAccountEmail: null,
    ga4PropertyId: null,
    searchConsoleSite: null,
    problems: ["SITE_ANALYTICS_SERVICE_ACCOUNT_JSON is not set.", "SITE_ANALYTICS_GA4_PROPERTY_ID is not set.", "SITE_ANALYTICS_SEARCH_CONSOLE_SITE is not set."],
  },
  traffic: { status: "not_configured" },
  search: { status: "not_configured" },
  sources: { status: "not_configured" },
}

export const searchData = (clicks: number, pages = [{ key: "https://nodaro.ai/docs", clicks: 300, impressions: 5000, ctr: 0.06, position: 4.2 }]): SearchReport => ({
  window: { startDate: "2026-09-10", endDate: "2026-10-07" },
  totals: { clicks, impressions: 98765, ctr: 0.0437, position: 12.3 },
  daily: [
    { date: "2026-10-06", clicks: 100, impressions: 2000 },
    { date: "2026-10-07", clicks: 120, impressions: 2100 },
  ],
  pages,
  pagesCapped: false,
  queries: [{ key: "nodaro", clicks: 250, impressions: 400, ctr: 0.625, position: 1.1 }],
  queriesCapped: false,
  sitemaps: [],
})

export const trafficData: TrafficReport = {
  totals: { views: 1200, activeUsers: 300, engagementSeconds: 54000, events: 5000 },
  daily: [],
  pages: [
    { key: "nodaro.ai/docs", host: "nodaro.ai", path: "/docs", views: 500, activeUsers: 90, engagementSeconds: 900, events: 700 },
    { key: "nodaro.ai.attacker.tld/win", host: "nodaro.ai.attacker.tld", path: "/win", views: 3, activeUsers: 1, engagementSeconds: 0, events: 3 },
  ],
  pagesTotal: 575,
  titles: [],
  titlesTotal: 0,
}

const source = (labels: string[], sessions: number, keyEvents = 0): SourceRow => ({
  labels,
  sessions,
  activeUsers: Math.round(sessions * 0.8),
  newUsers: Math.round(sessions * 0.7),
  engagementRate: 0.5,
  keyEvents,
})

/**
 * As GA answers (the UTM rows are shaped like real ones): an untagged search
 * still has a manual source and medium, with the channel as its campaign; a
 * tagged link without a campaign has "(not set)" there.
 */
export const sourcesData: SourcesReport = {
  channels: { rows: [source(["Direct"], 523), source(["Organic Search"], 131, 2)], total: 2 },
  sourceMedium: { rows: [source(["(direct)", "(none)"], 495), source(["google", "organic"], 120, 2)], total: 2 },
  campaigns: { rows: [source(["(direct)"], 495), source(["launch-oct"], 40, 1)], total: 2 },
  utm: {
    rows: [
      source(["(not set)", "(not set)", "(not set)", "(not set)", "(not set)"], 501),
      source(["google", "organic", "(organic)", "(not set)", "(not provided)"], 122, 2),
      source(["extension", "card-character-open", "(not set)", "(not set)", "(not set)"], 41),
      source(["newsletter", "email", "launch-oct", "hero-video", "ai video"], 40, 1),
    ],
    total: 4,
  },
  landingPages: { rows: [source(["/pricing"], 300), source(["/"], 2)], total: 9 },
}

export const report = (over: Partial<SiteAnalyticsReport> = {}): SiteAnalyticsReport => ({
  days: 28,
  setup: SETUP,
  traffic: { status: "ok", fetchedAt: AT, data: trafficData },
  search: { status: "ok", fetchedAt: AT, data: searchData(4321) },
  sources: { status: "ok", fetchedAt: AT, data: sourcesData },
  ...over,
})

export const realtimeData = (over: Partial<RealtimeSnapshot> = {}): RealtimeSnapshot => ({
  activeUsers: 7,
  views: 12,
  events: 30,
  perMinute: Array.from({ length: 30 }, (_, i) => (i < 3 ? 2 : 0)),
  pages: [{ title: "Pricing", activeUsers: 3, views: 4 }],
  quota: { projectPerHour: 13_000, propertyPerHour: 39_000, propertyPerDay: 190_000 },
  refreshMinutes: 1,
  ...over,
})

export const REALTIME_OK: SectionResult<RealtimeSnapshot> = { status: "ok", fetchedAt: AT, data: realtimeData() }

export const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
