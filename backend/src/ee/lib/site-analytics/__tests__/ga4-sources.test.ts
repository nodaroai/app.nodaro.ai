import { describe, expect, it, vi } from "vitest"
import { readSourcesReport } from "../ga4-sources.js"

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const row = (dimensions: string[], metrics: number[]) => ({
  dimensionValues: dimensions.map((value) => ({ value })),
  metricValues: metrics.map((value) => ({ value: String(value) })),
})
const FIVE = ["sessions", "activeUsers", "newUsers", "engagementRate", "keyEvents"]
const table = (dimensions: string[], rows: Array<[string[], number[]]>, rowCount = rows.length) => ({
  dimensionHeaders: dimensions.map((name) => ({ name })),
  metricHeaders: FIVE.map((name) => ({ name, type: "TYPE_INTEGER" })),
  rows: rows.map(([d, m]) => row(d, m)),
  rowCount,
})

const BATCH = {
  reports: [
    table(["sessionDefaultChannelGroup"], [[["Direct"], [523, 442, 441, 0.3365, 0]], [["Organic Search"], [131, 61, 60, 0.6412, 2]]], 8),
    table(["sessionSource", "sessionMedium"], [[["google", "organic"], [120, 55, 54, 0.66, 2]]]),
    table(["sessionCampaignName"], [[["launch-oct"], [40, 30, 28, 0.5, 1]]]),
    table(["sessionManualSource", "sessionManualMedium", "sessionManualCampaignName", "sessionManualAdContent", "sessionManualTerm"], [[["newsletter", "email", "launch-oct", "hero-video", "ai video"], [40, 30, 28, 0.5, 1]]]),
    table(["landingPage"], [[["/pricing"], [300, 250, 240, 0.4, 0]]]),
  ],
}

describe("readSourcesReport", () => {
  it("sends exactly these five tables in one call, each over the N days ending yesterday", async () => {
    const fetch = vi.fn(async () => ok(BATCH))
    await readSourcesReport({ propertyId: "537345785", days: 28, token: "tok", fetch })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/537345785:batchRunReports")
    const dateRanges = [{ startDate: "28daysAgo", endDate: "yesterday" }]
    const metrics = FIVE.map((name) => ({ name }))
    const bySessions = [{ metric: { metricName: "sessions" }, desc: true }]
    const ask = (dimensions: string[], limit: number) => ({ dateRanges, dimensions: dimensions.map((name) => ({ name })), metrics, orderBys: bySessions, limit })
    // GA names the channel as the campaign of a visit that came without tags ("(organic)", "(referral)");
    // a tagged link without a campaign gets "(not set)" and stays.
    const campaignIs = (matchType: string, value: string) => ({ filter: { fieldName: "sessionManualCampaignName", stringFilter: { matchType, value } } })
    const taggedOnly = { notExpression: { andGroup: { expressions: [campaignIs("FULL_REGEXP", "\\(.+\\)"), { notExpression: campaignIs("EXACT", "(not set)") }] } } }
    expect(JSON.parse(String(init.body))).toEqual({
      requests: [
        ask(["sessionDefaultChannelGroup"], 50),
        ask(["sessionSource", "sessionMedium"], 100),
        ask(["sessionCampaignName"], 100),
        {
          ...ask(["sessionManualSource", "sessionManualMedium", "sessionManualCampaignName", "sessionManualAdContent", "sessionManualTerm"], 100),
          dimensionFilter: taggedOnly,
        },
        ask(["landingPage"], 100),
      ],
    })
  })

  it("reads each table's rows by name with their labels, and how many rows GA has", async () => {
    const report = await readSourcesReport({ propertyId: "1", days: 7, token: "tok", fetch: async () => ok(BATCH) })
    expect(report.channels.rows[0]).toEqual({
      labels: ["Direct"],
      sessions: 523,
      activeUsers: 442,
      newUsers: 441,
      engagementRate: 0.3365,
      keyEvents: 0,
    })
    expect(report.channels.total).toBe(8)
    expect(report.sourceMedium.rows[0]?.labels).toEqual(["google", "organic"])
    expect(report.campaigns.rows[0]?.labels).toEqual(["launch-oct"])
    expect(report.utm.rows[0]?.labels).toEqual(["newsletter", "email", "launch-oct", "hero-video", "ai video"])
    expect(report.landingPages.rows[0]?.labels).toEqual(["/pricing"])
  })

  it("no visits in the range reads as empty tables", async () => {
    const report = await readSourcesReport({ propertyId: "1", days: 7, token: "tok", fetch: async () => ok({ reports: [{}, {}, {}, {}, {}] }) })
    expect(report.channels).toEqual({ rows: [], total: 0 })
    expect(report.landingPages).toEqual({ rows: [], total: 0 })
  })
})
