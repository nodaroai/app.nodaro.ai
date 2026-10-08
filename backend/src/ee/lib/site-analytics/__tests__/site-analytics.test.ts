import { beforeAll, describe, expect, it, vi } from "vitest"
import { exportPKCS8, generateKeyPair } from "jose"
import { createSiteAnalytics, type SiteAnalyticsEnv } from "../site-analytics.js"
import type { InspectionBudget } from "../inspection-budget.js"

const NOW = Date.parse("2026-10-08T12:00:00Z")
const MINUTE = 60_000
const EMAIL = "reader@nodaro-analytics.iam.gserviceaccount.com"
let env: SiteAnalyticsEnv

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true })
  const keyFile = JSON.stringify({ client_email: EMAIL, private_key: await exportPKCS8(pair.privateKey) })
  env = { serviceAccountJson: keyFile, ga4PropertyId: "537345785", searchConsoleSite: "sc-domain:nodaro.ai" }
})

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const refused = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ error: { code: status, message, ...extra } }), { status })

/** Google, as the service sees it: the token endpoint, the GA Data API (traffic, sources, realtime) and Search Console. */
function google(overrides: { ga?: () => Response; sources?: () => Response; realtime?: () => Response; search?: () => Response } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://oauth2.googleapis.com/")) return ok({ access_token: "tok", expires_in: 3600 })
    if (url.endsWith(":runRealtimeReport")) return overrides.realtime ? overrides.realtime() : ok({})
    const isSources = url.endsWith(":batchRunReports") && (JSON.parse(String(init?.body)) as { requests: unknown[] }).requests.length === 5
    if (isSources) return overrides.sources ? overrides.sources() : ok({ reports: [{}, {}, {}, {}, {}] })
    if (url.startsWith("https://analyticsdata.googleapis.com/")) return overrides.ga ? overrides.ga() : ok({ reports: [{}, {}, {}, {}] })
    if (url.includes("urlInspection")) return ok({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" } } })
    return overrides.search ? overrides.search() : ok({})
  })
}

/** A budget that counts what it is asked for; never Redis in a unit test. */
function budgetOf(limit: number): InspectionBudget & { taken: string[] } {
  const taken: string[] = []
  return {
    taken,
    async take(day) {
      taken.push(day)
      return taken.length <= limit
    },
  }
}

const calls = (fetch: ReturnType<typeof google>, prefix: string) => fetch.mock.calls.filter(([url]) => String(url).startsWith(prefix)).length
/** The traffic batch (four reports) — the sources batch (five) and realtime are counted apart. */
const trafficCalls = (fetch: ReturnType<typeof google>) =>
  fetch.mock.calls.filter(([url, init]) => String(url).endsWith(":batchRunReports") && (JSON.parse(String(init?.body)) as { requests: unknown[] }).requests.length === 4).length
const INSPECT = "https://searchconsole.googleapis.com/v1/urlInspection"

