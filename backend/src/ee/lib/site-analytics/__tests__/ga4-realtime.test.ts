import { describe, expect, it, vi } from "vitest"
import { readRealtime } from "../ga4-realtime.js"
import { GoogleApiError } from "../google-api.js"

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const row = (dimensions: string[], metrics: number[]) => ({
  dimensionValues: dimensions.map((value) => ({ value })),
  metricValues: metrics.map((value) => ({ value: String(value) })),
})
const headers = (dimensions: string[], metrics: string[]) => ({
  dimensionHeaders: dimensions.map((name) => ({ name })),
  metricHeaders: metrics.map((name) => ({ name, type: "TYPE_INTEGER" })),
})

/** Google's three realtime answers, told apart by the dimension each asks for. */
function googleRealtime(opts: { quota?: Record<string, unknown> } = {}) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { dimensions?: Array<{ name: string }> }
    const dimension = body.dimensions?.[0]?.name
    if (!dimension) {
      return ok({
        ...headers([], ["screenPageViews", "eventCount", "activeUsers"]),
        rows: [row([], [9, 11, 6])],
        ...(opts.quota === undefined ? {} : { propertyQuota: opts.quota }),
      })
    }
    if (dimension === "minutesAgo") return ok({ ...headers(["minutesAgo"], ["activeUsers"]), rows: [row(["02"], [2]), row(["00"], [3]), row(["29"], [1])] })
    return ok({ ...headers(["unifiedScreenName"], ["activeUsers", "screenPageViews"]), rows: [row(["Nodaro.ai"], [4, 6]), row(["Pricing"], [1, 2])] })
  })
}

describe("readRealtime", () => {
  it("asks exactly three questions about the last 30 minutes", async () => {
    const fetch = googleRealtime()
    await readRealtime({ propertyId: "537345785", token: "tok", fetch })
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/537345785:runRealtimeReport")
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok")
    }
    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as unknown)
    expect(bodies).toEqual(
      expect.arrayContaining([
        { metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }, { name: "eventCount" }], returnPropertyQuota: true },
        { dimensions: [{ name: "minutesAgo" }], metrics: [{ name: "activeUsers" }], limit: 30 },
        {
          dimensions: [{ name: "unifiedScreenName" }],
          metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
          orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
          limit: 10,
        },
      ]),
    )
  })

  it("reads the headline from its own question, each minute in place, and the pages people are on", async () => {
    const quota = { tokensPerProjectPerHour: { consumed: 36, remaining: 13_780 }, tokensPerHour: { consumed: 36, remaining: 39_000 }, tokensPerDay: { consumed: 36 } }
    const snapshot = await readRealtime({ propertyId: "1", token: "tok", fetch: googleRealtime({ quota }) })
    // The headline is its own answer: 6 users and 9 views, not the pages' 4 + 1 and 6 + 2.
    expect(snapshot.activeUsers).toBe(6)
    expect(snapshot.views).toBe(9)
    expect(snapshot.events).toBe(11)
    expect(snapshot.perMinute).toHaveLength(30)
    expect(snapshot.perMinute[0]).toBe(3)
    expect(snapshot.perMinute[2]).toBe(2)
    expect(snapshot.perMinute[29]).toBe(1)
    expect(snapshot.perMinute[1]).toBe(0)
    expect(snapshot.pages).toEqual([
      { title: "Nodaro.ai", activeUsers: 4, views: 6 },
      { title: "Pricing", activeUsers: 1, views: 2 },
    ])
    // A bucket Google sent without "remaining" has none left; one it did not send is unknown.
    expect(snapshot.quota).toEqual({ projectPerHour: 13_780, propertyPerHour: 39_000, propertyPerDay: 0 })
  })

  it("nobody on the site reads as zeros; no quota from Google reads as unknown", async () => {
    const snapshot = await readRealtime({ propertyId: "1", token: "tok", fetch: async () => ok({}) })
    expect(snapshot).toEqual({ activeUsers: 0, views: 0, events: 0, perMinute: Array.from({ length: 30 }, () => 0), pages: [], quota: { projectPerHour: null, propertyPerHour: null, propertyPerDay: null } })
  })

  it("Google's refusal comes back with its status and message — after one question, not three", async () => {
    const refused = () => new Response(JSON.stringify({ error: { code: 429, message: "Exhausted property tokens per project per hour.", status: "RESOURCE_EXHAUSTED" } }), { status: 429 })
    const fetch = vi.fn(async () => refused())
    const error = await readRealtime({ propertyId: "1", token: "tok", fetch }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GoogleApiError)
    expect(error).toMatchObject({ status: 429, reason: "RESOURCE_EXHAUSTED" })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
