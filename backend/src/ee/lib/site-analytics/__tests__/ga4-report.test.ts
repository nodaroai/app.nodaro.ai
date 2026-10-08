import { describe, expect, it, vi } from "vitest"
import { readGaReport } from "../ga4-report.js"
import { GoogleApiError } from "../google-api.js"

const row = (dimensions: string[], metrics: number[]) => ({
  dimensionValues: dimensions.map((value) => ({ value })),
  metricValues: metrics.map((value) => ({ value: String(value) })),
})
const headers = (dimensions: string[], metrics: string[]) => ({
  dimensionHeaders: dimensions.map((name) => ({ name })),
  metricHeaders: metrics.map((name) => ({ name, type: "TYPE_INTEGER" })),
})
const FOUR = ["screenPageViews", "activeUsers", "userEngagementDuration", "eventCount"]

const BATCH = {
  reports: [
    { ...headers([], FOUR), rows: [row([], [1200, 300, 54000, 5000])], rowCount: 1 },
    { ...headers(["date"], ["screenPageViews", "activeUsers"]), rows: [row(["20261004"], [40, 10]), row(["20261001"], [30, 9])], rowCount: 2 },
    {
      ...headers(["hostName", "pagePath"], FOUR),
      rows: [row(["app.nodaro.ai", "/projects"], [704, 97, 20784, 1202]), row(["nodaro.ai", "/"], [432, 249, 29283, 1280])],
      rowCount: 575,
    },
    { ...headers(["unifiedScreenClass"], FOUR), rows: [row(["Nodaro.ai"], [1500, 200, 40000, 4000])], rowCount: 31 },
  ],
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const NOW = new Date("2026-10-08T12:00:00Z")

describe("readGaReport", () => {
  it("sends exactly these four reports in one call, each over the N days ending yesterday", async () => {
    const fetch = vi.fn(async () => ok(BATCH))
    await readGaReport({ propertyId: "537345785", days: 28, token: "tok", fetch, now: NOW })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/537345785:batchRunReports")
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok")
    const dateRanges = [{ startDate: "28daysAgo", endDate: "yesterday" }]
    const metrics = FOUR.map((name) => ({ name }))
    const byViews = [{ metric: { metricName: "screenPageViews" }, desc: true }]
    expect(JSON.parse(String(init.body))).toEqual({
      requests: [
        { dateRanges, metrics },
        {
          dateRanges,
          dimensions: [{ name: "date" }],
          metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
          orderBys: [{ dimension: { dimensionName: "date" } }],
          keepEmptyRows: true,
          limit: 100,
        },
        { dateRanges, dimensions: [{ name: "hostName" }, { name: "pagePath" }], metrics, orderBys: byViews, limit: 250 },
        { dateRanges, dimensions: [{ name: "unifiedScreenClass" }], metrics, orderBys: byViews, limit: 100 },
      ],
    })
  })

  it("reads the numbers, keeps each page's site and how many pages GA has in all", async () => {
    const report = await readGaReport({ propertyId: "537345785", days: 7, token: "tok", fetch: async () => ok(BATCH), now: NOW })
    expect(report.totals).toEqual({ views: 1200, activeUsers: 300, engagementSeconds: 54000, events: 5000 })
    expect(report.pages[0]).toEqual({ key: "app.nodaro.ai/projects", host: "app.nodaro.ai", path: "/projects", views: 704, activeUsers: 97, engagementSeconds: 20784, events: 1202 })
    expect(report.pages[1]?.key).toBe("nodaro.ai/")
    expect(report.pagesTotal).toBe(575)
    expect(report.titles).toEqual([{ key: "Nodaro.ai", views: 1500, activeUsers: 200, engagementSeconds: 40000, events: 4000 }])
    expect(report.titlesTotal).toBe(31)
  })

  it("reads each column by the name in GA's headers, whatever order they come back in", async () => {
    const shuffled = {
      reports: [
        { ...headers([], ["eventCount", "activeUsers", "screenPageViews", "userEngagementDuration"]), rows: [row([], [5000, 300, 1200, 54000])] },
        {},
        { ...headers(["pagePath", "hostName"], ["activeUsers", "screenPageViews", "eventCount", "userEngagementDuration"]), rows: [row(["/docs", "nodaro.ai"], [9, 70, 120, 600])] },
        {},
      ],
    }
    const report = await readGaReport({ propertyId: "1", days: 7, token: "tok", fetch: async () => ok(shuffled), now: NOW })
    expect(report.totals).toEqual({ views: 1200, activeUsers: 300, engagementSeconds: 54000, events: 5000 })
    expect(report.pages[0]).toEqual({ key: "nodaro.ai/docs", host: "nodaro.ai", path: "/docs", views: 70, activeUsers: 9, engagementSeconds: 600, events: 120 })
  })

  it("fills every day of the range on the property's clock, quiet days at either end included", async () => {
    const daily = (now: Date) =>
      readGaReport({
        propertyId: "1",
        days: 7,
        token: "tok",
        now,
        fetch: async () =>
          ok({
            reports: [
              {},
              { ...headers(["date"], ["screenPageViews", "activeUsers"]), rows: [row(["20261004"], [40, 10])], metadata: { timeZone: "Asia/Jerusalem" } },
              {},
              {},
            ],
          }),
      }).then((report) => report.daily)
    const week = await daily(NOW)
    expect(week.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"])
    expect(week[3]).toEqual({ date: "2026-10-04", views: 40, activeUsers: 10 })
    expect(week[0]).toEqual({ date: "2026-10-01", views: 0, activeUsers: 0 })
    // 22:30Z on Oct 7 is already Oct 8 in Jerusalem: the same week, not the one a UTC clock would give.
    expect((await daily(new Date("2026-10-07T22:30:00Z")))[6]?.date).toBe("2026-10-07")
  })

  it("without the property's zone, puts the days in order and fills the gaps between them", async () => {
    const report = await readGaReport({ propertyId: "1", days: 7, token: "tok", fetch: async () => ok(BATCH), now: NOW })
    expect(report.daily).toEqual([
      { date: "2026-10-01", views: 30, activeUsers: 9 },
      { date: "2026-10-02", views: 0, activeUsers: 0 },
      { date: "2026-10-03", views: 0, activeUsers: 0 },
      { date: "2026-10-04", views: 40, activeUsers: 10 },
    ])
  })

  it("a property with no data in the range reads as zeros", async () => {
    const report = await readGaReport({ propertyId: "1", days: 7, token: "tok", fetch: async () => ok({ reports: [{}, {}, {}, {}] }), now: NOW })
    expect(report.totals).toEqual({ views: 0, activeUsers: 0, engagementSeconds: 0, events: 0 })
    expect(report.daily).toEqual([])
    expect(report.pages).toEqual([])
    expect(report.pagesTotal).toBe(0)
  })

  it("Google's refusal comes back with its status, message and reason", async () => {
    const refused = new Response(
      JSON.stringify({
        error: {
          code: 403,
          message: "Google Analytics Data API has not been used in project 123 before or it is disabled.",
          status: "PERMISSION_DENIED",
          details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }],
        },
      }),
      { status: 403 },
    )
    const error = await readGaReport({ propertyId: "1", days: 7, token: "tok", fetch: async () => refused, now: NOW }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GoogleApiError)
    expect(error).toMatchObject({ status: 403, reason: "SERVICE_DISABLED", message: expect.stringMatching(/has not been used/) })
  })
})