describe("the setup an admin sees", () => {
  it("nothing configured: both sections say so, Google is never called, and every missing variable is named", async () => {
    const fetch = google()
    const service = createSiteAnalytics({ serviceAccountJson: "", ga4PropertyId: "", searchConsoleSite: "" }, { fetch, now: () => NOW, budget: budgetOf(10) })
    const report = await service.report(28, { fresh: false })
    expect(report.traffic).toEqual({ status: "not_configured" })
    expect(report.search).toEqual({ status: "not_configured" })
    expect(report.setup.problems).toHaveLength(3)
    expect(report.setup.serviceAccountEmail).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("configured: names the account to grant, never its key", async () => {
    const report = await createSiteAnalytics(env, { fetch: google(), now: () => NOW, budget: budgetOf(10) }).report(28, { fresh: false })
    expect(report.setup).toEqual({ serviceAccountEmail: EMAIL, ga4PropertyId: "537345785", searchConsoleSite: "sc-domain:nodaro.ai", problems: [] })
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE KEY/)
  })

  it("a key that will not load says so in both sections, with no bytes of it", async () => {
    const broken = JSON.stringify({ client_email: EMAIL, private_key: "-----BEGIN PRIVATE KEY-----\nAAAAsecretBYTES\n-----END PRIVATE KEY-----\n" })
    const report = await createSiteAnalytics({ ...env, serviceAccountJson: broken }, { fetch: google(), now: () => NOW, budget: budgetOf(10) }).report(7, { fresh: false })
    expect(report.traffic).toMatchObject({ status: "error", reason: "KEY_FILE", message: expect.stringMatching(/private key could not be read/) })
    expect(report.search).toMatchObject({ status: "error", reason: "KEY_FILE" })
    expect(JSON.stringify(report)).not.toMatch(/secretBYTES/)
  })
})

describe("report", () => {
  it("Analytics refusing still returns Search Console, and says why Analytics is missing", async () => {
    const fetch = google({ ga: () => refused(403, "User does not have sufficient permissions for this property.", { status: "PERMISSION_DENIED" }) })
    const report = await createSiteAnalytics(env, { fetch, now: () => NOW, budget: budgetOf(10) }).report(7, { fresh: false })
    expect(report.traffic).toEqual({ status: "error", httpStatus: 403, reason: "PERMISSION_DENIED", message: "User does not have sufficient permissions for this property." })
    expect(report.search.status).toBe("ok")
  })

  it("Search Console refusing still returns Analytics", async () => {
    const fetch = google({ search: () => refused(403, "User does not have sufficient permission for site 'sc-domain:nodaro.ai'.") })
    const report = await createSiteAnalytics(env, { fetch, now: () => NOW, budget: budgetOf(10) }).report(7, { fresh: false })
    expect(report.traffic.status).toBe("ok")
    expect(report.search).toMatchObject({ status: "error", httpStatus: 403 })
  })

  it("keeps a range's report ten minutes; another range asks Google again", async () => {
    let now = NOW
    const fetch = google()
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget: budgetOf(10) })
    await service.report(28, { fresh: false })
    now = NOW + 9 * MINUTE
    await service.report(28, { fresh: false })
    expect(trafficCalls(fetch)).toBe(1)
    await service.report(7, { fresh: false })
    expect(trafficCalls(fetch)).toBe(2)
    // The 7-day report was read at minute 9: at minute 20 it is past its ten minutes.
    now = NOW + 20 * MINUTE
    await service.report(7, { fresh: false })
    expect(trafficCalls(fetch)).toBe(3)
  })

  it("Refresh asks Google again, but not within a minute of the last answer", async () => {
    let now = NOW
    const fetch = google()
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget: budgetOf(10) })
    await service.report(28, { fresh: false })
    now = NOW + 30_000
    await service.report(28, { fresh: true })
    expect(trafficCalls(fetch)).toBe(1)
    now = NOW + 61_000
    await service.report(28, { fresh: true })
    expect(trafficCalls(fetch)).toBe(2)
  })

  it("traffic sources come with the report, and their refusal leaves traffic and search standing", async () => {
    const working = await createSiteAnalytics(env, { fetch: google(), now: () => NOW, budget: budgetOf(10) }).report(28, { fresh: false })
    expect(working.sources).toMatchObject({ status: "ok", data: { channels: { rows: [], total: 0 } } })
    const fetch = google({ sources: () => refused(403, "User does not have sufficient permissions for this property.", { status: "PERMISSION_DENIED" }) })
    const report = await createSiteAnalytics(env, { fetch, now: () => NOW, budget: budgetOf(10) }).report(28, { fresh: false })
    expect(report.sources).toMatchObject({ status: "error", reason: "PERMISSION_DENIED" })
    expect(report.traffic.status).toBe("ok")
    expect(report.search.status).toBe("ok")
  })

  it("Refresh asks again for traffic, never for the sources — they end yesterday", async () => {
    let now = NOW
    const fetch = google()
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget: budgetOf(10) })
    await service.report(28, { fresh: false })
    now = NOW + 61_000
    await service.report(28, { fresh: true })
    const sourcesCalls = fetch.mock.calls.filter(([url, init]) => String(url).endsWith(":batchRunReports") && (JSON.parse(String(init?.body)) as { requests: unknown[] }).requests.length === 5)
    expect(trafficCalls(fetch)).toBe(2)
    expect(sourcesCalls).toHaveLength(1)
  })

  it("stamps each section with when Google answered", async () => {
    const report = await createSiteAnalytics(env, { fetch: google(), now: () => NOW, budget: budgetOf(10) }).report(28, { fresh: false })
    expect(report.traffic).toMatchObject({ status: "ok", fetchedAt: "2026-10-08T12:00:00.000Z" })
  })
})

describe("realtime", () => {
  const REALTIME = "https://analyticsdata.googleapis.com/v1beta/properties/537345785:runRealtimeReport"
  /** Google's realtime answer with its quota buckets; a bucket left out of `buckets` is not sent at all. */
  const withQuota = (buckets: { project?: number; propertyHour?: number; propertyDay?: number }) => () =>
    ok({
      metricHeaders: [{ name: "activeUsers" }, { name: "screenPageViews" }, { name: "eventCount" }],
      rows: [{ metricValues: [{ value: "5" }, { value: "8" }, { value: "11" }] }],
      propertyQuota: {
        ...(buckets.project === undefined ? {} : { tokensPerProjectPerHour: { remaining: buckets.project } }),
        ...(buckets.propertyHour === undefined ? {} : { tokensPerHour: { remaining: buckets.propertyHour } }),
        ...(buckets.propertyDay === undefined ? {} : { tokensPerDay: { remaining: buckets.propertyDay } }),
      },
    })
  const plenty = { project: 13_000, propertyHour: 39_000, propertyDay: 190_000 }

  it("without a GA property there is nothing to watch, and Google is not asked", async () => {
    const fetch = google()
    const service = createSiteAnalytics({ ...env, ga4PropertyId: "" }, { fetch, now: () => NOW, budget: budgetOf(10) })
    expect(await service.realtime()).toEqual({ status: "not_configured" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("one snapshot for everyone, asked of Google once a minute at most", async () => {
    let now = NOW
    const fetch = google({ realtime: withQuota(plenty) })
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget: budgetOf(10) })
    expect(await service.realtime()).toMatchObject({ status: "ok", data: { activeUsers: 5, refreshMinutes: 1 }, fetchedAt: "2026-10-08T12:00:00.000Z" })
    now = NOW + 59_000
    await Promise.all([service.realtime(), service.realtime()])
    expect(calls(fetch, REALTIME)).toBe(3)
    now = NOW + 60_000
    await service.realtime()
    expect(calls(fetch, REALTIME)).toBe(6)
  })

  it.each([
    ["the project's hour", { ...plenty, project: 2_000 }],
    ["the property's hour", { ...plenty, propertyHour: 7_000 }],
    ["the property's day", { ...plenty, propertyDay: 30_000 }],
  ])("with %s running low, once every five minutes", async (_bucket, buckets) => {
    let now = NOW
    const fetch = google({ realtime: withQuota(buckets) })
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget: budgetOf(10) })
    expect(await service.realtime()).toMatchObject({ status: "ok", data: { refreshMinutes: 5 } })
    now = NOW + 4 * MINUTE
    await service.realtime()
    expect(calls(fetch, REALTIME)).toBe(3)
    now = NOW + 5 * MINUTE
    await service.realtime()
    expect(calls(fetch, REALTIME)).toBe(6)
  })

  it("buckets Google did not report do not slow it down", async () => {
    const fetch = google({ realtime: withQuota({}) })
    expect(await createSiteAnalytics(env, { fetch, now: () => NOW, budget: budgetOf(10) }).realtime()).toMatchObject({ status: "ok", data: { refreshMinutes: 1 } })
  })

  it("a refusal is the section's, with its reason, asked once rather than three times, and remembered a minute instead of asked again on every poll", async () => {
    let now = NOW
    const fetch = google({ realtime: () => refused(403, "User does not have sufficient permissions for this property.", { status: "PERMISSION_DENIED" }) })
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget: budgetOf(10) })
    expect(await service.realtime()).toEqual({
      status: "error",
      httpStatus: 403,
      reason: "PERMISSION_DENIED",
      message: "User does not have sufficient permissions for this property.",
      retryMinutes: 1,
    })
    expect(calls(fetch, REALTIME)).toBe(1)
    now = NOW + 59_000
    expect(await service.realtime()).toMatchObject({ status: "error", retryMinutes: 1 })
    expect(calls(fetch, REALTIME)).toBe(1)
    now = NOW + 60_000
    await service.realtime()
    expect(calls(fetch, REALTIME)).toBe(2)
  })

  it.each([
    ["the allowance is spent", 429, "RESOURCE_EXHAUSTED"],
    ["it failed on its own side", 500, "INTERNAL"],
    ["it is unavailable", 503, "UNAVAILABLE"],
  ])("Google saying %s is remembered fifteen minutes, counted down on every poll", async (_why, httpStatus, status) => {
    let now = NOW
    const fetch = google({ realtime: () => refused(httpStatus, "Google could not answer.", { status }) })
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget: budgetOf(10) })
    expect(await service.realtime()).toMatchObject({ status: "error", reason: status, retryMinutes: 15 })
    expect(calls(fetch, REALTIME)).toBe(1)
    now = NOW + 6 * MINUTE
    expect(await service.realtime()).toMatchObject({ status: "error", retryMinutes: 9 })
    now = NOW + 14 * MINUTE + 59_000
    expect(await service.realtime()).toMatchObject({ status: "error", retryMinutes: 1 })
    expect(calls(fetch, REALTIME)).toBe(1)
    now = NOW + 15 * MINUTE
    await service.realtime()
    expect(calls(fetch, REALTIME)).toBe(2)
  })
})

describe("inspect", () => {
  it("a page outside the site is refused before Google — or the budget — is asked", async () => {
    const fetch = google()
    const budget = budgetOf(10)
    const result = await createSiteAnalytics(env, { fetch, now: () => NOW, budget }).inspect("https://nodaro.ai.evil.com/", { fresh: false })
    expect(result).toEqual({ status: "not_in_site" })
    expect(fetch).not.toHaveBeenCalled()
    expect(budget.taken).toEqual([])
  })

  it("keeps a page's answer for a day, and only a call to Google spends the budget (on Search Console's day)", async () => {
    let now = NOW
    const fetch = google()
    const budget = budgetOf(10)
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget })
    expect(await service.inspect("https://nodaro.ai/docs", { fresh: false })).toMatchObject({ status: "ok", data: { verdict: "PASS" } })
    now = NOW + 23 * 3_600_000
    await service.inspect("https://nodaro.ai/docs", { fresh: false })
    expect(calls(fetch, INSPECT)).toBe(1)
    expect(budget.taken).toEqual(["2026-10-08"])
    now = NOW + 25 * 3_600_000
    await service.inspect("https://nodaro.ai/docs", { fresh: false })
    expect(calls(fetch, INSPECT)).toBe(2)
    expect(budget.taken).toEqual(["2026-10-08", "2026-10-09"])
  })

  it("the same page written another way is one check, sent as the parsed address", async () => {
    const fetch = google()
    const service = createSiteAnalytics(env, { fetch, now: () => NOW, budget: budgetOf(10) })
    await service.inspect("https://nodaro.ai/docs#models", { fresh: false })
    const second = await service.inspect("HTTPS://NODARO.AI/docs", { fresh: false })
    expect(calls(fetch, INSPECT)).toBe(1)
    const sent = fetch.mock.calls.find(([url]) => String(url).startsWith(INSPECT))?.[1]
    expect(JSON.parse(String(sent?.body)).inspectionUrl).toBe("https://nodaro.ai/docs")
    expect(second).toMatchObject({ status: "ok", data: { url: "https://nodaro.ai/docs" } })
  })

  it("Check again within a minute gets the last answer: no call to Google, no budget spent", async () => {
    let now = NOW
    const fetch = google()
    const budget = budgetOf(10)
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget })
    await service.inspect("https://nodaro.ai/docs", { fresh: false })
    now = NOW + 30_000
    await service.inspect("https://nodaro.ai/docs", { fresh: true })
    expect(calls(fetch, INSPECT)).toBe(1)
    expect(budget.taken).toHaveLength(1)
    now = NOW + 61_000
    await service.inspect("https://nodaro.ai/docs", { fresh: true })
    expect(calls(fetch, INSPECT)).toBe(2)
    expect(budget.taken).toHaveLength(2)
  })

  it("a key that cannot sign in spends no check", async () => {
    const broken = JSON.stringify({ client_email: EMAIL, private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n" })
    const budget = budgetOf(10)
    const result = await createSiteAnalytics({ ...env, serviceAccountJson: broken }, { fetch: google(), now: () => NOW, budget }).inspect("https://nodaro.ai/docs", { fresh: false })
    expect(result).toMatchObject({ status: "error", reason: "KEY_FILE" })
    expect(budget.taken).toEqual([])
  })

  it("a spent budget answers without asking Google", async () => {
    const fetch = google()
    const service = createSiteAnalytics(env, { fetch, now: () => NOW, budget: budgetOf(1) })
    await service.inspect("https://nodaro.ai/a", { fresh: false })
    const refusedCheck = await service.inspect("https://nodaro.ai/b", { fresh: false })
    expect(refusedCheck).toMatchObject({ status: "error", reason: "DAILY_BUDGET", httpStatus: 429 })
    expect(calls(fetch, INSPECT)).toBe(1)
  })

  it("without a Search Console site there is nothing to inspect against", async () => {
    const service = createSiteAnalytics({ ...env, searchConsoleSite: "" }, { fetch: google(), now: () => NOW, budget: budgetOf(10) })
    expect(await service.inspect("https://nodaro.ai/docs", { fresh: false })).toEqual({ status: "not_configured" })
  })
})
